from flask import request, jsonify
import time
from itertools import combinations
import nest_sparrow as ns

# Sparrow Smart V1.12 AREA FIRST
# Regla productiva real: garantizar 10 figuras completas y, desde ahí, maximizar
# porcentaje de placa utilizado. La cantidad 11/12/13... sólo desempata cuando
# dos soluciones tienen una ocupación prácticamente equivalente.
MAX_POOL=72
FAST_BASE_SECONDS=58
TOTAL_SECONDS=245
BASE_CANDIDATES=18
GROWTH_CANDIDATES=12
TARGET12_CANDIDATES=20
PRODUCTIVE_TARGET_PERCENT=70.0
MAX_GROWTH_TARGET=16
LAB_GAP_MM=2.5
PER_LEVEL_SECONDS=18.0
TARGET12_SECONDS=48.0
RECOMPACT_SECONDS=62.0
V112_SEEDS=(429,1701,7919,31337,7001,17011,27183,48017,65537)
_memory={}
POSITIVE_NAMES={'gato','gato con luces','auto','chase paw patrol','chopp','abejita','boca','woody toy story'}

def _key(k): return str(k.get('figure') or '').strip().lower()
def _rank(k): return (str(k.get('date') or '9999-12-31'),)
def _compact_score(k):
    env=float(k.get('envelope') or 1e18); area=max(1.0,float(k.get('area') or 1.0)); solidity=max(.01,float(k.get('solidity') or .01))
    learned=_memory.get(_key(k),0.0); positive=-12000.0 if _key(k) in POSITIVE_NAMES else 0.0
    return env + .35*(env-area) + 15000.0*(1.0-solidity) + learned*5000.0 + positive

def _area_score(k):
    # Preferimos área real grande, pero penalizamos envolventes muy ineficientes.
    area=max(1.0,float(k.get('area') or 1.0)); env=max(area,float(k.get('envelope') or area)); solidity=max(.01,float(k.get('solidity') or .01))
    return -(area * (0.72 + 0.28*solidity)) + 0.08*(env-area)

def _solution_score(selected,result):
    # PRINCIPAL: % material real de placa. SECUNDARIO: cantidad completa.
    # TERCIARIO: menor ancho de strip, para dejar una solución más compacta.
    density=float((result or {}).get('density') or 0.0)
    count=len(selected)
    width=float((result or {}).get('stripWidthMm') or 1e18)
    return (round(density,3),count,-width)

def _better(selected,result,best_selected,best_result):
    if best_result is None:return True
    return _solution_score(selected,result)>_solution_score(best_selected,best_result)

def _priority_safe_candidates(kits,target,max_candidates):
    if len(kits)<target:return []
    ordered=sorted(kits,key=lambda k:(_rank(k),str(k.get('kitId') or ''))); boundary=_rank(ordered[target-1])
    mandatory=[k for k in ordered if _rank(k)<boundary]; frontier=[k for k in ordered if _rank(k)==boundary]; slots=target-len(mandatory)
    if slots<0 or len(frontier)<slots:return []
    out=[];seen=set()
    def add(group,label):
        if len(group)!=target:return
        sig=tuple(sorted(str(k.get('kitId')) for k in group))
        if sig in seen:return
        seen.add(sig);out.append((label,list(group)))
    add(mandatory+frontier[:slots],f'baseline-{target}')
    compact=sorted(frontier,key=lambda k:(_compact_score(k),str(k.get('kitId') or '')))
    area_first=sorted(frontier,key=lambda k:(_area_score(k),str(k.get('kitId') or '')))
    add(mandatory+area_first[:slots],f'area-first-{target}')
    add(mandatory+compact[:slots],f'compact-{target}')
    # Mezclas entre piezas grandes y compactas.
    if slots>=2:
        half=slots//2
        mix=area_first[:half]+[k for k in compact if k not in area_first[:half]][:slots-half]
        add(mandatory+mix,f'area-compact-mix-{target}')
    window_limit=18 if target in (10,11,12) else 10
    for source,label0 in ((area_first,'area-window'),(compact,'compact-window')):
        for off in range(1,min(window_limit,max(1,len(source)-slots+1))):
            add(mandatory+source[off:off+slots],f'{label0}-{target}-{off}')
            if len(out)>=max_candidates:return out[:max_candidates]
    vary=min(5 if target in (10,11,12) else 4,slots);anchors=area_first[:max(0,slots-vary)];tail=area_first[max(0,slots-vary):min(len(area_first),max(0,slots-vary)+18)]
    for idx,combo in enumerate(combinations(tail,vary)):
        add(mandatory+anchors+list(combo),f'area-combo-{target}-{idx}')
        if len(out)>=max_candidates:break
    return out[:max_candidates]

