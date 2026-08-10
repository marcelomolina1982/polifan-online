from extended_app import app, _kit_valid_for_plate
from app import _n, svg_to_geometry
from flask import request, jsonify
from shapely.geometry import Polygon, MultiPolygon
import json, os, subprocess, tempfile, time

SPARROW_BIN=os.environ.get('SPARROW_BIN','/usr/local/bin/sparrow')
PLATE_WIDTH_MM=1220.0
PLATE_HEIGHT_MM=580.0
PLATE_AREA_MM2=PLATE_WIDTH_MM*PLATE_HEIGHT_MM
MIN_COMPLETE=10
HIGH_DENSITY_COMPLETE=9
HIGH_DENSITY_MIN=72.0
TARGET_DENSITY=80.0
PARTIAL_EXTRA_MIN_DENSITY=85.0
MAX_COMPLETE=16
ANGLES_15=[float(a) for a in range(0,360,15)]
TOTAL_BUDGET_SECONDS=245


def _priority(k): return _n(k.get('priority'),999999)

def _coords(poly):
    pts=[[float(x),float(y)] for x,y in list(poly.exterior.coords)]
    if len(pts)>1 and pts[0]==pts[-1]: pts=pts[:-1]
    return pts

def _shape(geom):
    if isinstance(geom,Polygon): return {'type':'simple_polygon','data':_coords(geom)}
    if isinstance(geom,MultiPolygon):
        data=[{'outer':_coords(g),'inner':[]} for g in geom.geoms if not g.is_empty and g.area>0]
        if not data: raise ValueError('multipolígono vacío')
        return {'type':'multi_polygon','data':data}
    geoms=[g for g in getattr(geom,'geoms',[]) if isinstance(g,Polygon) and not g.is_empty]
    if len(geoms)==1: return {'type':'simple_polygon','data':_coords(geoms[0])}
    if geoms: return {'type':'multi_polygon','data':[{'outer':_coords(g),'inner':[]} for g in geoms]}
    raise ValueError('geometría no soportada por Sparrow')

def _prep_part(part,kit_id,figure):
    wcm=_n(part.get('sourceWidthCm') or part.get('widthCm')); hcm=_n(part.get('sourceHeightCm') or part.get('heightCm'))
    geom,trimx,trimy=svg_to_geometry(part.get('svgText') or '',wcm,hcm,solver_tolerance_mm=.22,max_vertices=320)
    if geom.is_empty: raise ValueError('geometría vacía')
    if not geom.is_valid: geom=geom.buffer(0)
    minx,miny,maxx,maxy=geom.bounds; envelope=max(1.0,(maxx-minx)*(maxy-miny))
    return {'instanceId':str(part.get('instanceId') or ''),'kitId':str(kit_id),'figure':str(figure),'name':str(part.get('name') or ''),'role':str(part.get('role') or 'simple'),'geom':geom,'shape':_shape(geom),'trimXmm':float(trimx),'trimYmm':float(trimy),'area':float(geom.area or 0),'envelope':float(envelope)}

def _prep_kit(kit,width_mm,height_mm):
    valid,detail=_kit_valid_for_plate(kit,width_mm,height_mm)
    if not valid: raise ValueError(str(detail))
    kid=str(kit.get('kitId') or ''); fig=str(kit.get('figure') or '')
    parts=[_prep_part(p,kid,fig) for p in (kit.get('parts') or [])]
    if not parts: raise ValueError('sin componentes')
    area=sum(p['area'] for p in parts); envelope=sum(p['envelope'] for p in parts)
    return {'kitId':kid,'figure':fig,'priority':_priority(kit),'parts':parts,'area':area,'envelope':envelope,'solidity':area/max(1.0,envelope)}

def _unique_rows(rows):
    seen=set(); out=[]
    for k in rows:
        if k['kitId'] in seen: continue
        seen.add(k['kitId']); out.append(k)
    return out

def _balanced_selection(kits,target,urgent_ratio=.58):
    if len(kits)<target:return []
    urgent_count=min(target,max(5,int(round(target*urgent_ratio))))
    head=kits[:urgent_count]; tail=kits[urgent_count:32]
    dense=sorted(tail,key=lambda k:(-k['area'],-k['solidity'],k['priority']))
    return _unique_rows(head+dense)[:target]

