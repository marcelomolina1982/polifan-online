from extended_app import app, _kit_valid_for_plate
from app import _n, svg_to_geometry
from flask import request, jsonify
from shapely.geometry import Polygon, MultiPolygon
import json, os, subprocess, tempfile, time

SPARROW_BIN=os.environ.get('SPARROW_BIN','/usr/local/bin/sparrow')
PLATE_WIDTH_MM=1220.0
PLATE_HEIGHT_MM=580.0
MIN_COMPLETE=10
HIGH_DENSITY_COMPLETE=9
HIGH_DENSITY_MIN=72.0
ANGLES=[float(a) for a in range(0,360,15)]


def _priority(k):
    return _n(k.get('priority'),999999)


def _coords(poly):
    pts=[[float(x),float(y)] for x,y in list(poly.exterior.coords)]
    if len(pts)>1 and pts[0]==pts[-1]:
        pts=pts[:-1]
    return pts


def _shape(geom):
    if isinstance(geom,Polygon):
        return {'type':'simple_polygon','data':_coords(geom)}
    if isinstance(geom,MultiPolygon):
        data=[]
        for g in geom.geoms:
            if g.is_empty or g.area<=0: continue
            data.append({'outer':_coords(g),'inner':[]})
        if not data: raise ValueError('multipolígono vacío')
        return {'type':'multi_polygon','data':data}
    geoms=[g for g in getattr(geom,'geoms',[]) if isinstance(g,Polygon) and not g.is_empty]
    if len(geoms)==1:
        return {'type':'simple_polygon','data':_coords(geoms[0])}
    if geoms:
        return {'type':'multi_polygon','data':[{'outer':_coords(g),'inner':[]} for g in geoms]}
    raise ValueError('geometría no soportada por Sparrow')


def _prep_part(part,kit_id,figure):
    wcm=_n(part.get('sourceWidthCm') or part.get('widthCm'))
    hcm=_n(part.get('sourceHeightCm') or part.get('heightCm'))
    geom,trimx,trimy=svg_to_geometry(part.get('svgText') or '',wcm,hcm,solver_tolerance_mm=.22,max_vertices=320)
    if geom.is_empty: raise ValueError('geometría vacía')
    if not geom.is_valid: geom=geom.buffer(0)
    return {
        'instanceId':str(part.get('instanceId') or ''),'kitId':str(kit_id),'figure':str(figure),
        'name':str(part.get('name') or ''),'role':str(part.get('role') or 'simple'),
        'geom':geom,'shape':_shape(geom),'trimXmm':float(trimx),'trimYmm':float(trimy),
        'area':float(geom.area or 0)
    }


def _prep_kit(kit,width_mm,height_mm):
    valid,detail=_kit_valid_for_plate(kit,width_mm,height_mm)
    if not valid: raise ValueError(str(detail))
    kid=str(kit.get('kitId') or '')
    fig=str(kit.get('figure') or '')
    parts=[_prep_part(p,kid,fig) for p in (kit.get('parts') or [])]
    if not parts: raise ValueError('sin componentes')
    return {'kitId':kid,'figure':fig,'priority':_priority(kit),'parts':parts,'area':sum(p['area'] for p in parts)}


def _candidate_sets(kits):
    pool=kits[:24]
    sets=[]
    def add(rows,label):
        if len(rows)<9:return
        key=tuple(k['kitId'] for k in rows)
        if any(tuple(k['kitId'] for k in s[0])==key for s in sets):return
        sets.append((rows,label))
    add(pool[:10],'10 urgentes')
    if len(pool)>=10:
        head=pool[:4]
        rest=sorted(pool[4:],key=lambda k:(k['area'],k['priority']))
        add((head+rest)[:10],'10 urgentes + compactas')
    add(pool[:9],'9 urgentes')
    return sets


def _run_sparrow(selected,gap_mm,seconds,seed):
    started=time.time()
    items=[]; idmap={}; item_id=0
    for kit in selected:
        for part in kit['parts']:
            items.append({'id':item_id,'demand':1,'allowed_orientations':ANGLES,'shape':part['shape']})
            idmap[item_id]=part
            item_id+=1
    instance={'name':'polifan','items':items,'strip_height':PLATE_HEIGHT_MM}
    with tempfile.TemporaryDirectory(prefix='polifan-sparrow-') as td:
        inp=os.path.join(td,'input.json')
        with open(inp,'w',encoding='utf-8') as f: json.dump(instance,f,separators=(',',':'))
        cmd=[SPARROW_BIN,'-i',inp,'-t',str(int(seconds)),'--min-item-separation',str(float(gap_mm)),'--workers','1','-s',str(int(seed))]
        try:
            proc=subprocess.run(cmd,cwd=td,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=seconds+20)
        except subprocess.TimeoutExpired as exc:
            return {'ok':False,'error':'Sparrow excedió su tiempo interno','log':(exc.stdout or '')[-1600:] if isinstance(exc.stdout,str) else ''}
        outpath=os.path.join(td,'output','final_polifan.json')
        if proc.returncode!=0 or not os.path.exists(outpath):
            return {'ok':False,'error':f'Sparrow terminó con código {proc.returncode}','log':(proc.stdout or '')[-2000:]}
        with open(outpath,'r',encoding='utf-8') as f: result=json.load(f)
    sol=result.get('solution') or {}
    strip_width=float(sol.get('strip_width') or 1e18)
    placed=((sol.get('layout') or {}).get('placed_items') or [])
    placements=[]
    for row in placed:
        iid=int(row.get('item_id'))
        part=idmap.get(iid)
        if not part: continue
        tr=row.get('transformation') or {}
        tx,ty=(tr.get('translation') or [0,0])[:2]
        placements.append({
            'instanceId':part['instanceId'],'kitId':part['kitId'],'figure':part['figure'],'name':part['name'],'role':part['role'],
            'xCm':float(tx)/10.0,'yCm':float(ty)/10.0,'angle':float(tr.get('rotation') or 0),
            'trimXCm':part['trimXmm']/10.0,'trimYCm':part['trimYmm']/10.0
        })
    all_parts=len(placements)==len(items)
    density=100.0*sum(k['area'] for k in selected)/(PLATE_WIDTH_MM*PLATE_HEIGHT_MM)
    fits=all_parts and strip_width<=PLATE_WIDTH_MM+0.5
    return {'ok':True,'fits':fits,'stripWidthMm':strip_width,'density':density,'placements':placements,
            'elapsedSeconds':round(time.time()-started,2),'solverDensity':float(sol.get('density') or 0)*100.0,
            'runTimeSec':sol.get('run_time_sec'),'placedParts':len(placements),'expectedParts':len(items)}