def _same_count_swaps(kits,best_selected,target,max_candidates=16):
    # Reemplaza figuras dentro del MISMO número de completas buscando más área útil.
    if len(best_selected)!=target:return []
    chosen={str(k.get('kitId')) for k in best_selected}
    extras=[k for k in kits if str(k.get('kitId')) not in chosen]
    extras=sorted(extras,key=lambda k:(_rank(k),_area_score(k),_compact_score(k)))
    removable=sorted(best_selected,key=lambda k:(float(k.get('area') or 0),-_compact_score(k)))
    out=[];seen=set()
    def add(group,label):
        sig=tuple(sorted(str(k.get('kitId')) for k in group))
        if len(group)!=target or sig in seen:return
        seen.add(sig);out.append((label,list(group)))
    for old in removable[:6]:
        core=[k for k in best_selected if str(k.get('kitId'))!=str(old.get('kitId'))]
        for new in extras[:8]:
            add(core+[new],f'area-swap-{target}-{_key(old)}-{_key(new)}')
            if len(out)>=max_candidates:return out
    return out

def _recompact_candidates(kits,best_selected,target,max_candidates=14):
    chosen={str(k.get('kitId')) for k in best_selected}
    extras=[k for k in kits if str(k.get('kitId')) not in chosen]
    extras=sorted(extras,key=lambda k:(_rank(k),_area_score(k),_compact_score(k)))
    need=target-len(best_selected)
    if need<0:return []
    if need==0:return _same_count_swaps(kits,best_selected,target,max_candidates)
    if len(extras)<need:return []
    out=[];seen=set()
    def add(group,label):
        if len(group)!=target:return
        sig=tuple(sorted(str(k.get('kitId')) for k in group))
        if sig in seen:return
        seen.add(sig);out.append((label,list(group)))
    add(list(best_selected)+extras[:need],f'core-plus-area-{target}')
    for off in range(1,min(10,max(1,len(extras)-need+1))):add(list(best_selected)+extras[off:off+need],f'core-window-{target}-{off}')
    if need==1 and len(best_selected)>=10 and len(extras)>=2:
        # Sacar una figura de poca área/peor encastre y meter dos candidatas puede subir
        # simultáneamente la cantidad y la ocupación real.
        removable=sorted(best_selected,key=lambda k:(float(k.get('area') or 0),-_compact_score(k)))
        for ridx,old in enumerate(removable[:6]):
            core=[k for k in best_selected if str(k.get('kitId'))!=str(old.get('kitId'))]
            for eoff in range(min(6,len(extras)-1)):
                add(core+extras[eoff:eoff+2],f'replace-1x2-{target}-{ridx}-{eoff}')
                if len(out)>=max_candidates:return out[:max_candidates]
    return out[:max_candidates]

