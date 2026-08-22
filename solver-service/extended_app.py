from app import app, _n, svg_to_geometry, solve_knapsack_kits, solve_prefix
from flask import request, jsonify
from motor_definitivo_v7 import solve_svg_text
from itertools import combinations
import time

@app.get('/motor-definitivo/health')
def motor_definitivo_health():
    return jsonify(ok=True,engine='Motor Polifan Definitivo V1.7',mode='test',preferredGapMm=3.0,absoluteMinGapMm=2.5)

@app.post('/motor-definitivo/svg')
def motor_definitivo_svg():
    data=request.get_json(silent=True) or {}
    svg_text=data.get('svgText') or ''
    if not svg_text.strip():
        return jsonify(ok=False,error='Falta svgText'),400
    if len(svg_text)>8_000_000:
        return jsonify(ok=False,error='SVG demasiado grande para el modo de prueba'),413
    filename=str(data.get('filename') or 'placa.svg')
    try:
        seconds3=max(1.0,min(20.0,float(data.get('seconds3') or 8.0)))
        seconds25=max(1.0,min(30.0,float(data.get('seconds25') or 14.0)))
        result=solve_svg_text(svg_text,filename,seconds3,seconds25)
        certified=str(result.get('status','')).startswith('CERTIFICADO')
        return jsonify(ok=certified,engine='Motor Polifan Definitivo V1.7',**result),(200 if certified else 422)
    except Exception as exc:
        return jsonify(ok=False,error=str(exc),engine='Motor Polifan Definitivo V1.7'),500


def _kit_valid_for_plate(kit,width_mm,height_mm):
    diagnostics=[]
    try:
        parts=kit.get('parts') or []
        if not parts:
            return False,'sin componentes'
        for part in parts:
            wcm=_n(part.get('sourceWidthCm') or part.get('widthCm'))
            hcm=_n(part.get('sourceHeightCm') or part.get('heightCm'))
            if wcm<=0 or hcm<=0:
                return False,f"medidas inválidas {wcm}x{hcm} cm"
            geom,_,_=svg_to_geometry(part.get('svgText') or '',wcm,hcm,solver_tolerance_mm=.38,max_vertices=165)
            minx,miny,maxx,maxy=geom.bounds
            gw=maxx-minx; gh=maxy-miny
            diagnostics.append((gw,gh))
            if min(gw,gh)>min(width_mm,height_mm) or max(gw,gh)>max(width_mm,height_mm):
                return False,f"pieza {gw/10:.1f}x{gh/10:.1f} cm no entra"
        return True,diagnostics
    except Exception as exc:
        return False,str(exc)


def _score_result(row):
    if not row:
        return (-1,-1,-1)
    if row.get('feasible'):
        count=int(row.get('target',0) or 0)
    elif row.get('ok'):
        count=int(row.get('completeFigures',0) or 0)
    else:
        count=0
    return (count,float(row.get('density',0) or 0),float(row.get('compactness',0) or 0))


def _normalize_result(row,rotation_step,source):
    if row.get('feasible'):
        complete=int(row.get('target',0) or 0)
    else:
        complete=int(row.get('completeFigures',0) or 0)
    return {
        'completeFigures':complete,
        'placements':row.get('placements') or [],
        'density':float(row.get('density',0) or 0),
        'compactness':float(row.get('compactness',0) or 0),
        'usedWidthMm':float(row.get('usedWidthMm',0) or 0),
        'usedHeightMm':float(row.get('usedHeightMm',0) or 0),
        'rotationStep':rotation_step,
        'source':source,
    }


def _kit_box_area(kit):
    area=0.0
    for p in kit.get('parts') or []:
        w=max(0.0,_n(p.get('sourceWidthCm') or p.get('widthCm'))*10)
        h=max(0.0,_n(p.get('sourceHeightCm') or p.get('heightCm'))*10)
        area+=w*h
    return area


def _kit_priority(kit):
    return _n(kit.get('priority'),999999)


def _extract_selected(best,safe_pool):
    if best.get('completeKitIds'):
        ids=set(str(x) for x in best.get('completeKitIds') or [])
    else:
        ids=set(str(p.get('kitId') or '') for p in best.get('placements') or [])
    return [k for k in safe_pool if str(k.get('kitId')) in ids]


def _solve_candidate(candidate,width_mm,height_mm,spacing_mm,seconds=5,step=10):
    try:
        return solve_prefix(candidate,len(candidate),width_mm,height_mm,spacing_mm,
                            seconds=seconds,rotation_step=step,
                            simplify_mm=.28 if step<=5 else .30,
                            max_vertices=210 if step<=5 else 190)
    except Exception as exc:
        return {'feasible':False,'error':str(exc)}