def _compact_selection(kits,target,urgent_ratio=.58):
    if len(kits)<target:return []
    urgent_count=min(target,max(5,int(round(target*urgent_ratio))))
    head=kits[:urgent_count]; tail=kits[urgent_count:32]
    compact=sorted(tail,key=lambda k:(-k['solidity'],k['envelope'],-k['area'],k['priority']))
    return _unique_rows(head+compact)[:target]

def _candidate_selections(kits,target):
    """Selecciones distintas sobre EL ESTADO PENDIENTE ACTUAL. Nunca presupone que kits[:10] deba entrar."""
    variants=[]
    def add(label,rows):
        rows=_unique_rows(rows)[:target]
        if len(rows)!=target:return
        sig=tuple(k['kitId'] for k in rows)
        if any(sig==s for _,_,s in variants):return
        variants.append((label,rows,sig))
    add('prioridad pura',kits[:target])
    add('prioridad + área',_balanced_selection(kits,target,.60))
    add('prioridad + compactas',_compact_selection(kits,target,.60))
    add('prioridad flexible + área',_balanced_selection(kits,target,.45))
    add('prioridad flexible + compactas',_compact_selection(kits,target,.45))
    # Ventanas desplazadas: conserva urgencia global pero evita que una figura grande bloquee siempre las mismas diez.
    pool=kits[:min(24,len(kits))]
    for off in (1,2,3,4):
        if len(pool)>=target+off:
            add(f'rescate desplazado {off}',pool[:5]+pool[5+off:5+off+(target-5)])
    return [(a,b) for a,b,_ in variants]

def _selection_density(rows,extra_part=None):
    area=sum(k['area'] for k in rows)+(float(extra_part.get('area') or 0) if extra_part else 0)
    return 100.0*area/PLATE_AREA_MM2 if rows or extra_part else 0.0

def _run_sparrow(selected,gap_mm,seconds,seed,continuous=False,extra_part=None):
    started=time.time(); items=[]; idmap={}; item_id=0
    for kit in selected:
        for part in kit['parts']:
            row={'id':item_id,'demand':1,'shape':part['shape']}
            if not continuous: row['allowed_orientations']=ANGLES_15
            items.append(row); idmap[item_id]=(part,False); item_id+=1
    if extra_part is not None:
        row={'id':item_id,'demand':1,'shape':extra_part['shape']}
        if not continuous: row['allowed_orientations']=ANGLES_15
        items.append(row); idmap[item_id]=(extra_part,True); item_id+=1
    instance={'name':'polifan','items':items,'strip_height':PLATE_HEIGHT_MM}
    with tempfile.TemporaryDirectory(prefix='polifan-sparrow-') as td:
        inp=os.path.join(td,'input.json')
        with open(inp,'w',encoding='utf-8') as f: json.dump(instance,f,separators=(',',':'))
        cmd=[SPARROW_BIN,'-i',inp,'-t',str(int(seconds)),'--min-item-separation',str(float(gap_mm)),'--workers','1','-s',str(int(seed))]
        try: proc=subprocess.run(cmd,cwd=td,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=seconds+20)
        except subprocess.TimeoutExpired as exc: return {'ok':False,'error':'Sparrow excedió su tiempo interno','log':(exc.stdout or '')[-1600:] if isinstance(exc.stdout,str) else ''}
        outpath=os.path.join(td,'output','final_polifan.json')
        if proc.returncode!=0 or not os.path.exists(outpath): return {'ok':False,'error':f'Sparrow terminó con código {proc.returncode}','log':(proc.stdout or '')[-2000:]}
        with open(outpath,'r',encoding='utf-8') as f: result=json.load(f)
    sol=result.get('solution') or {}; strip_width=float(sol.get('strip_width') or 1e18); placed=((sol.get('layout') or {}).get('placed_items') or [])
    placements=[]
    for row in placed:
        mapped=idmap.get(int(row.get('item_id')))
        if not mapped: continue
        part,is_partial=mapped; tr=row.get('transformation') or {}; tx,ty=(tr.get('translation') or [0,0])[:2]
        placements.append({'instanceId':part['instanceId'],'kitId':part['kitId'],'figure':part['figure'],'name':part['name'],'role':part['role'],'xCm':float(tx)/10.0,'yCm':float(ty)/10.0,'angle':float(tr.get('rotation') or 0),'trimXCm':part['trimXmm']/10.0,'trimYCm':part['trimYmm']/10.0,'partialExtra':bool(is_partial)})
    density=_selection_density(selected,extra_part); fits=len(placements)==len(items) and strip_width<=PLATE_WIDTH_MM+0.5
    return {'ok':True,'fits':fits,'stripWidthMm':strip_width,'density':density,'placements':placements,'elapsedSeconds':round(time.time()-started,2),'solverDensity':float(sol.get('density') or 0)*100.0,'runTimeSec':sol.get('run_time_sec'),'placedParts':len(placements),'expectedParts':len(items),'continuousRotation':bool(continuous),'hasPartialExtra':extra_part is not None}