def _certified(selected,result):
    if not (result and result.get('ok') and result.get('fits')):return False,{}
    validator=getattr(ns,'_validate_final_geometry',None)
    if validator is None:return False,{'reason':'certificador no disponible'}
    try:valid,cert=validator(selected,result)
    except Exception as exc:return False,{'reason':str(exc)}
    gap=cert.get('minimumGapMmCertified');required=float(getattr(ns,'MIN_PRODUCTION_GAP_MM',LAB_GAP_MM))
    return bool(valid and gap is not None and float(gap)>=required),cert

def _attempt(selected,gap,budget,seed,attempts,label):
    r=ns._run_sparrow(selected,gap,budget,seed,continuous=True);valid,cert=_certified(selected,r)
    attempts.append({'phase':label,'completeFigures':len(selected),'fits':bool(r and r.get('fits')),'certified':valid,'gapMm':cert.get('minimumGapMmCertified'),'placedParts':r.get('placedParts') if r else 0,'expectedParts':r.get('expectedParts') if r else len(selected)*2,'density':round(float((r or {}).get('density') or 0),1),'stripWidthMm':round(float((r or {}).get('stripWidthMm') or 0),1),'seconds':budget,'continuous':True,'seed':seed})
    return r,valid,cert

def _learn_failed(group,result):
    ratio=float((result or {}).get('placedParts') or 0)/max(1,float((result or {}).get('expectedParts') or max(1,len(group)*2)));penalty=max(.02,(1-ratio)*.18)
    for x in group:_memory[_key(x)]=min(1.5,_memory.get(_key(x),0.0)+penalty)

