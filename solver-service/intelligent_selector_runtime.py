from flask import request, jsonify
import time
from itertools import combinations
import nest_sparrow as ns

# Sparrow Smart V1.11: conserva V1.10 como piso y agrega búsqueda geométrica
# por huecos/contornos mediante más candidatos, rotaciones continuas y múltiples semillas.
MAX_POOL=72
FAST_BASE_SECONDS=50
TOTAL_SECONDS=245
BASE_CANDIDATES=7
GROWTH_CANDIDATES=9
PRODUCTIVE_TARGET_PERCENT=70.0
MAX_GROWTH_TARGET=16
LAB_GAP_MM=2.5
PER_LEVEL_SECONDS=25.0
RECOMPACT_SECONDS=58.0
V111_SEEDS=(429,1701,7919,31337,7001,17011,27183)
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
    for off in range(1,min(10,max(1,len(scored)-slots+1))):
        add(mandatory+scored[off:off+slots],f'window-{target}-{off}')
        if len(out)>=max_candidates:return out[:max_candidates]
    vary=min(4,slots);anchors=scored[:max(0,slots-vary)];tail=scored[max(0,slots-vary):min(len(scored),max(0,slots-vary)+14)]
    for idx,combo in enumerate(sorted(combinations(tail,vary),key=lambda c:sum(_compact_score(k) for k in c))[:max_candidates]):
        add(mandatory+anchors+list(combo),f'combo-{target}-{idx}')
        if len(out)>=max_candidates:break
    return out[:max_candidates]

def _recompact_candidates(kits,best_selected,target,max_candidates=8):
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
    for off in range(1,min(7,max(1,len(extras)-need+1))):add(list(best_selected)+extras[off:off+need],f'core-window-{target}-{off}')
    if need==1 and len(best_selected)>=11 and len(extras)>=2:
        hard=sorted(best_selected,key=_compact_score,reverse=True)
        for ridx in range(min(4,len(hard))):
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

def _attempt(selected,gap,budget,seed,attempts,label):
    # continuous=True habilita las rotaciones finas del solver; distintas semillas
    # exploran encastres diferentes en huecos internos y entre contornos.
    r=ns._run_sparrow(selected,gap,budget,seed,continuous=True);valid,cert=_certified(selected,r)
    attempts.append({'phase':label,'completeFigures':len(selected),'fits':bool(r and r.get('fits')),'certified':valid,'gapMm':cert.get('minimumGapMmCertified'),'placedParts':r.get('placedParts') if r else 0,'expectedParts':r.get('expectedParts') if r else len(selected)*2,'density':round(float((r or {}).get('density') or 0),1),'seconds':budget,'continuous':True,'seed':seed})
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
    attempts=[];base=None;groups=_priority_safe_candidates(kits,10,BASE_CANDIDATES)
    for idx,(label,g) in enumerate(groups):
        remaining=FAST_BASE_SECONDS-(time.time()-started)
        if remaining<4:break
        r,valid,cert=_attempt(g,gap,min(7.0,max(2.5,remaining-1.0)),V111_SEEDS[idx%len(V111_SEEDS)],attempts,'base-10-'+label)
        if valid:base=(g,r,cert);break
        _learn_failed(g,r)
    if base is None:return jsonify(ok=False,error='V1.11 no encontró base 10; conservar V1.10.',engine='Smart V1.11 Geometry Fit',selectorVersion='smart-v111-geometry-fit',attempts=attempts),422
    best_selected,best_result,best_cert=base
    for target in range(11,min(MAX_GROWTH_TARGET,len(kits))+1):
        if float(best_result.get('density') or 0)>=PRODUCTIVE_TARGET_PERCENT:break
        if TOTAL_SECONDS-(time.time()-started)<4:break
        level_started=time.time();level_best=None
        for idx,(label,candidate) in enumerate(_priority_safe_candidates(kits,target,GROWTH_CANDIDATES)):
            if PER_LEVEL_SECONDS-(time.time()-level_started)<3:break
            budget=min(4.0,max(2.2,PER_LEVEL_SECONDS-(time.time()-level_started)-.5))
            seed=V111_SEEDS[(idx+target)%len(V111_SEEDS)]+target*977
            r,valid,cert=_attempt(candidate,gap,budget,seed,attempts,f'geometry-grow-{target}-{label}')
            if valid:
                score=(len(candidate),float(r.get('density') or 0),-float(r.get('stripWidthMm') or 1e18))
                if level_best is None or score>level_best[0]:level_best=(score,candidate,r,cert)
            else:_learn_failed(candidate,r)
        if level_best:
            _,cand,r,cert=level_best
            if len(cand)>len(best_selected) or float(r.get('density') or 0)>float(best_result.get('density') or 0):best_selected,best_result,best_cert=cand,r,cert
    recompact=[]
    if len(best_selected)>=11 and float(best_result.get('density') or 0)<PRODUCTIVE_TARGET_PERCENT:
        rc_started=time.time()
        for target in range(min(len(best_selected)+1,MAX_GROWTH_TARGET),min(MAX_GROWTH_TARGET,len(kits))+1):
            if time.time()-rc_started>=RECOMPACT_SECONDS:break
            recompact.append(target);level_best=None
            for idx,(label,candidate) in enumerate(_recompact_candidates(kits,best_selected,target,8)):
                remaining=RECOMPACT_SECONDS-(time.time()-rc_started)
                if remaining<3:break
                budget=min(5.0,max(2.5,remaining-.5))
                for sidx in range(2):
                    seed=V111_SEEDS[(idx+sidx+target)%len(V111_SEEDS)]+target*1931
                    r,valid,cert=_attempt(candidate,gap,budget,seed,attempts,f'geometry-recompact-{target}-{label}')
                    if valid:
                        score=(len(candidate),float(r.get('density') or 0),-float(r.get('stripWidthMm') or 1e18))
                        if level_best is None or score>level_best[0]:level_best=(score,candidate,r,cert)
            if level_best:
                _,cand,r,cert=level_best
                if len(cand)>len(best_selected) or float(r.get('density') or 0)>float(best_result.get('density') or 0):best_selected,best_result,best_cert=cand,r,cert
                if float(best_result.get('density') or 0)>=PRODUCTIVE_TARGET_PERCENT:break
    response=ns._result_payload(best_selected,f'Smart V1.11 Geometry Fit: {len(best_selected)} completas · objetivo 70%',best_result,kits,rejected,attempts,started,None)
    payload=response.get_json();payload.update({'engine':'Sparrow Smart V1.11 Geometry Fit · rotación fina + búsqueda de huecos + fallback V1.10','selectorVersion':'smart-v111-geometry-fit','smartSelection':True,'candidatePool':len(kits),'minimumGapMm':best_cert.get('minimumGapMmCertified'),'requiredGapMm':float(getattr(ns,'MIN_PRODUCTION_GAP_MM',LAB_GAP_MM)),'protectedBase10':True,'completeFigures':len(best_selected),'productiveTargetPercent':PRODUCTIVE_TARGET_PERCENT,'productiveTargetReached':float(best_result.get('density') or 0)>=PRODUCTIVE_TARGET_PERCENT,'geometryFit':True,'continuousRotation':True,'recompactLevelsTried':recompact,'labGapMm':LAB_GAP_MM})
    return jsonify(payload)

ns.nest_sparrow=intelligent_nest
if 'nest_sparrow' in ns.app.view_functions:ns.app.view_functions['nest_sparrow']=intelligent_nest
