from extended_app import app, _kit_valid_for_plate, _normalize_result
from app import _n, svg_to_geometry, solve_prefix
from flask import request, jsonify
import time


MIN_COMPLETE=10
MAX_COMPLETE=14
DEEP_SEARCH_SECONDS=142
TOTAL_BUDGET_SECONDS=168


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


def _priority(k):
    return _n(k.get('priority'),999999)


def _area(k):
    return k.get('_area',10**18)


def _candidate_sets(window,target):
    if len(window)<target:
        return []
    rows=[]
    seen=set()

    def add(combo,label):
        combo=list(combo)[:target]
        key=tuple(sorted(_ids(combo)))
        if len(combo)==target and len(set(_ids(combo)))==target and key not in seen:
            seen.add(key)
            rows.append((combo,label))

    # Prioridad pura y compactación global.
    add(window[:target],'prioridad-pura')
    add(sorted(window,key=lambda k:(_area(k),_priority(k)))[:target],'compactas-global')

    # Mantiene distintas cantidades de urgentes y rellena con piezas compactas.
    for anchors in (9,8,7,6,5,4,3,2):
        if anchors>=target:
            continue
        fixed=window[:anchors]
        fixed_ids=set(_ids(fixed))
        rest=[k for k in window if str(k.get('kitId') or '') not in fixed_ids]
        compact=sorted(rest,key=lambda k:(_area(k),_priority(k)))
        add(fixed+compact[:target-anchors],f'{anchors}-urgentes+compactas')

    # Barrido por ventanas desplazadas: evita quedar atrapado en las primeras figuras grandes.
    for start in (1,2,3,4,5,6,8,10):
        if start+target<=len(window):
            add(window[start:start+target],f'ventana-{start+1}-{start+target}')

    # Balance prioridad/área con varios pesos.
    plate_area=1220.0*580.0
    for weight in (.012,.02,.035,.055,.08):
        balanced=sorted(window,key=lambda k:(_priority(k)*weight)+(_area(k)/plate_area))
        add(balanced[:target],f'balance-{weight:.3f}')

    # Semillas alternadas entre urgentes y compactas.
    urgent=list(window)
    compact=sorted(window,key=lambda k:(_area(k),_priority(k)))
    for offset in (0,1,2,3):
        mixed=[]; used=set(); i=offset; j=0
        while len(mixed)<target and (i<len(urgent) or j<len(compact)):
            for source,idx in ((urgent,i),(compact,j)):
                if idx<len(source):
                    kid=str(source[idx].get('kitId') or '')
                    if kid and kid not in used:
                        used.add(kid); mixed.append(source[idx])
                        if len(mixed)>=target: break
            i+=1; j+=1
        add(mixed,f'alternada-{offset}')

    return rows


def _order_variants(combo):
    variants=[]; seen=set()
    def add(items,label):
        key=_ids(items)
        if key not in seen:
            seen.add(key); variants.append((list(items),label))
    add(combo,'orden-original')
    add(sorted(combo,key=lambda k:(-_area(k),_priority(k))),'grandes-primero')
    add(sorted(combo,key=lambda k:(_area(k),_priority(k))),'chicas-primero')
    add(sorted(combo,key=lambda k:(_priority(k),-_area(k))),'urgencia-grande')
    if len(combo)>2:
        add(combo[::2]+combo[1::2],'intercalado')
        add(list(reversed(combo)),'invertido')
    return variants


def _solve_complete_set(combo,width_mm,height_mm,spacing_mm,seconds=7,step=15):
    try:
        simplify=.28 if step<=5 else (.32 if step<=10 else .38)
        vertices=220 if step<=5 else (195 if step<=10 else 165)
        return solve_prefix(combo,len(combo),width_mm,height_mm,spacing_mm,
                            seconds=seconds,rotation_step=step,
                            simplify_mm=simplify,max_vertices=vertices)
    except Exception as exc:
        return {'feasible':False,'error':str(exc)}