def intelligent_nest():
    started=time.time();data=request.get_json(silent=True) or {};width=max(1.0,ns._n(data.get('widthCm'),122)*10);height=max(1.0,ns._n(data.get('heightCm'),58)*10);gap=LAB_GAP_MM
    raw=sorted(data.get('kits') or [],key=lambda k:(ns._priority(k),str(k.get('date') or ''),str(k.get('figure') or '')))[:MAX_POOL]
    kits=[];rejected=[]
    for k in raw:
        try:
            p=ns._prep_kit(k,width,height);p['date']=str(k.get('date') or '');p['sourcePriority']=k.get('priority');kits.append(p)
        except Exception as exc:rejected.append({'figure':str(k.get('figure') or ''),'reason':str(exc)})
    if len(kits)<10:return jsonify(ok=False,error=f'Sólo hay {len(kits)} kits utilizables'),422

    attempts=[];best_selected=None;best_result=None;best_cert={}

    # BASE 10: ya no aceptamos la primera válida. Comparamos varias y conservamos
    # la que realmente usa más material de la placa.
    base_started=time.time()
    for idx,(label,g) in enumerate(_priority_safe_candidates(kits,10,BASE_CANDIDATES)):
        remaining=FAST_BASE_SECONDS-(time.time()-base_started)
        if remaining<3:break
        r,valid,cert=_attempt(g,gap,min(6.0,max(2.5,remaining-.5)),V112_SEEDS[idx%len(V112_SEEDS)],attempts,'base-10-'+label)
        if valid and _better(g,r,best_selected,best_result):best_selected,best_result,best_cert=g,r,cert
        if not valid:_learn_failed(g,r)
    if best_result is None:return jsonify(ok=False,error='V1.12 no encontró base 10 certificada; conservar fallback estable.',engine='Smart V1.12 Area First',selectorVersion='smart-v112-area-first',attempts=attempts),422

    # Optimización al MISMO conteo: puede ser mejor 10 grandes al 69% que 11 chicas al 61%.
    for idx,(label,candidate) in enumerate(_same_count_swaps(kits,best_selected,10,12)):
        if TOTAL_SECONDS-(time.time()-started)<4:break
        r,valid,cert=_attempt(candidate,gap,4.0,V112_SEEDS[(idx+3)%len(V112_SEEDS)]+10003,attempts,'area-refine-10-'+label)
        if valid and _better(candidate,r,best_selected,best_result):best_selected,best_result,best_cert=candidate,r,cert

    # Crecimiento 11..16. Cada solución sólo reemplaza a la actual si mejora la OCUPACIÓN.
    for target in range(11,min(MAX_GROWTH_TARGET,len(kits))+1):
        if float(best_result.get('density') or 0)>=PRODUCTIVE_TARGET_PERCENT:break
        if TOTAL_SECONDS-(time.time()-started)<4:break
        level_started=time.time();level_seconds=TARGET12_SECONDS if target==12 else PER_LEVEL_SECONDS
        max_candidates=TARGET12_CANDIDATES if target==12 else GROWTH_CANDIDATES
        for idx,(label,candidate) in enumerate(_priority_safe_candidates(kits,target,max_candidates)):
            remaining_level=level_seconds-(time.time()-level_started)
            if remaining_level<3:break
            budget=min(5.5 if target==12 else 4.0,max(2.4,remaining_level-.5))
            seed=V112_SEEDS[(idx+target)%len(V112_SEEDS)]+target*977
            r,valid,cert=_attempt(candidate,gap,budget,seed,attempts,f'area-grow-{target}-{label}')
            if valid and _better(candidate,r,best_selected,best_result):best_selected,best_result,best_cert=candidate,r,cert
            elif not valid:_learn_failed(candidate,r)

    # Recompactación: prueba cambios de composición, incluso manteniendo el mismo número,
    # hasta encontrar la mayor densidad certificada posible dentro del presupuesto.
    rc_started=time.time();recompact=[]
    for target in range(max(10,len(best_selected)),min(MAX_GROWTH_TARGET,len(kits))+1):
        if float(best_result.get('density') or 0)>=PRODUCTIVE_TARGET_PERCENT:break
        if time.time()-rc_started>=RECOMPACT_SECONDS or TOTAL_SECONDS-(time.time()-started)<4:break
        recompact.append(target)
        limit=18 if target in (10,11,12) else 10
        for idx,(label,candidate) in enumerate(_recompact_candidates(kits,best_selected,target,limit)):
            remaining=min(RECOMPACT_SECONDS-(time.time()-rc_started),TOTAL_SECONDS-(time.time()-started))
            if remaining<3:break
            budget=min(5.5,max(2.5,remaining-.5))
            seed=V112_SEEDS[(idx+target)%len(V112_SEEDS)]+target*1931
            r,valid,cert=_attempt(candidate,gap,budget,seed,attempts,f'area-recompact-{target}-{label}')
            if valid and _better(candidate,r,best_selected,best_result):best_selected,best_result,best_cert=candidate,r,cert

    response=ns._result_payload(best_selected,f'Smart V1.12 Area First: {len(best_selected)} completas · {float(best_result.get("density") or 0):.1f}% placa',best_result,kits,rejected,attempts,started,None)
    payload=response.get_json();payload.update({'engine':'Sparrow V1.12 Area First · mínimo 10 · maximiza ocupación certificada · cantidad secundaria','selectorVersion':'smart-v112-area-first','smartSelection':True,'candidatePool':len(kits),'minimumGapMm':best_cert.get('minimumGapMmCertified'),'requiredGapMm':float(getattr(ns,'MIN_PRODUCTION_GAP_MM',LAB_GAP_MM)),'protectedBase10':True,'completeFigures':len(best_selected),'productiveTargetPercent':PRODUCTIVE_TARGET_PERCENT,'productiveTargetReached':float(best_result.get('density') or 0)>=PRODUCTIVE_TARGET_PERCENT,'optimizationPriority':'plate-area-first','countIsSecondary':True,'continuousRotation':True,'recompactLevelsTried':recompact,'labGapMm':LAB_GAP_MM,'unusedRightMm':max(0.0,1220.0-float(best_result.get('stripWidthMm') or 1220.0))})
    return jsonify(payload)

ns.nest_sparrow=intelligent_nest
if 'nest_sparrow' in ns.app.view_functions:ns.app.view_functions['nest_sparrow']=intelligent_nest