def _lns_grow(selected,safe_pool,width_mm,height_mm,spacing_mm,attempts,started,budget_seconds=165,max_complete=15):
    """Large Neighborhood Search orientado al problema real del taller.

    Si una figura extra no entra, no se limita a buscar el hueco existente:
    destruye localmente 1, 2 o 3 kits completos, agrega 2, 3 o 4 candidatos
    respectivamente y vuelve a empaquetar TODO ese microconjunto. Así puede
    mover/rotar varias figuras para crear un hueco nuevo y crecer N -> N+1.

    Siempre conserva la mejor placa válida ya encontrada.
    """
    selected=list(selected)
    current=None
    current_step=10
    current_source='lns-seed'
    if selected:
        current=_solve_candidate(selected,width_mm,height_mm,spacing_mm,seconds=4,step=10)
        if not current.get('feasible'):
            current=None

    tries=0
    while selected and len(selected)<min(max_complete,len(safe_pool)) and time.time()-started<budget_seconds:
        selected_ids={str(k.get('kitId')) for k in selected}
        extras=[k for k in safe_pool if str(k.get('kitId')) not in selected_ids]
        if not extras:
            break

        # Candidatos chicos/urgentes primero: suelen ser los que mejor rellenan,
        # pero no se excluyen los grandes porque a veces destraban otra orientación.
        extras=sorted(extras,key=lambda k:(_kit_priority(k),_kit_box_area(k)))[:10]
        removable=sorted(selected,key=lambda k:(-_kit_priority(k),-_kit_box_area(k)))[:8]
        improved=False

        # Intento directo N+1 con rotación más fina antes de destruir vecindario.
        for extra in extras[:4]:
            if time.time()-started>=budget_seconds: break
            candidate=selected+[extra]
            row=_solve_candidate(candidate,width_mm,height_mm,spacing_mm,seconds=5,step=5)
            tries+=1
            attempts.append({'stage':f'lns-direct-{len(candidate)}','destroy':0,'add':1,
                             'figure':str(extra.get('figure') or ''),'ok':bool(row.get('feasible')),
                             'error':str(row.get('error') or '')[:150]})
            if row.get('feasible'):
                selected=candidate; current=row; current_step=5; current_source='revolution-direct-repack'
                improved=True; break
        if improved:
            continue

        # Destruir 1..3 kits y agregar r+1: objetivo neto +1.
        for destroy in (1,2,3):
            if improved or time.time()-started>=budget_seconds: break
            if len(removable)<destroy or len(extras)<destroy+1: continue
            remove_sets=list(combinations(removable,destroy))[:6]
            add_sets=list(combinations(extras,destroy+1))[:10]
            for rem in remove_sets:
                if improved or time.time()-started>=budget_seconds: break
                rem_ids={str(k.get('kitId')) for k in rem}
                base=[k for k in selected if str(k.get('kitId')) not in rem_ids]
                for add in add_sets:
                    if time.time()-started>=budget_seconds: break
                    candidate=base+list(add)
                    if len({str(k.get('kitId')) for k in candidate})!=len(candidate):
                        continue
                    # Presupuesto pequeño por variante; el valor está en explorar
                    # distintas topologías, no en dejar una sola combinación minutos.
                    row=_solve_candidate(candidate,width_mm,height_mm,spacing_mm,
                                         seconds=4 if destroy<3 else 5,step=5)
                    tries+=1
                    attempts.append({'stage':f'lns-{len(selected)}-to-{len(candidate)}',
                                     'destroy':destroy,'add':destroy+1,
                                     'removed':[str(k.get('figure') or '') for k in rem],
                                     'added':[str(k.get('figure') or '') for k in add],
                                     'ok':bool(row.get('feasible')),
                                     'error':str(row.get('error') or '')[:130]})
                    if row.get('feasible'):
                        selected=candidate; current=row; current_step=5
                        current_source=f'revolution-lns-move-{destroy}'
                        improved=True; break
        if not improved:
            break

    return selected,current,current_step,current_source,tries