def _production_ready(target,result): return bool(result.get('fits')) and (target>=MIN_COMPLETE or (target==HIGH_DENSITY_COMPLETE and float(result.get('density') or 0)>=HIGH_DENSITY_MIN))
def _score(target,result): return (float(result.get('density') or 0),target,-float(result.get('stripWidthMm') or 1e18))

def _result_payload(selected,label,result,kits,rejected,attempts,started,extra_part=None):
    target=len(selected); partial_payload=None
    if extra_part is not None: partial_payload={'kitId':extra_part['kitId'],'figure':extra_part['figure'],'component':extra_part['role'],'instanceId':extra_part['instanceId'],'name':extra_part['name']}
    return jsonify(ok=True,engine='Sparrow selector dinámico + V1.7',completeFigures=target,placements=result['placements'],density=result['density'],stripWidthMm=result['stripWidthMm'],rotationStep=('continua' if result.get('continuousRotation') else 15),source='sparrow-jagua-rs',selectionStrategy=label,productionReady=True,reachedMinimum=target>=10,highDensityException=target==9,targetDensity=TARGET_DENSITY,targetDensityReached=float(result.get('density') or 0)>=TARGET_DENSITY,partialExtra=partial_payload,partialExtraAllowed=bool(partial_payload and target>=10 and float(result.get('density') or 0)>PARTIAL_EXTRA_MIN_DENSITY),candidatePool=len(kits),rejectedCount=len(rejected),rejected=rejected[:8],attempts=attempts,elapsedSeconds=round(time.time()-started,2))

@app.get('/nest-sparrow/health')
def nest_sparrow_health():
    exists=os.path.exists(SPARROW_BIN) and os.access(SPARROW_BIN,os.X_OK)
    return jsonify(ok=exists,engine='Sparrow selector dinámico + V1.7',binary=SPARROW_BIN,criterion='10+ buscando >=80%; extra base/tapa sólo si final >85%')

