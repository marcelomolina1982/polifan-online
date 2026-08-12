from extended_app import app, _kit_valid_for_plate
from app import _n, svg_to_geometry
from flask import request, jsonify
from shapely.affinity import rotate as shp_rotate, translate as shp_translate
import time, math

MIN_COMPLETE=10
HIGH_DENSITY_COMPLETE=9
HIGH_DENSITY_MIN=72.0
MAX_COMPLETE=14
TOTAL_BUDGET_SECONDS=165
STATE_BEAM=14
PART_POSITION_BEAM=10
PER_ANGLE_LIMIT=28
ANGLE_SET=(0,90,180,270,15,345,30,330,45,315,60,300,75,285,105,255,120,240,135,225,150,210,165,195)


def _priority(k): return _n(k.get('priority'),999999)

def _prep_part(part,kit_id,figure):
    wcm=_n(part.get('sourceWidthCm') or part.get('widthCm'))
    hcm=_n(part.get('sourceHeightCm') or part.get('heightCm'))
    geom,trimx,trimy=svg_to_geometry(part.get('svgText') or '',wcm,hcm,solver_tolerance_mm=.24,max_vertices=260)
    return {'instanceId':str(part.get('instanceId') or ''),'kitId':str(kit_id),'figure':figure,'name':str(part.get('name') or ''),'role':str(part.get('role') or 'simple'),'geom':geom,'trimXmm':trimx,'trimYmm':trimy,'area':float(geom.area or 0)}


def _prep_kit(kit):
    kid=str(kit.get('kitId') or '')
    fig=str(kit.get('figure') or '')
    parts=[_prep_part(p,kid,fig) for p in (kit.get('parts') or [])]
    parts.sort(key=lambda p:-p['area'])
    return {'kitId':kid,'figure':fig,'priority':_priority(kit),'parts':parts,'area':sum(p['area'] for p in parts)}


def _rotated(part,angle):
    g=shp_rotate(part['geom'],angle,origin=(0,0),use_radians=False)
    minx,miny,maxx,maxy=g.bounds
    shiftx=-minx; shifty=-miny
    g=shp_translate(g,xoff=shiftx,yoff=shifty)
    return g,shiftx,shifty


def _used_bounds(placed):
    if not placed:return (0,0,0,0)
    xs=[];ys=[];xe=[];ye=[]
    for p in placed:
        b=p['geom'].bounds;xs.append(b[0]);ys.append(b[1]);xe.append(b[2]);ye.append(b[3])
    return min(xs),min(ys),max(xe),max(ye)


def _state_score(st,width_mm,height_mm):
    n=len(st['kits']); density=100.0*st['area']/(width_mm*height_mm)
    b=_used_bounds(st['placed']); envelope=max(1.0,(b[2]-b[0])*(b[3]-b[1])) if st['placed'] else width_mm*height_mm
    compact=100.0*st['area']/envelope if envelope else 0
    priority_penalty=sum(k['priority'] for k in st['kits'])
    # Primero cantidad, luego densidad/compactación y finalmente prioridad.
    return (n,density,compact,-priority_penalty,-b[3],-b[2])