def _attempt_score(row):
    return (1 if row.get('feasible') else 0,
            int(row.get('placedCount',0) or 0),
            float(row.get('density',0) or 0))


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
        kits=sorted(kits,key=lambda k:(_priority(k),str(k.get('date') or ''),str(k.get('figure') or '')))
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

        # Ventana amplia: el motor puede cambiar figuras grandes por otras compactas sin ignorar urgencia.
        window=safe[:min(30,len(safe))]
        attempts=[]; best=None; best_combo=None; best_label=''; best_step=15
        ranked=[]

        # ETAPA INDUSTRIAL: 10 completas es una condición de producción, no una preferencia.
        if len(window)>=MIN_COMPLETE:
            candidates=_candidate_sets(window,MIN_COMPLETE)

            # Fase 1: barrido amplio, 15 grados, muchos conjuntos y varios órdenes.
            for combo,label in candidates:
                if time.time()-started>78: break
                local_best=None
                for ordered,order_label in _order_variants(combo)[:3]:
                    if time.time()-started>78: break
                    row=_solve_complete_set(ordered,width_mm,height_mm,spacing_mm,seconds=4,step=15)
                    attempts.append({'target':MIN_COMPLETE,'strategy':label,'order':order_label,'step':15,'ok':bool(row.get('feasible')),'placed':int(row.get('placedCount',0) or 0),'error':str(row.get('error') or '')[:120]})
                    if local_best is None or _attempt_score(row)>_attempt_score(local_best[0]):
                        local_best=(row,ordered,order_label)
                    if row.get('feasible'):
                        best=row; best_combo=ordered; best_label=f'{label}/{order_label}'; best_step=15
                        break
                if local_best:
                    ranked.append((local_best[0],local_best[1],f'{label}/{local_best[2]}'))
                if best: break

            # Fase 2: sólo los candidatos que más cerca estuvieron, ahora a 10 grados.
            if not best:
                ranked=sorted(ranked,key=lambda x:_attempt_score(x[0]),reverse=True)
                shortlist=[]; seen=set()
                for row,combo,label in ranked:
                    key=tuple(sorted(_ids(combo)))
                    if key in seen: continue
                    seen.add(key); shortlist.append((combo,label))
                    if len(shortlist)>=6: break
                if not shortlist:
                    shortlist=[(c,l) for c,l in candidates[:6]]
                for combo,label in shortlist:
                    if time.time()-started>112: break
                    for ordered,order_label in _order_variants(combo)[:4]:
                        if time.time()-started>112: break
                        row=_solve_complete_set(ordered,width_mm,height_mm,spacing_mm,seconds=6,step=10)
                        attempts.append({'target':MIN_COMPLETE,'strategy':label,'order':order_label,'step':10,'ok':bool(row.get('feasible')),'placed':int(row.get('placedCount',0) or 0),'error':str(row.get('error') or '')[:120]})
                        if row.get('feasible'):
                            best=row; best_combo=ordered; best_label=f'{label}/{order_label}-10deg'; best_step=10
                            break
                    if best: break

            # Fase 3: rescate fino a 5 grados. Sólo se usa antes de rendirse con las 10.
            if not best:
                fine_candidates=[]; seen=set()
                for row,combo,label in sorted(ranked,key=lambda x:_attempt_score(x[0]),reverse=True):
                    key=tuple(sorted(_ids(combo)))
                    if key in seen: continue
                    seen.add(key); fine_candidates.append((combo,label))
                    if len(fine_candidates)>=3: break
                if not fine_candidates:
                    fine_candidates=[(c,l) for c,l in candidates[:3]]
                for combo,label in fine_candidates:
                    if time.time()-started>DEEP_SEARCH_SECONDS: break
                    for ordered,order_label in _order_variants(combo)[:3]:
                        if time.time()-started>DEEP_SEARCH_SECONDS: break
                        row=_solve_complete_set(ordered,width_mm,height_mm,spacing_mm,seconds=8,step=5)
                        attempts.append({'target':MIN_COMPLETE,'strategy':label,'order':order_label,'step':5,'ok':bool(row.get('feasible')),'placed':int(row.get('placedCount',0) or 0),'error':str(row.get('error') or '')[:120]})
                        if row.get('feasible'):
                            best=row; best_combo=ordered; best_label=f'{label}/{order_label}-5deg'; best_step=5
                            break
                    if best: break

        # Excepción: si 10 no fue posible tras la búsqueda profunda, devolver la mejor placa menor,
        # pero marcada explícitamente como NO lista para producción.
        if not best:
            for fallback_target in (9,8,7,6,5,4,3,2,1):
                if fallback_target>len(window): continue
                for combo,label in _candidate_sets(window,fallback_target)[:5]:
                    if time.time()-started>TOTAL_BUDGET_SECONDS: break
                    for ordered,order_label in _order_variants(combo)[:2]:
                        if time.time()-started>TOTAL_BUDGET_SECONDS: break
                        row=_solve_complete_set(ordered,width_mm,height_mm,spacing_mm,seconds=3,step=15)
                        attempts.append({'target':fallback_target,'strategy':label,'order':order_label,'step':15,'ok':bool(row.get('feasible')),'placed':int(row.get('placedCount',0) or 0)})
                        if row.get('feasible'):
                            best=row; best_combo=ordered; best_label=f'EXCEPCION-{label}/{order_label}'; best_step=15
                            break
                    if best: break
                if best: break

        if not best or not best.get('feasible'):
            return jsonify(ok=False,error='V3 agotó la búsqueda y no encontró un conjunto completo colocable',candidatePool=len(safe),rejected=rejected[:8],attempts=attempts[-50:],elapsedSeconds=round(time.time()-started,2)),422

        selected=list(best_combo or [])
        current_best=best
        current_label=best_label
        reached_minimum=len(selected)>=MIN_COMPLETE

        # Si alcanzó el mínimo industrial, intenta crecer hasta 14 sin sacrificar la placa válida.
        if reached_minimum:
            failures=0
            selected_ids=set(_ids(selected))
            extras=[k for k in window if str(k.get('kitId') or '') not in selected_ids]
            extras=sorted(extras,key=lambda k:(_area(k),_priority(k)))
            for extra in extras:
                if len(selected)>=MAX_COMPLETE or failures>=4 or time.time()-started>TOTAL_BUDGET_SECONDS: break
                candidate=selected+[extra]
                row=_solve_complete_set(candidate,width_mm,height_mm,spacing_mm,seconds=4,step=10)
                attempts.append({'target':len(candidate),'strategy':'crecimiento','figure':str(extra.get('figure') or ''),'step':10,'ok':bool(row.get('feasible')),'placed':int(row.get('placedCount',0) or 0)})
                if row.get('feasible'):
                    selected=candidate; current_best=row; current_label='crecimiento-kit-completo'; best_step=10; failures=0
                else:
                    failures+=1

        normalized=_normalize_result(current_best,best_step,'deep-complete-kit-search')
        complete=int(normalized.get('completeFigures',0) or 0)
        reached_minimum=complete>=MIN_COMPLETE
        return jsonify(ok=True,
            engine='PackingSolver V3.1 · búsqueda profunda 10+ · V1.7 certifier',
            **normalized,
            reachedMinimum=reached_minimum,
            productionReady=reached_minimum,
            minimumTarget=min(MIN_COMPLETE,len(safe)),
            candidatePool=len(safe),
            selectionStrategy=current_label,
            searchMode='deep-15-10-5',
            rejectedCount=len(rejected),
            rejected=rejected[:8],
            attempts=attempts[-50:],
            elapsedSeconds=round(time.time()-started,2))
    except Exception as exc:
        return jsonify(ok=False,error=str(exc),engine='PackingSolver V3.1',elapsedSeconds=round(time.time()-started,2)),500