@app.get('/nest-sparrow/health')
def nest_sparrow_health():
    exists=os.path.exists(SPARROW_BIN) and os.access(SPARROW_BIN,os.X_OK)
    return jsonify(ok=exists,engine='Sparrow industrial + V1.7',binary=SPARROW_BIN,criterion='10 completas o 9 con >=72%')


@app.post('/nest-sparrow')
def nest_sparrow():
    started=time.time(); data=request.get_json(silent=True) or {}
    if not os.path.exists(SPARROW_BIN):
        return jsonify(ok=False,error='El binario Sparrow no está instalado en Render'),503
    width_mm=max(1.0,_n(data.get('widthCm'),122)*10)
    height_mm=max(1.0,_n(data.get('heightCm'),58)*10)
    if abs(width_mm-PLATE_WIDTH_MM)>1 or abs(height_mm-PLATE_HEIGHT_MM)>1:
        return jsonify(ok=False,error='Sparrow producción está fijado a placa 1220×580 mm'),400
    gap=max(2.5,_n(data.get('gapCm'),.3)*10)
    raw=sorted(data.get('kits') or [],key=lambda k:(_priority(k),str(k.get('date') or ''),str(k.get('figure') or '')))[:32]
    if not raw:return jsonify(ok=False,error='No llegaron figuras a Sparrow'),400
    kits=[];rejected=[]
    for k in raw:
        try:kits.append(_prep_kit(k,width_mm,height_mm))
        except Exception as exc:rejected.append({'kitId':str(k.get('kitId') or ''),'figure':str(k.get('figure') or ''),'reason':str(exc)})
    if len(kits)<9:return jsonify(ok=False,error=f'Sólo hay {len(kits)} kits geométricos utilizables',rejected=rejected[:8]),422

    best=None; attempts=[]
    for idx,(selected,label) in enumerate(_candidate_sets(kits)):
        target=len(selected)
        if target==10:
            seconds=62
        else:
            seconds=48
        result=_run_sparrow(selected,gap,seconds,41+idx*17)
        attempts.append({'label':label,'target':target,'ok':result.get('ok'), 'fits':result.get('fits'), 'stripWidthMm':result.get('stripWidthMm'), 'density':round(float(result.get('density') or 0),1), 'error':result.get('error')})
        if result.get('ok'):
            score=(target if result.get('fits') else 0,-float(result.get('stripWidthMm') or 1e18))
            if best is None or score>best[0]:best=(score,selected,label,result)
            ready=result.get('fits') and (target>=MIN_COMPLETE or (target==HIGH_DENSITY_COMPLETE and result.get('density',0)>=HIGH_DENSITY_MIN))
            if ready:
                return jsonify(ok=True,engine='Sparrow industrial + V1.7',completeFigures=target,placements=result['placements'],density=result['density'],
                    stripWidthMm=result['stripWidthMm'],rotationStep=15,source='sparrow-jagua-rs',selectionStrategy=label,
                    productionReady=True,reachedMinimum=target>=10,highDensityException=target==9,
                    candidatePool=len(kits),rejectedCount=len(rejected),rejected=rejected[:8],attempts=attempts,
                    elapsedSeconds=round(time.time()-started,2))
        if time.time()-started>238:break

    diag=best[3] if best else {}
    diag_count=len(best[1]) if best else 0
    diag_width=diag.get('stripWidthMm')
    msg='Sparrow no logró una placa productiva en los intentos acotados'
    if diag_count:
        msg+=f'. Mejor intento: {diag_count} completas en {diag_width:.1f} mm de largo' if isinstance(diag_width,(int,float)) else f'. Mejor intento: {diag_count} completas'
    return jsonify(ok=False,error=msg,engine='Sparrow industrial + V1.7',bestDiagnosticComplete=diag_count,
        bestDiagnosticDensity=float(diag.get('density') or 0),bestStripWidthMm=diag_width,attempts=attempts,
        candidatePool=len(kits),rejectedCount=len(rejected),rejected=rejected[:8],elapsedSeconds=round(time.time()-started,2)),422
