from flask import request, jsonify
import time
from itertools import combinations
import nest_sparrow as ns

# Sparrow Smart V1.10: base segura + Balanced Growth + recompacción global.
MAX_POOL=64
FAST_BASE_SECONDS=50
TOTAL_SECONDS=210
BASE_CANDIDATES=7
GROWTH_CANDIDATES=6
PRODUCTIVE_TARGET_PERCENT=70.0
MAX_GROWTH_TARGET=16
LAB_GAP_MM=2.5
PER_LEVEL_SECONDS=20.0
RECOMPACT_SECONDS=42.0
_memory={}
POSITIVE_NAMES={'gato','gato con luces','auto','chase paw patrol','chopp','abejita','boca','woody toy story'}

def _key(k): return str(k.get('figure') or '').strip().lower()
def _rank(k): return (str(k.get('date') or '9999-12-31'),)
def _compact_score(k):
    env=float(k.get('envelope') or 1e18); area=max(1.0,float(k.get('area') or 1.0)); solidity=max(.01,float(k.get('solidity') or .01))
    learned=_memory.get(_key(k),0.0); positive=-12000.0 if _key(k) in POSITIVE_NAMES else 0.0
    return env + .35*(env-area) + 15000.0*(1.0-solidity) + learned*5000.0 + positive

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
    scored=sorted(frontier,key=lambda k:(_compact_score(k),str(k.get('kitId') or '')))
    add(mandatory+scored[:slots],f'compact-{target}')
    for off in range(1,min(7,max(1,len(scored)-slots+1))):
        add(mandatory+scored[off:off+slots],f'window-{target}-{off}')
        if len(out)>=max_candidates:return out[:max_candidates]
    vary=min(3,slots);anchors=scored[:max(0,slots-vary)];tail=scored[max(0,slots-vary):min(len(scored),max(0,slots-vary)+10)]
    for idx,combo in enumerate(sorted(combinations(tail,vary),key=lambda c:sum(_compact_score(k) for k in c))[:max_candidates]):
        add(mandatory+anchors+list(combo),f'combo-{target}-{idx}')
        if len(out)>=max_candidates:break
    return out[:max_candidates]

def _recompact_candidates(kits,best_selected,target,max_candidates=5):
    if len(best_selected)>=target:return [('recompact-current',best_selected[:target])]
    chosen={str(k.get('kitId')) for k in best_selected}
    extras=[k for k in kits if str(k.get('kitId')) not in chosen]
    extras=sorted(extras,key=lambda k:(_rank(k),_compact_score(k),str(k.get('kitId') or '')))
    need=target-len(best_selected)
    if len(extras)<need:return []
    out=[];seen=set()
    def add(group,label):
        if len(group)!=target:return
        sig=tuple(sorted(str(k.get('kitId')) for k in group))
        if sig in seen:return
        seen.add(sig);out.append((label,list(group)))
    add(list(best_selected)+extras[:need],f'core-plus-compact-{target}')
    for off in range(1,min(4,max(1,len(extras)-need+1))): add(list(best_selected)+extras[off:off+need],f'core-window-{target}-{off}')
    if need==1 and len(best_selected)>=11 and len(extras)>=2:
        hard=sorted(best_selected,key=_compact_score,reverse=True)
        for ridx in range(min(2,len(hard))):
            core=[k for k in best_selected if str(k.get('kitId'))!=str(hard[ridx].get('kitId'))]
            add(core+extras[:2],f'replace-hard-{target}-{ridx}')
    return out[:max_candidates]

def _certified(selected,result):
    if not (result and result.get('ok') and result.get('fits')):return False,{}
    validator=getattr(ns,'_validate_final_geometry',None)
    if validator is None:return False,{'reason':'certificador no disponible'}
    try:valid,cert=validator(selected,result)
    except Exception as exc:return False,{'reason':str(exc)}
    gap=cert.get('minimumGapMmCertified');required=float(getattr(ns,'MIN_PRODUCTION_GAP_MM',LAB_GAP_MM))
    return bool(valid and gap is not None and float(gap)>=required),cert

