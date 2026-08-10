from extended_app import app, _kit_valid_for_plate, _normalize_result
from app import _n, svg_to_geometry, solve_prefix
from flask import request, jsonify
import time


def _kit_area_mm2(kit):
    total=0.0
    try:
        for part in kit.get('parts') or []:
            wcm=_n(part.get('sourceWidthCm') or part.get('widthCm'))
            hcm=_n(part.get('sourceHeightCm') or part.get('heightCm'))
            if wcm<=0 or hcm<=0:
                continue
            geom,_,_=svg_to_geometry(part.get('svgText') or '',wcm,hcm,solver_tolerance_mm=.45,max_vertices=130)
            total+=float(geom.area or 0.0)
    except Exception:
        return 10**18
    return total if total>0 else 10**18


def _ids(kits):
    return tuple(str(k.get('kitId') or '') for k in kits)


def _candidate_sets(window,target):
    if len(window)<target:
        return []
    rows=[]
    seen=set()
    def add(combo,label):
        combo=list(combo)[:target]
        key=_ids(combo)
        if len(combo)==target and len(set(key))==target and key not in seen:
            seen.add(key); rows.append((combo,label))

    # 1) prioridad pura
    add(window[:target],'prioridad-pura')

    # 2) mezclas: conservar urgentes y completar con kits de menor área real
    for anchors in (8,6,4):
        anchors=min(anchors,target)
        fixed=window[:anchors]
        fixed_ids=set(_ids(fixed))
        rest=[k for k in window if str(k.get('kitId') or '') not in fixed_ids]
        rest=sorted(rest,key=lambda k:(k.get('_area',10**18),_n(k.get('priority'),999999)))
        add(fixed+rest[:target-anchors],f'{anchors}-urgentes+compactas')

    # 3) las más compactas dentro de la ventana urgente
    add(sorted(window,key=lambda k:(k.get('_area',10**18),_n(k.get('priority'),999999)))[:target],'compactas-ventana')

    # 4) balance prioridad/área: normaliza área aproximadamente por placa
    plate_area=1220.0*580.0
    balanced=sorted(window,key=lambda k:(_n(k.get('priority'),999999)*0.035)+(k.get('_area',10**18)/plate_area))
    add(balanced[:target],'balance-prioridad-area')
    return rows


def _solve_complete_set(combo,width_mm,height_mm,spacing_mm,seconds=7,step=15):
    try:
        return solve_prefix(combo,len(combo),width_mm,height_mm,spacing_mm,
                            seconds=seconds,rotation_step=step,
                            simplify_mm=.34 if step<=10 else .38,
                            max_vertices=185 if step<=10 else 165)
    except Exception as exc:
        return {'feasible':False,'error':str(exc)}


