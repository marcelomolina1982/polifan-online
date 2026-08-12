from app import app, _n, svg_to_geometry, solve_knapsack_kits, solve_prefix
from flask import request, jsonify
from motor_definitivo_v7 import solve_svg_text
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


@app.post('/nest-v2')
def nest_v2():
    started=time.time()
    data=request.get_json(silent=True) or {}
    try:
        kits=data.get('kits') or []
        if not kits:
            return jsonify(ok=False,error='No llegaron figuras completas al motor industrial V2'),400

        width_mm=max(1.0,_n(data.get('widthCm'),122)*10)
        height_mm=max(1.0,_n(data.get('heightCm'),58)*10)
        spacing_mm=max(2.5,_n(data.get('gapCm'),.3)*10)
        kits=sorted(kits,key=lambda k:(_n(k.get('priority'),999999),str(k.get('date') or ''),str(k.get('figure') or '')))
        source_pool=kits[:min(32,len(kits))]

        safe_pool=[]
        rejected=[]
        for kit in source_pool:
            valid,detail=_kit_valid_for_plate(kit,width_mm,height_mm)
            if valid:
                safe_pool.append(kit)
            else:
                rejected.append({'kitId':str(kit.get('kitId') or ''),'figure':str(kit.get('figure') or ''),'reason':str(detail)})

        if not safe_pool:
            return jsonify(ok=False,error='Ninguna figura candidata tiene geometría/medidas utilizables',rejected=rejected[:12]),422

        attempts=[]
        best=None
        best_step=15
        best_source=''

        # Fase 1: KNAPSACK primero. A diferencia del flujo anterior, esta fase
        # puede entregar una base válida aunque BIN_PACKING no resuelva el prefijo.
        for step,seconds in ((15,12),(10,12),(5,12)):
            try:
                ks=solve_knapsack_kits(safe_pool,width_mm,height_mm,spacing_mm,seconds=seconds,rotation_step=step,simplify_mm=.38 if step>=15 else .30,max_vertices=165 if step>=15 else 190)
            except Exception as exc:
                ks={'ok':False,'error':str(exc)}
            attempts.append({'stage':f'knapsack-{step}','completeFigures':int((ks or {}).get('completeFigures',0) or 0),'ok':bool((ks or {}).get('ok')),'error':str((ks or {}).get('error') or '')[:180]})
            if _score_result(ks)>_score_result(best):
                best=ks; best_step=step; best_source='knapsack'
            if int((ks or {}).get('completeFigures',0) or 0)>=10:
                break

        # Si KNAPSACK no produjo ni un kit completo, probar kits individualmente.
        if _score_result(best)[0]<=0:
            for idx,kit in enumerate(safe_pool[:14]):
                try:
                    row=solve_prefix([kit],1,width_mm,height_mm,spacing_mm,seconds=3,rotation_step=15,simplify_mm=.38,max_vertices=165)
                except Exception as exc:
                    row={'feasible':False,'error':str(exc)}
                attempts.append({'stage':f'individual-{idx}','figure':str(kit.get('figure') or ''),'ok':bool((row or {}).get('feasible')),'error':str((row or {}).get('error') or '')[:160]})
                if _score_result(row)>_score_result(best):
                    best=row; best_step=15; best_source='individual'
                if row and row.get('feasible'):
                    break

        if _score_result(best)[0]<=0:
            return jsonify(ok=False,error='El motor no pudo colocar ni una figura completa válida',candidatePool=len(safe_pool),rejected=rejected[:10],attempts=attempts[-16:]),422

        # Fase 2: tomar los kits completos de la mejor base y crecer sin perderla.
        if best.get('completeKitIds'):
            selected_ids=set(str(x) for x in best.get('completeKitIds') or [])
            selected=[k for k in safe_pool if str(k.get('kitId')) in selected_ids]
        else:
            placement_ids=set(str(p.get('kitId') or '') for p in best.get('placements') or [])
            selected=[k for k in safe_pool if str(k.get('kitId')) in placement_ids]

        current_best=best
        current_step=best_step
        current_source=best_source
        selected_ids=set(str(k.get('kitId')) for k in selected)
        extras=[k for k in safe_pool if str(k.get('kitId')) not in selected_ids]

        # Intentar alcanzar primero 10 y luego hasta 14. Dos fallos seguidos detienen.
        failures=0
        for extra in extras:
            if time.time()-started>120 or failures>=2 or len(selected)>=14:
                break
            candidate=selected+[extra]
            try:
                row=solve_prefix(candidate,len(candidate),width_mm,height_mm,spacing_mm,seconds=6,rotation_step=10,simplify_mm=.30,max_vertices=190)
            except Exception as exc:
                row={'feasible':False,'error':str(exc)}
            attempts.append({'stage':f'grow-{len(candidate)}','figure':str(extra.get('figure') or ''),'ok':bool((row or {}).get('feasible')),'error':str((row or {}).get('error') or '')[:160]})
            if row and row.get('feasible'):
                selected=candidate
                current_best=row
                current_step=10
                current_source='bin-packing-growth'
                failures=0
            else:
                failures+=1

        normalized=_normalize_result(current_best,current_step,current_source)
        complete=normalized['completeFigures']
        return jsonify(
            ok=True,
            engine='PackingSolver Industrial V2 · KNAPSACK rescue + growth',
            **normalized,
            reachedMinimum=complete>=10,
            minimumTarget=min(10,len(safe_pool)),
            candidatePool=len(safe_pool),
            rejectedCount=len(rejected),
            rejected=rejected[:8],
            attempts=attempts[-20:],
            elapsedSeconds=round(time.time()-started,2),
        )
    except Exception as exc:
        return jsonify(ok=False,error=str(exc),engine='PackingSolver Industrial V2',elapsedSeconds=round(time.time()-started,2)),500