def _attempt(selected,gap,budget,seed,continuous,attempts,label):
    r=ns._run_sparrow(selected,gap,budget,seed,continuous=continuous);valid,cert=_certified(selected,r)
    attempts.append({'phase':label,'figures':[x['figure'] for x in selected],'completeFigures':len(selected),'fits':bool(r and r.get('fits')),'certified':valid,'gapMm':cert.get('minimumGapMmCertified'),'placedParts':r.get('placedParts') if r else 0,'expectedParts':r.get('expectedParts') if r else len(selected)*2,'density':round(float((r or {}).get('density') or 0),1),'seconds':budget,'continuous':continuous,'seed':seed})
    return r,valid,cert

def _learn_failed(group,result):
    ratio=float((result or {}).get('placedParts') or 0)/max(1,float((result or {}).get('expectedParts') or max(1,len(group)*2)));penalty=max(.02,(1-ratio)*.18)
    for x in group:_memory[_key(x)]=min(1.5,_memory.get(_key(x),0.0)+penalty)

def intelligent_nest():
    started=time.time();data=request.get_json(silent=True) or {}
    width=max(1.0,ns._n(data.get('widthCm'),122)*10);height=max(1.0,ns._n(data.get('heightCm'),58)*10);gap=LAB_GAP_MM
    raw=sorted(data.get('kits') or [],key=lambda k:(ns._priority(k),str(k.get('date') or ''),str(k.get('figure') or '')))[:MAX_POOL]
    kits=[];rejected=[]
    for k in raw:
        try:
            prepared=ns._prep_kit(k,width,height);prepared['date']=str(k.get('date') or '');prepared['sourcePriority']=k.get('priority');kits.append(prepared)
        except Exception as exc:rejected.append({'figure':str(k.get('figure') or ''),'reason':str(exc)})
    if len(kits)<10:return jsonify(ok=False,error=f'Sólo hay {len(kits)} kits utilizables'),422
    attempts=[];base=None;groups=_priority_safe_candidates(kits,10,BASE_CANDIDATES);seeds=(429,41,1701,7919,31337,7001,17011)
    for idx,(label,g) in enumerate(groups):
        remaining=FAST_BASE_SECONDS-(time.time()-started)
        if remaining<4:break
        r,valid,cert=_attempt(g,gap,min(7.0,max(2.5,remaining-1.0)),seeds[idx%len(seeds)],idx>=2,attempts,'base-10-'+label)
        if valid:base=(g,r,cert);break
        _learn_failed(g,r)
    if base is None:
        for idx,(label,g) in enumerate(groups):
            remaining=70-(time.time()-started)
            if remaining<4:break
            r,valid,cert=_attempt(g,gap,min(7.0,max(2.5,remaining-1.0)),seeds[(idx+3)%len(seeds)],True,attempts,'rescate-10-'+label)
            if valid:base=(g,r,cert);break
            _learn_failed(g,r)
    if base is None:return jsonify(ok=False,error='No se encontró una base de 10 certificada.',engine='Smart V1.10 Global Recompact',selectorVersion='smart-v110-recompact',attempts=attempts),422

    best_selected,best_result,best_cert=base
    for x in best_selected:_memory[_key(x)]=max(-1.5,_memory.get(_key(x),0.0)-.25)
    levels_tried=[]
    for target in range(11,min(MAX_GROWTH_TARGET,len(kits))+1):
        if float(best_result.get('density') or 0)>=PRODUCTIVE_TARGET_PERCENT:break
        global_remaining=TOTAL_SECONDS-(time.time()-started)
        if global_remaining<4:break
        levels_tried.append(target);level_started=time.time();level_best=None
        for idx,(label,candidate) in enumerate(_priority_safe_candidates(kits,target,GROWTH_CANDIDATES)):
            level_remaining=PER_LEVEL_SECONDS-(time.time()-level_started);global_remaining=TOTAL_SECONDS-(time.time()-started)
            if level_remaining<3 or global_remaining<3:break
            budget=min(3.2,max(2.0,level_remaining-0.5),max(2.0,global_remaining-0.5))
            seed=429+target*977+idx*131
            r,valid,cert=_attempt(candidate,gap,budget,seed,True,attempts,f'grow-{target}-{label}')
            if valid:
                score=(len(candidate),float(r.get('density') or 0),-float(r.get('stripWidthMm') or 1e18))
                if level_best is None or score>level_best[0]:level_best=(score,candidate,r,cert)
                if float(r.get('density') or 0)>=PRODUCTIVE_TARGET_PERCENT:break
            else:_learn_failed(candidate,r)
        if level_best is not None:
            _,cand,r,cert=level_best
            if len(cand)>len(best_selected) or float(r.get('density') or 0)>float(best_result.get('density') or 0):best_selected,best_result,best_cert=cand,r,cert

    recompact_tried=[]
    if len(best_selected)>=11 and float(best_result.get('density') or 0)<PRODUCTIVE_TARGET_PERCENT:
        rc_started=time.time();start_target=min(len(best_selected)+1,MAX_GROWTH_TARGET)
        for target in range(start_target,min(MAX_GROWTH_TARGET,len(kits))+1):
            if time.time()-rc_started>=RECOMPACT_SECONDS:break
            recompact_tried.append(target);level_best=None
            for idx,(label,candidate) in enumerate(_recompact_candidates(kits,best_selected,target,5)):
                remaining=RECOMPACT_SECONDS-(time.time()-rc_started)
                if remaining<4:break
                budget=min(6.5,max(3.0,remaining-1.0))
                for seed_offset in (0,3701):
                    if RECOMPACT_SECONDS-(time.time()-rc_started)<3:break
                    seed=99173+target*1931+idx*271+seed_offset
                    r,valid,cert=_attempt(candidate,gap,budget,seed,True,attempts,f'recompact-{target}-{label}')
                    if valid:
                        score=(len(candidate),float(r.get('density') or 0),-float(r.get('stripWidthMm') or 1e18))
                        if level_best is None or score>level_best[0]:level_best=(score,candidate,r,cert)
                        if float(r.get('density') or 0)>=PRODUCTIVE_TARGET_PERCENT:break
                if level_best and float(level_best[2].get('density') or 0)>=PRODUCTIVE_TARGET_PERCENT:break
            if level_best is not None:
                _,cand,r,cert=level_best
                if len(cand)>len(best_selected) or float(r.get('density') or 0)>float(best_result.get('density') or 0):best_selected,best_result,best_cert=cand,r,cert
                if float(best_result.get('density') or 0)>=PRODUCTIVE_TARGET_PERCENT:break

    response=ns._result_payload(best_selected,f'Smart V1.10 Global Recompact: {len(best_selected)} completas · objetivo 70%',best_result,kits,rejected,attempts,started,None)
    payload=response.get_json();payload.update({'engine':'Sparrow Smart V1.10 Global Recompact · base segura + recompacción total 12+','selectorVersion':'smart-v110-recompact','smartSelection':True,'candidatePool':len(kits),'minimumGapMm':best_cert.get('minimumGapMmCertified'),'requiredGapMm':float(getattr(ns,'MIN_PRODUCTION_GAP_MM',LAB_GAP_MM)),'protectedBase10':True,'improvedAbove10':len(best_selected)>10,'completeFigures':len(best_selected),'productiveTargetPercent':PRODUCTIVE_TARGET_PERCENT,'productiveTargetReached':float(best_result.get('density') or 0)>=PRODUCTIVE_TARGET_PERCENT,'hardTotalLimitSeconds':TOTAL_SECONDS,'perGrowthLevelSeconds':PER_LEVEL_SECONDS,'globalRecompactSeconds':RECOMPACT_SECONDS,'globalRecompact':True,'recompactLevelsTried':recompact_tried,'labGapMm':LAB_GAP_MM,'levelsTried':levels_tried,'growthContinuesAfterMiss':True})
    return jsonify(payload)

ns.nest_sparrow=intelligent_nest
if 'nest_sparrow' in ns.app.view_functions:ns.app.view_functions['nest_sparrow']=intelligent_nest