@app.post('/nest-v2')
def nest_v2():
    started=time.time()
    data=request.get_json(silent=True) or {}
    try:
        kits=data.get('kits') or []
        if not kits:
            return jsonify(ok=False,error='No llegaron figuras completas al motor revolucionario V3'),400

        width_mm=max(1.0,_n(data.get('widthCm'),122)*10)
        height_mm=max(1.0,_n(data.get('heightCm'),58)*10)
        spacing_mm=max(2.5,_n(data.get('gapCm'),.3)*10)
        kits=sorted(kits,key=lambda k:(_n(k.get('priority'),999999),str(k.get('date') or ''),str(k.get('figure') or '')))
        source_pool=kits[:min(36,len(kits))]

        safe_pool=[]
        rejected=[]
        for kit in source_pool:
            valid,detail=_kit_valid_for_plate(kit,width_mm,height_mm)
            if valid:
                safe_pool.append(kit)
            else:
                rejected.append({'kitId':str(k.get('kitId') or ''),'figure':str(k.get('figure') or ''),'reason':str(detail)})

        if not safe_pool:
            return jsonify(ok=False,error='Ninguna figura candidata tiene geometría/medidas utilizables',rejected=rejected[:12]),422

        attempts=[]
        best=None
        best_step=15
        best_source=''

        # Fase 1: rescate global. Tres escalas de rotación para no depender de una
        # única orientación inicial. Guarda siempre la mejor placa válida.
        for step,seconds in ((15,10),(10,10),(5,14)):
            try:
                ks=solve_knapsack_kits(safe_pool,width_mm,height_mm,spacing_mm,
                                       seconds=seconds,rotation_step=step,
                                       simplify_mm=.38 if step>=15 else (.32 if step==10 else .28),
                                       max_vertices=165 if step>=15 else (190 if step==10 else 210))
            except Exception as exc:
                ks={'ok':False,'error':str(exc)}
            attempts.append({'stage':f'global-{step}','completeFigures':int((ks or {}).get('completeFigures',0) or 0),
                             'ok':bool((ks or {}).get('ok')),'error':str((ks or {}).get('error') or '')[:180]})
            if _score_result(ks)>_score_result(best):
                best=ks; best_step=step; best_source='global-knapsack'
            if int((ks or {}).get('completeFigures',0) or 0)>=11:
                break

        if _score_result(best)[0]<=0:
            for idx,kit in enumerate(safe_pool[:14]):
                row=_solve_candidate([kit],width_mm,height_mm,spacing_mm,seconds=3,step=15)
                attempts.append({'stage':f'individual-{idx}','figure':str(kit.get('figure') or ''),
                                 'ok':bool(row.get('feasible')),'error':str(row.get('error') or '')[:160]})
                if _score_result(row)>_score_result(best):
                    best=row; best_step=15; best_source='individual'
                if row.get('feasible'): break

        if _score_result(best)[0]<=0:
            return jsonify(ok=False,error='El motor no pudo colocar ni una figura completa válida',candidatePool=len(safe_pool),rejected=rejected[:10],attempts=attempts[-24:]),422

        selected=_extract_selected(best,safe_pool)
        current_best=best
        current_step=best_step
        current_source=best_source

        # Fase 2: crecimiento simple, pero sin abandonar después de dos fallos.
        selected_ids={str(k.get('kitId')) for k in selected}
        extras=[k for k in safe_pool if str(k.get('kitId')) not in selected_ids]
        simple_failures=0
        for extra in extras[:8]:
            if time.time()-started>75 or len(selected)>=15: break
            candidate=selected+[extra]
            row=_solve_candidate(candidate,width_mm,height_mm,spacing_mm,seconds=5,step=10)
            attempts.append({'stage':f'grow-{len(candidate)}','figure':str(extra.get('figure') or ''),
                             'ok':bool(row.get('feasible')),'error':str(row.get('error') or '')[:150]})
            if row.get('feasible'):
                selected=candidate; current_best=row; current_step=10; current_source='simple-growth'; simple_failures=0
            else:
                simple_failures+=1
            if simple_failures>=4: break

        # Fase 3: REVOLUCIONARIA. Si N+1 no entra en el hueco actual, libera 1,
        # 2 o 3 kits y vuelve a colocar todo el microsector. Es exactamente el
        # caso observado manualmente: para pasar de 10 a 11 a veces hay que mover
        # varias figuras, no sólo buscar un hueco residual.
        lns_selected,lns_best,lns_step,lns_source,lns_tries=_lns_grow(
            selected,safe_pool,width_mm,height_mm,spacing_mm,attempts,started,
            budget_seconds=170,max_complete=15)
        if lns_best is not None and _score_result(lns_best)>=_score_result(current_best):
            selected=lns_selected; current_best=lns_best; current_step=lns_step; current_source=lns_source

        normalized=_normalize_result(current_best,current_step,current_source)
        complete=normalized['completeFigures']
        return jsonify(
            ok=True,
            engine='Polifan Revolution V3 · Global Search + Large Neighborhood Repack',
            **normalized,
            reachedMinimum=complete>=10,
            minimumTarget=min(10,len(safe_pool)),
            candidatePool=len(safe_pool),
            rejectedCount=len(rejected),
            rejected=rejected[:8],
            lnsAttempts=lns_tries,
            canReturnBelow10=True,
            strategy='keep-best + rotate-5deg + destroy/repack-1-3-kits',
            attempts=attempts[-40:],
            elapsedSeconds=round(time.time()-started,2),
        )
    except Exception as exc:
        return jsonify(ok=False,error=str(exc),engine='Polifan Revolution V3',elapsedSeconds=round(time.time()-started,2)),500