def _sample_coords(geom,max_points=22):
    coords=[]
    geoms=[geom] if geom.geom_type=='Polygon' else list(getattr(geom,'geoms',[]))
    for gg in geoms:
        ext=getattr(gg,'exterior',None)
        if ext is None: continue
        pts=list(ext.coords)
        if not pts: continue
        step=max(1,len(pts)//max_points)
        coords.extend(pts[::step][:max_points])
    return coords[:max_points*2]


def _candidate_xy(g,placed,width_mm,height_mm,gap):
    minx,miny,maxx,maxy=g.bounds; w=maxx-minx; h=maxy-miny
    xs={0.0,max(0.0,width_mm-w)}; ys={0.0,max(0.0,height_mm-h)}

    # Anclajes por bounding box.
    for p in placed:
        a,b,c,d=p['geom'].bounds
        xs.update((c+gap,a-w-gap,max(0.0,(a+c-w)/2)))
        ys.update((d+gap,b-h-gap,max(0.0,(b+d-h)/2)))

    # Anclajes por vértices reales. Esto permite probar entrantes que el bbox no ve.
    own=_sample_coords(g,14)
    own_x=sorted({round(q[0],2) for q in own})
    own_y=sorted({round(q[1],2) for q in own})
    if own_x:
        own_x=[own_x[0],own_x[len(own_x)//2],own_x[-1]]
    if own_y:
        own_y=[own_y[0],own_y[len(own_y)//2],own_y[-1]]
    for p in placed:
        for vx,vy in _sample_coords(p['geom'],18):
            for gx in own_x:
                xs.add(vx-gx+gap); xs.add(vx-gx-gap)
            for gy in own_y:
                ys.add(vy-gy+gap); ys.add(vy-gy-gap)

    xs=[x for x in xs if x>=-1e-6 and x+w<=width_mm+1e-6]
    ys=[y for y in ys if y>=-1e-6 and y+h<=height_mm+1e-6]
    # Priorizamos abajo/izquierda, pero sin eliminar los puntos tardíos.
    xs=sorted(xs)[:46]
    ys=sorted(ys)[:34]
    pts=[(x,y) for y in ys for x in xs]
    pts.sort(key=lambda q:(q[1]+q[0]*.18,q[0],q[1]))
    return pts[:650]


def _valid(cand,placed,width_mm,height_mm,gap):
    b=cand.bounds
    if b[0] < -1e-6 or b[1] < -1e-6 or b[2] > width_mm+1e-6 or b[3] > height_mm+1e-6:return False
    for p in placed:
        other=p['geom']
        if cand.intersects(other): return False
        if cand.distance(other) < gap-0.06: return False
    return True


def _place_part_variants(state,part,width_mm,height_mm,gap):
    out=[]
    # IMPORTANTE: cada ángulo recibe su propio cupo. Antes 0° llenaba el cupo global
    # y las demás rotaciones prácticamente no llegaban a probarse.
    for angle in ANGLE_SET:
        rg,sx,sy=_rotated(part,angle)
        accepted=0
        for x,y in _candidate_xy(rg,state['placed'],width_mm,height_mm,gap):
            cand=shp_translate(rg,xoff=x,yoff=y)
            if not _valid(cand,state['placed'],width_mm,height_mm,gap):continue
            placed_meta={'geom':cand,'instanceId':part['instanceId'],'kitId':part['kitId'],'figure':part['figure'],'name':part['name'],'role':part['role'],'angle':angle,'xMm':x+sx,'yMm':y+sy,'trimXmm':part['trimXmm'],'trimYmm':part['trimYmm'],'area':part['area']}
            newplaced=state['placed']+[placed_meta]
            b=_used_bounds(newplaced)
            envelope=(b[2]-b[0])*(b[3]-b[1])
            # Compactar hacia abajo/izquierda y preferir menor envolvente.
            score=(envelope,b[3],b[2],y,x,abs(angle)%90)
            out.append((score,placed_meta))
            accepted+=1
            if accepted>=PER_ANGLE_LIMIT: break
    out.sort(key=lambda x:x[0])

    # Mantener diversidad angular/espacial además de los mejores scores puros.
    chosen=[]; seen=set()
    for score,p in out:
        sig=(round(p['xMm']/10),round(p['yMm']/10),int(p['angle'])%180)
        if sig in seen: continue
        seen.add(sig); chosen.append(p)
        if len(chosen)>=PART_POSITION_BEAM: break
    return chosen


def _add_kit(state,kit,width_mm,height_mm,gap):
    part_orders=[kit['parts'],list(reversed(kit['parts']))] if len(kit['parts'])>1 else [kit['parts']]
    finals=[]
    for order in part_orders:
        partial=[state]
        for part in order:
            nxt=[]
            for st in partial:
                for pm in _place_part_variants(st,part,width_mm,height_mm,gap):
                    nxt.append({'placed':st['placed']+[pm],'kits':st['kits'],'area':st['area']+part['area']})
            if not nxt:
                partial=[];break
            # Diversidad espacial dentro del mismo kit.
            nxt.sort(key=lambda s:_state_score(s,width_mm,height_mm),reverse=True)
            kept=[]; sigs=set()
            for s in nxt:
                b=_used_bounds(s['placed'])
                sig=(round(b[2]/20),round(b[3]/20),tuple((round(p['xMm']/20),round(p['yMm']/20),int(p['angle'])%180) for p in s['placed'][-2:]))
                if sig in sigs: continue
                sigs.add(sig);kept.append(s)
                if len(kept)>=PART_POSITION_BEAM:break
            partial=kept
        finals.extend(partial)
    out=[]
    for st in finals:
        out.append({'placed':st['placed'],'kits':state['kits']+[kit],'area':st['area']})
    out.sort(key=lambda s:_state_score(s,width_mm,height_mm),reverse=True)
    return out[:PART_POSITION_BEAM]


def _placements(state):
    return [{'instanceId':p['instanceId'],'kitId':p['kitId'],'figure':p['figure'],'name':p['name'],'role':p['role'],'xCm':p['xMm']/10.0,'yCm':p['yMm']/10.0,'angle':p['angle'],'trimXCm':p['trimXmm']/10.0,'trimYCm':p['trimYmm']/10.0} for p in state['placed']]


def _payload(state,width_mm,height_mm,started,ready,reason,rejected):
    b=_used_bounds(state['placed']);density=100.0*state['area']/(width_mm*height_mm)
    envelope=max(1.0,(b[2]-b[0])*(b[3]-b[1])) if state['placed'] else width_mm*height_mm
    compact=100.0*state['area']/envelope if envelope else 0
    return {'ok':ready,'engine':'Motor V5.1 geometrico directo · rotaciones reales','completeFigures':len(state['kits']),'placements':_placements(state),'density':density,'compactness':compact,'usedWidthMm':max(0,b[2]-b[0]),'usedHeightMm':max(0,b[3]-b[1]),'rotationStep':15,'source':'direct-shapely-diverse-beam','selectionStrategy':'contorno-directo-diverso','productionReady':ready,'reachedMinimum':len(state['kits'])>=MIN_COMPLETE,'highDensityException':len(state['kits'])==9 and density>=HIGH_DENSITY_MIN,'resultReason':reason,'bestDiagnosticComplete':len(state['kits']),'bestDiagnosticDensity':round(density,1),'rejectedCount':len(rejected),'rejected':rejected[:8],'elapsedSeconds':round(time.time()-started,2)}


def _spatial_signature(st):
    # No deduplicar únicamente por IDs de kits. Dos acomodos con las mismas figuras
    # pueden tener futuros completamente distintos.
    kit_ids=tuple(sorted(k['kitId'] for k in st['kits']))
    positions=tuple(sorted((round(p['xMm']/25),round(p['yMm']/25),int(p['angle'])%180,p['role']) for p in st['placed']))
    return kit_ids,positions


@app.post('/nest-v5')
def nest_v5():
    started=time.time(); data=request.get_json(silent=True) or {}
    try:
        width_mm=max(1.0,_n(data.get('widthCm'),122)*10); height_mm=max(1.0,_n(data.get('heightCm'),58)*10); gap=max(2.5,_n(data.get('gapCm'),.3)*10)
        raw=sorted(data.get('kits') or [],key=lambda k:(_priority(k),str(k.get('date') or ''),str(k.get('figure') or '')))[:32]
        if not raw:return jsonify(ok=False,error='No llegaron figuras al Motor V5.1'),400
        kits=[]; rejected=[]
        for k in raw:
            valid,detail=_kit_valid_for_plate(k,width_mm,height_mm)
            if not valid:
                rejected.append({'kitId':str(k.get('kitId') or ''),'figure':str(k.get('figure') or ''),'reason':str(detail)});continue
            try:kits.append(_prep_kit(k))
            except Exception as exc:rejected.append({'kitId':str(k.get('kitId') or ''),'figure':str(k.get('figure') or ''),'reason':str(exc)})
        if not kits:return jsonify(ok=False,error='No hay kits geometricos utilizables',rejected=rejected[:8]),422

        urgent=kits[:20]; compact=sorted(kits,key=lambda k:(k['area'],k['priority']))[:16]
        pool=[];seen=set()
        for k in urgent+compact:
            if k['kitId'] not in seen:seen.add(k['kitId']);pool.append(k)
        beam=[{'placed':[],'kits':[],'area':0.0}]; best=beam[0]
        depth=0
        while beam and depth<MAX_COMPLETE and time.time()-started<TOTAL_BUDGET_SECONDS:
            depth+=1; nxt=[]
            for st in beam:
                used={k['kitId'] for k in st['kits']}
                extras=[k for k in pool if k['kitId'] not in used]
                # Al principio prioridad; después mezclar compacto y prioridad.
                if depth<=4:
                    extras=sorted(extras,key=lambda k:(k['priority'],k['area']))[:12]
                else:
                    urgent_ex=sorted(extras,key=lambda k:(k['priority'],k['area']))[:7]
                    compact_ex=sorted(extras,key=lambda k:(k['area'],k['priority']))[:7]
                    merged=[]; mids=set()
                    for k in urgent_ex+compact_ex:
                        if k['kitId'] not in mids:mids.add(k['kitId']);merged.append(k)
                    extras=merged[:14]
                for kit in extras:
                    if time.time()-started>TOTAL_BUDGET_SECONDS:break
                    nxt.extend(_add_kit(st,kit,width_mm,height_mm,gap))
            if not nxt:break

            uniq={}
            for st in nxt:
                key=_spatial_signature(st)
                if key not in uniq or _state_score(st,width_mm,height_mm)>_state_score(uniq[key],width_mm,height_mm):uniq[key]=st
            beam=sorted(uniq.values(),key=lambda s:_state_score(s,width_mm,height_mm),reverse=True)[:STATE_BEAM]
            if beam and _state_score(beam[0],width_mm,height_mm)>_state_score(best,width_mm,height_mm):best=beam[0]
            n=len(best['kits']);density=100.0*best['area']/(width_mm*height_mm)
            if n>=MIN_COMPLETE and (n>=MAX_COMPLETE or time.time()-started>TOTAL_BUDGET_SECONDS-12):break
            if n==HIGH_DENSITY_COMPLETE and density>=HIGH_DENSITY_MIN and time.time()-started>TOTAL_BUDGET_SECONDS-20:break

        n=len(best['kits']);density=100.0*best['area']/(width_mm*height_mm)
        ready=n>=MIN_COMPLETE or (n==HIGH_DENSITY_COMPLETE and density>=HIGH_DENSITY_MIN)
        reason='10+ completas por geometria directa' if n>=MIN_COMPLETE else (f'9 completas con {density:.1f}% de ocupacion' if ready else f'Mejor parcial geometrico: {n} completas con {density:.1f}%')
        payload=_payload(best,width_mm,height_mm,started,ready,reason,rejected)
        if not ready:payload['error']=reason
        return jsonify(**payload),(200 if ready else 422)
    except Exception as exc:
        return jsonify(ok=False,error=str(exc),engine='Motor V5.1 geometrico directo',elapsedSeconds=round(time.time()-started,2)),500
