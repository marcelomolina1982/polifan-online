from extended_app import app, _kit_valid_for_plate
from app import _n, svg_to_geometry
from flask import request, jsonify
from shapely.affinity import rotate as shp_rotate, translate as shp_translate
from shapely.geometry import Polygon, MultiPolygon
import pyclipper
import time, math

MIN_COMPLETE=10
HIGH_DENSITY_COMPLETE=9
HIGH_DENSITY_MIN=72.0
MAX_COMPLETE=14
TOTAL_BUDGET_SECONDS=168
STATE_BEAM=10
PART_BEAM=7
KIT_CANDIDATES=14
ANGLE_SET=tuple(range(0,360,15))
PC_SCALE=1000.0


def _priority(k):
    return _n(k.get('priority'),999999)


def _prep_part(part,kit_id,figure):
    wcm=_n(part.get('sourceWidthCm') or part.get('widthCm'))
    hcm=_n(part.get('sourceHeightCm') or part.get('heightCm'))
    geom,trimx,trimy=svg_to_geometry(part.get('svgText') or '',wcm,hcm,solver_tolerance_mm=.30,max_vertices=150)
    if geom.is_empty:
        raise ValueError('geometría vacía')
    if not geom.is_valid:
        geom=geom.buffer(0)
    return {
        'instanceId':str(part.get('instanceId') or ''),
        'kitId':str(kit_id),'figure':figure,
        'name':str(part.get('name') or ''),'role':str(part.get('role') or 'simple'),
        'geom':geom,'trimXmm':float(trimx),'trimYmm':float(trimy),
        'area':float(geom.area or 0)
    }


def _prep_kit(kit):
    kid=str(kit.get('kitId') or '')
    fig=str(kit.get('figure') or '')
    parts=[_prep_part(p,kid,fig) for p in (kit.get('parts') or [])]
    parts.sort(key=lambda p:-p['area'])
    return {'kitId':kid,'figure':fig,'priority':_priority(kit),'parts':parts,'area':sum(p['area'] for p in parts)}


def _poly_exteriors(geom,max_points=80):
    if geom.is_empty:
        return []
    geoms=[geom] if isinstance(geom,Polygon) else list(geom.geoms) if isinstance(geom,MultiPolygon) else []
    out=[]
    for g in geoms:
        ring=list(g.exterior.coords)[:-1]
        if len(ring)>max_points:
            step=max(1,math.ceil(len(ring)/max_points))
            ring=ring[::step]
        if len(ring)>=3:
            out.append(ring)
    return out


def _to_pc(ring):
    return [(int(round(x*PC_SCALE)),int(round(y*PC_SCALE))) for x,y in ring]


def _from_pc(p):
    return (p[0]/PC_SCALE,p[1]/PC_SCALE)


def _normalize_rotated(part,angle):
    g=shp_rotate(part['geom'],angle,origin=(0,0),use_radians=False)
    minx,miny,maxx,maxy=g.bounds
    g=shp_translate(g,xoff=-minx,yoff=-miny)
    return g,float(-minx),float(-miny)


def _used_bounds(placed):
    if not placed:return (0,0,0,0)
    b=[p['geom'].bounds for p in placed]
    return min(x[0] for x in b),min(x[1] for x in b),max(x[2] for x in b),max(x[3] for x in b)


def _state_score(st,width_mm,height_mm):
    count=len(st['kits'])
    density=100.0*st['area']/(width_mm*height_mm)
    b=_used_bounds(st['placed'])
    env=max(1.0,(b[2]-b[0])*(b[3]-b[1])) if st['placed'] else width_mm*height_mm
    compact=100.0*st['area']/env
    priority=-sum(k['priority'] for k in st['kits'])
    return (count,density,compact,priority)


def _valid(cand,placed,width_mm,height_mm,gap):
    b=cand.bounds
    if b[0] < -0.03 or b[1] < -0.03 or b[2] > width_mm+0.03 or b[3] > height_mm+0.03:
        return False
    for p in placed:
        other=p['geom']
        if cand.intersects(other):
            return False
        if cand.distance(other) < gap-0.08:
            return False
    return True