@app.post('/nest-sparrow')
def nest_sparrow():
    started=time.time(); data=request.get_json(silent=True) or {}
    if not os.path.exists(SPARROW_BIN): return jsonify(ok=False,error='El binario Sparrow no está instalado en Render'),503
    width_mm=max(1.0,_n(data.get('widthCm'),122)*10); height_mm=max(1.0,_n(data.get('heightCm'),58)*10)
    if abs(width_mm-PLATE_WIDTH_MM)>1 or abs(height_mm-PLATE_HEIGHT_MM)>1: return jsonify(ok=False,error='Sparrow producción está fijado a placa 1220×580 mm'),400
    gap=max(2.5,_n(data.get('gapCm'),.3)*10); requested_target=max(75.0,min(90.0,_n(data.get('targetDensity'),TARGET_DENSITY)))
    raw=sorted(data.get('kits') or [],key=lambda k:(_priority(k),str(k.get('date') or ''),str(k.get('figure') or '')))[:32]
    if not raw:return jsonify(ok=False,error='No llegaron figuras a Sparrow'),400
    kits=[]; rejected=[]
    for k in raw:
        try:kits.append(_prep_kit(k,width_mm,height_mm))
        except Exception as exc:rejected.append({'kitId':str(k.get('kitId') or ''),'figure':str(k.get('figure') or ''),'reason':str(exc)})
    if len(kits)<9:return jsonify(ok=False,error=f'Sólo hay {len(kits)} kits geométricos utilizables',rejected=rejected[:8]),422
    best=None; attempts=[]
    def consider(selected,label,result,extra_part=None):
        nonlocal best
        target=len(selected); attempts.append({'label':label,'target':target,'ok':result.get('ok'),'fits':result.get('fits'),'stripWidthMm':result.get('stripWidthMm'),'density':round(float(result.get('density') or 0),1),'rotation':('continua' if result.get('continuousRotation') else '15°'),'extra':bool(extra_part),'error':result.get('error')})
        if result.get('ok') and _production_ready(target,result):
            sc=_score(target,result)
            if best is None or sc>best[0]: best=(sc,selected,label,result,extra_part)

    # 1) BASE DINÁMICA. Prueba combinaciones distintas del pendiente ACTUAL; no fuerza kits[:10].
    base_variants=_candidate_selections(kits,10)
    for idx,(label,selected) in enumerate(base_variants):
        remaining=TOTAL_BUDGET_SECONDS-(time.time()-started)
        if remaining<32: break
        seconds=48 if idx==0 else 30
        seconds=max(24,min(seconds,int(remaining-18)))
        result=_run_sparrow(selected,gap,seconds,41+idx*97,continuous=False)
        consider(selected,f'base dinámica 10 · {label}',result)
        if best: break
    # Rescate continuo sobre variantes si todavía no apareció base.
    if best is None:
        for idx,(label,selected) in enumerate(base_variants[:5]):
            remaining=TOTAL_BUDGET_SECONDS-(time.time()-started)
            if remaining<26: break
            seconds=max(20,min(26,int(remaining-12)))
            result=_run_sparrow(selected,gap,seconds,701+idx*53,continuous=True)
            consider(selected,f'rescate dinámico 10 · {label} · rotación continua',result)
            if best: break
    if best and best[3].get('density',0)>=requested_target:
        return _result_payload(best[1],best[2],best[3],kits,rejected,attempts,started,best[4])

    # 2) CRECIMIENTO. Sólo reemplaza la base si realmente mejora.
    for target in range(min(MAX_COMPLETE,len(kits)),10,-1):
        remaining=TOTAL_BUDGET_SECONDS-(time.time()-started)
        if remaining<28: break
        for label,selected in _candidate_selections(kits,target)[:3]:
            remaining=TOTAL_BUDGET_SECONDS-(time.time()-started)
            if remaining<26: break
            theoretical=_selection_density(selected)
            if best and theoretical<=best[3].get('density',0)+0.15: continue
            seconds=max(18,min(25,int(remaining-12)))
            result=_run_sparrow(selected,gap,seconds,1100+target*37+len(attempts),continuous=True)
            consider(selected,f'{target} completas · {label} · optimización',result)
            if best and best[3].get('density',0)>=requested_target: break
        if best and best[3].get('density',0)>=requested_target: break

    # 3) Extra parcial, sólo después de 10+ y sólo si el resultado final supera 85%.
    if best and len(best[1])>=10 and float(best[3].get('density') or 0)<PARTIAL_EXTRA_MIN_DENSITY:
        selected_ids={k['kitId'] for k in best[1]}; candidates=[]
        for k in [k for k in kits if k['kitId'] not in selected_ids][:12]:
            for p in k['parts']:
                if p.get('role') in ('base','tapa'):
                    d=_selection_density(best[1],p)
                    if d>PARTIAL_EXTRA_MIN_DENSITY:candidates.append((d,k['priority'],p))
        candidates.sort(key=lambda x:(-x[0],x[1]))
        for idx,(_,_,part) in enumerate(candidates[:3]):
            remaining=TOTAL_BUDGET_SECONDS-(time.time()-started)
            if remaining<22: break
            result=_run_sparrow(best[1],gap,max(17,min(22,int(remaining-10))),1701+idx*31,continuous=True,extra_part=part)
            if result.get('ok') and result.get('fits') and float(result.get('density') or 0)>PARTIAL_EXTRA_MIN_DENSITY:
                consider(best[1],f'{len(best[1])} completas + 1 {part["role"]} extra · >85%',result,part); break

    if best is None and time.time()-started<TOTAL_BUDGET_SECONDS-26:
        for label,nine in _candidate_selections(kits,9)[:3]:
            result=_run_sparrow(nine,gap,22,2201+len(attempts)*17,continuous=False); consider(nine,f'9 completas · {label} · excepción alta ocupación',result)
            if best: break
    if best:return _result_payload(best[1],best[2],best[3],kits,rejected,attempts,started,best[4])
    return jsonify(ok=False,error='Sparrow probó combinaciones dinámicas del pendiente actual pero no encontró 10 completas válidas',engine='Sparrow selector dinámico + V1.7',attempts=attempts,candidatePool=len(kits),rejectedCount=len(rejected),rejected=rejected[:8],elapsedSeconds=round(time.time()-started,2)),422