@app.post('/nest-v3')
def nest_v3():
    started=time.time()
    data=request.get_json(silent=True) or {}
    try:
        kits=data.get('kits') or []
        if not kits:
            return jsonify(ok=False,error='No llegaron figuras completas al Motor V3'),400

        width_mm=max(1.0,_n(data.get('widthCm'),122)*10)
        height_mm=max(1.0,_n(data.get('heightCm'),58)*10)
        spacing_mm=max(2.5,_n(data.get('gapCm'),.3)*10)
        kits=sorted(kits,key=lambda k:(_n(k.get('priority'),999999),str(k.get('date') or ''),str(k.get('figure') or '')))
        source_pool=kits[:min(32,len(kits))]

        safe=[]; rejected=[]
        for kit in source_pool:
            valid,detail=_kit_valid_for_plate(kit,width_mm,height_mm)
            if valid:
                row=dict(kit); row['_area']=_kit_area_mm2(kit); safe.append(row)
            else:
                rejected.append({'kitId':str(kit.get('kitId') or ''),'figure':str(kit.get('figure') or ''),'reason':str(detail)})
        if not safe:
            return jsonify(ok=False,error='Ningún kit completo tiene geometría utilizable',rejected=rejected[:10]),422

        # Ventana suficientemente amplia para cambiar figuras grandes por rellenos compactos,
        # pero acotada para mantener prioridad de entrega.
        window=safe[:min(24,len(safe))]
        attempts=[]; best=None; best_combo=None; best_label=''; best_step=15

        # Primero exigimos 10 kits COMPLETOS. Nunca se optimizan base/tapa por separado.
        target=min(10,len(window))
        if target>=10:
            for combo,label in _candidate_sets(window,10):
                if time.time()-started>105: break
                row=_solve_complete_set(combo,width_mm,height_mm,spacing_mm,seconds=7,step=15)
                attempts.append({'target':10,'strategy':label,'ok':bool(row.get('feasible')),'placed':int(row.get('placedCount',0) or 0),'error':str(row.get('error') or '')[:140]})
                if row.get('feasible'):
                    best=row; best_combo=combo; best_label=label; best_step=15
                    break

            # Si 15° no encontró 10, micro-rotación 10° sobre las dos combinaciones más prometedoras.
            if not best:
                for combo,label in _candidate_sets(window,10)[:3]:
                    if time.time()-started>120: break
                    row=_solve_complete_set(combo,width_mm,height_mm,spacing_mm,seconds=8,step=10)
                    attempts.append({'target':10,'strategy':label+'-10deg','ok':bool(row.get('feasible')),'placed':int(row.get('placedCount',0) or 0),'error':str(row.get('error') or '')[:140]})
                    if row.get('feasible'):
                        best=row; best_combo=combo; best_label=label+'-10deg'; best_step=10
                        break

        # Sólo si 10 de verdad no fue resuelto, bajar gradualmente. Sigue siendo kit completo.
        if not best:
            for fallback_target in (9,8,7,6,5,4,3,2,1):
                if fallback_target>len(window): continue
                combos=_candidate_sets(window,fallback_target)
                for combo,label in combos[:3]:
                    if time.time()-started>145: break
                    row=_solve_complete_set(combo,width_mm,height_mm,spacing_mm,seconds=5,step=15)
                    attempts.append({'target':fallback_target,'strategy':label,'ok':bool(row.get('feasible')),'placed':int(row.get('placedCount',0) or 0),'error':str(row.get('error') or '')[:140]})
                    if row.get('feasible'):
                        best=row; best_combo=combo; best_label=label; best_step=15
                        break
                if best: break

        if not best or not best.get('feasible'):
            return jsonify(ok=False,error='V3 no encontró un conjunto completo colocable',candidatePool=len(safe),rejected=rejected[:8],attempts=attempts[-24:]),422

        # Si ya logramos 10, intentar crecer 11..14 sin perder la placa válida.
        selected=list(best_combo or [])
        current_best=best
        current_label=best_label
        failures=0
        selected_ids=set(_ids(selected))
        extras=[k for k in window if str(k.get('kitId') or '') not in selected_ids]
        for extra in extras:
            if len(selected)>=14 or failures>=3 or time.time()-started>155: break
            candidate=selected+[extra]
            row=_solve_complete_set(candidate,width_mm,height_mm,spacing_mm,seconds=5,step=10)
            attempts.append({'target':len(candidate),'strategy':'crecimiento','figure':str(extra.get('figure') or ''),'ok':bool(row.get('feasible')),'placed':int(row.get('placedCount',0) or 0)})
            if row.get('feasible'):
                selected=candidate; current_best=row; current_label='crecimiento-kit-completo'; best_step=10; failures=0
            else:
                failures+=1

        normalized=_normalize_result(current_best,best_step,'complete-kit-search')
        complete=int(normalized.get('completeFigures',0) or 0)
        return jsonify(ok=True,
            engine='PackingSolver V3 · kits completos indivisibles + V1.7 certifier',
            **normalized,
            reachedMinimum=complete>=10,
            minimumTarget=min(10,len(safe)),
            candidatePool=len(safe),
            selectionStrategy=current_label,
            rejectedCount=len(rejected),
            rejected=rejected[:8],
            attempts=attempts[-24:],
            elapsedSeconds=round(time.time()-started,2))
    except Exception as exc:
        return jsonify(ok=False,error=str(exc),engine='PackingSolver V3',elapsedSeconds=round(time.time()-started,2)),500