def _nfp_contact_points(moving,placed,gap,width_mm,height_mm):
    # SVGnest-style idea: offset each contour by half spacing, then use
    # Minkowski sums A + (-B) to obtain the no-fit boundary for translations.
    expanded_m=moving.buffer(gap/2.0,join_style=2,resolution=2)
    mb=expanded_m.bounds
    # normalize expanded moving contour to the same origin as moving geometry
    # moving itself is already normalized at (0,0).
    points={(0.0,0.0)}
    w=moving.bounds[2]-moving.bounds[0]; h=moving.bounds[3]-moving.bounds[1]
    points.update({(max(0.0,width_mm-w),0.0),(0.0,max(0.0,height_mm-h)),(max(0.0,width_mm-w),max(0.0,height_mm-h))})
    b_rings=_poly_exteriors(expanded_m,65)
    if not b_rings:
        return list(points)
    for pm in placed:
        expanded_a=pm['geom'].buffer(gap/2.0,join_style=2,resolution=2)
        for ar in _poly_exteriors(expanded_a,65):
            ap=_to_pc(ar)
            for br in b_rings:
                # Translation vectors t where B+t touches/intersects A are A + (-B).
                pattern=[(-x,-y) for x,y in _to_pc(br)]
                try:
                    polys=pyclipper.MinkowskiSum(pattern,ap,True)
                except Exception:
                    polys=[]
                for poly in polys[:8]:
                    if len(poly)<3:continue
                    # Boundary vertices are exact contact candidates. Sampling keeps cost bounded.
                    step=max(1,len(poly)//45)
                    for q in poly[::step]:
                        x,y=_from_pc(q)
                        if -0.2<=x<=width_mm-w+0.2 and -0.2<=y<=height_mm-h+0.2:
                            points.add((round(max(0.0,min(width_mm-w,x)),3),round(max(0.0,min(height_mm-h,y)),3)))
    # Add a few boundary-aligned projections; useful when NFP has long flat edges.
    for pm in placed:
        a,b,c,d=pm['geom'].bounds
        points.update({(c+gap,0.0),(0.0,d+gap),(a-w-gap,0.0),(0.0,b-h-gap)})
    clean=[(x,y) for x,y in points if x>=-1e-6 and y>=-1e-6 and x+w<=width_mm+1e-6 and y+h<=height_mm+1e-6]
    return clean


def _placement_variants(state,part,width_mm,height_mm,gap):
    variants=[]
    for angle in ANGLE_SET:
        rg,sx,sy=_normalize_rotated(part,angle)
        for x,y in _nfp_contact_points(rg,state['placed'],gap,width_mm,height_mm):
            cand=shp_translate(rg,xoff=x,yoff=y)
            if not _valid(cand,state['placed'],width_mm,height_mm,gap):
                continue
            meta={
                'geom':cand,'instanceId':part['instanceId'],'kitId':part['kitId'],
                'figure':part['figure'],'name':part['name'],'role':part['role'],
                'angle':angle,'xMm':x+sx,'yMm':y+sy,
                'trimXmm':part['trimXmm'],'trimYmm':part['trimYmm'],'area':part['area']
            }
            newp=state['placed']+[meta]
            bb=_used_bounds(newp)
            envelope=(bb[2]-bb[0])*(bb[3]-bb[1])
            score=(envelope,bb[2]*1.45+bb[3],y,x)
            variants.append((score,meta))
    variants.sort(key=lambda z:z[0])
    # Spatially diversify instead of returning near-identical points.
    out=[]; seen=set()
    for _,m in variants:
        key=(round(m['xMm']/8),round(m['yMm']/8),m['angle']//15)
        if key in seen:continue
        seen.add(key);out.append(m)
        if len(out)>=PART_BEAM:break
    return out


def _add_kit(state,kit,width_mm,height_mm,gap):
    orders=[kit['parts']]
    if len(kit['parts'])>1:
        orders.append(list(reversed(kit['parts'])))
    finals=[]
    for order in orders:
        partial=[{'placed':state['placed'],'kits':state['kits'],'area':state['area']}]
        for part in order:
            nxt=[]
            for st in partial:
                for pm in _placement_variants(st,part,width_mm,height_mm,gap):
                    nxt.append({'placed':st['placed']+[pm],'kits':st['kits'],'area':st['area']+part['area']})
            if not nxt:
                partial=[];break
            nxt.sort(key=lambda s:_state_score(s,width_mm,height_mm),reverse=True)
            partial=nxt[:PART_BEAM]
        finals.extend(partial)
    out=[]
    for st in finals:
        out.append({'placed':st['placed'],'kits':state['kits']+[kit],'area':st['area']})
    out.sort(key=lambda s:_state_score(s,width_mm,height_mm),reverse=True)
    return out[:PART_BEAM]


def _signature(st):
    # keep distinct spatial arrangements of the same kits
    spatial=tuple(sorted((p['kitId'],p['role'],round(p['geom'].centroid.x/15),round(p['geom'].centroid.y/15),p['angle']//15) for p in st['placed']))
    return (tuple(sorted(k['kitId'] for k in st['kits'])),spatial)


def _placements(st):
    return [{
        'instanceId':p['instanceId'],'kitId':p['kitId'],'figure':p['figure'],'name':p['name'],'role':p['role'],
        'xCm':p['xMm']/10.0,'yCm':p['yMm']/10.0,'angle':p['angle'],
        'trimXCm':p['trimXmm']/10.0,'trimYCm':p['trimYmm']/10.0
    } for p in st['placed']]


def _payload(st,width_mm,height_mm,started,ready,reason,rejected,pool_count):
    b=_used_bounds(st['placed'])
    density=100.0*st['area']/(width_mm*height_mm)
    return {
        'ok':ready,'engine':'Motor NFP · Minkowski/Clipper + V1.7',
        'completeFigures':len(st['kits']),'placements':_placements(st),'density':density,
        'usedWidthMm':max(0,b[2]-b[0]),'usedHeightMm':max(0,b[3]-b[1]),
        'rotationStep':15,'source':'nfp-minkowski-beam','selectionStrategy':'NFP / Minkowski + prioridad',
        'productionReady':ready,'reachedMinimum':len(st['kits'])>=MIN_COMPLETE,
        'highDensityException':len(st['kits'])==9 and density>=HIGH_DENSITY_MIN,
        'resultReason':reason,'bestDiagnosticComplete':len(st['kits']),'bestDiagnosticDensity':round(density,1),
        'candidatePool':pool_count,'rejectedCount':len(rejected),'rejected':rejected[:8],
        'elapsedSeconds':round(time.time()-started,2)
    }


@app.get('/nest-nfp/health')
def nest_nfp_health():
    return jsonify(ok=True,engine='Motor NFP Minkowski/Clipper',spacing='3 mm preferido',certifier='V1.7')


@app.post('/nest-nfp')
def nest_nfp():
    started=time.time(); data=request.get_json(silent=True) or {}
    try:
        width_mm=max(1.0,_n(data.get('widthCm'),122)*10)
        height_mm=max(1.0,_n(data.get('heightCm'),58)*10)
        gap=max(2.5,_n(data.get('gapCm'),.3)*10)
        raw=sorted(data.get('kits') or [],key=lambda k:(_priority(k),str(k.get('date') or ''),str(k.get('figure') or '')))[:32]
        if not raw:return jsonify(ok=False,error='No llegaron figuras al Motor NFP'),400
        kits=[];rejected=[]
        for k in raw:
            valid,detail=_kit_valid_for_plate(k,width_mm,height_mm)
            if not valid:
                rejected.append({'kitId':str(k.get('kitId') or ''),'figure':str(k.get('figure') or ''),'reason':str(detail)});continue
            try:kits.append(_prep_kit(k))
            except Exception as exc:rejected.append({'kitId':str(k.get('kitId') or ''),'figure':str(k.get('figure') or ''),'reason':str(exc)})
        if not kits:return jsonify(ok=False,error='No hay kits geométricos utilizables',rejected=rejected[:8]),422

        urgent=kits[:20]
        compact=sorted(kits,key=lambda k:(k['area'],k['priority']))[:14]
        pool=[];seen=set()
        for k in urgent+compact:
            if k['kitId'] not in seen:
                seen.add(k['kitId']);pool.append(k)
        beam=[{'placed':[],'kits':[],'area':0.0}]
        best=beam[0]
        depth=0
        while beam and depth<MAX_COMPLETE and time.time()-started<TOTAL_BUDGET_SECONDS:
            depth+=1;nxt=[]
            for st in beam:
                used={k['kitId'] for k in st['kits']}
                remain=[k for k in pool if k['kitId'] not in used]
                # Early levels preserve urgency; later levels favor compact fillers.
                remain=sorted(remain,key=lambda k:((k['priority'] if depth<=6 else k['area']),k['area'],k['priority']))[:KIT_CANDIDATES]
                for kit in remain:
                    if time.time()-started>=TOTAL_BUDGET_SECONDS:break
                    nxt.extend(_add_kit(st,kit,width_mm,height_mm,gap))
            if not nxt:break
            uniq={}
            for st in nxt:
                key=_signature(st)
                if key not in uniq or _state_score(st,width_mm,height_mm)>_state_score(uniq[key],width_mm,height_mm):
                    uniq[key]=st
            beam=sorted(uniq.values(),key=lambda s:_state_score(s,width_mm,height_mm),reverse=True)[:STATE_BEAM]
            if _state_score(beam[0],width_mm,height_mm)>_state_score(best,width_mm,height_mm):best=beam[0]
            n=len(best['kits']);density=100.0*best['area']/(width_mm*height_mm)
            if n>=MAX_COMPLETE:break
            if n>=MIN_COMPLETE and time.time()-started>TOTAL_BUDGET_SECONDS-18:break
            if n==9 and density>=HIGH_DENSITY_MIN and time.time()-started>TOTAL_BUDGET_SECONDS-28:break

        n=len(best['kits']);density=100.0*best['area']/(width_mm*height_mm)
        ready=n>=MIN_COMPLETE or (n==HIGH_DENSITY_COMPLETE and density>=HIGH_DENSITY_MIN)
        reason=(f'{n} completas mediante NFP' if n>=MIN_COMPLETE else (f'9 completas con {density:.1f}% mediante NFP' if ready else f'Mejor parcial NFP: {n} completas con {density:.1f}%'))
        payload=_payload(best,width_mm,height_mm,started,ready,reason,rejected,len(pool))
        if not ready:payload['error']=reason
        return jsonify(**payload),(200 if ready else 422)
    except Exception as exc:
        return jsonify(ok=False,error=str(exc),engine='Motor NFP Minkowski/Clipper',elapsedSeconds=round(time.time()-started,2)),500
