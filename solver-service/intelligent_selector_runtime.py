from flask import request, jsonify
import time
from itertools import combinations
import nest_sparrow as ns

# Smart-4 estable con rescate: primero asegura 10 certificadas; 11/12 nunca pueden romper esa base.
MAX_POOL=64
FAST_BASE_SECONDS=55
TOTAL_SECONDS=105
BASE_CANDIDATES=7
GROWTH11_CANDIDATES=10
_memory={}
POSITIVE_NAMES={'gato','gato con luces','auto','chase paw patrol','chopp','abejita','boca','woody toy story'}

def _key(k): return str(k.get('figure') or '').strip().lower()
# La prioridad productiva real es la FECHA. Dentro de una misma fecha Sparrow
# debe poder combinar libremente las figuras para encontrar una placa de 10.
# Antes cada kit recibía un priority único (0,1,2...), por lo que el selector
# consideraba obligatorios exactamente los primeros 10 y el "rescate" repetía
# siempre la misma combinación.
def _rank(k): return (str(k.get('date') or '9999-12-31'),)
def _difficulty(k):
    env=float(k.get('envelope') or 1); area=max(1.0,float(k.get('area') or 1)); sol=max(.01,float(k.get('solidity') or .01))
    return env/area + (1-sol)*1.8

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
    scored=sorted(frontier,key=lambda k:(_compact_score(k),str(k.get('kitId') or '')));add(mandatory+scored[:slots],f'compact-{target}')
    for off in range(1,min(5,max(1,len(scored)-slots+1))):
        add(mandatory+scored[off:off+slots],f'window-{target}-{off}')
        if len(out)>=max_candidates:return out[:max_candidates]
    vary=min(3,slots);anchors=scored[:max(0,slots-vary)];tail=scored[max(0,slots-vary):min(len(scored),max(0,slots-vary)+10)]
    for idx,combo in enumerate(sorted(combinations(tail,vary),key=lambda c:sum(_compact_score(k) for k in c))[:max_candidates]):
        add(mandatory+anchors+list(combo),f'combo-{target}-{idx}')
        if len(out)>=max_candidates:break
    return out[:max_candidates]

def _certified(selected,result):
    if not (result and result.get('ok') and result.get('fits')):return False,{}
    validator=getattr(ns,'_validate_final_geometry',None)
    if validator is None:return False,{'reason':'certificador V1.7 no disponible'}
    try:valid,cert=validator(selected,result)
    except Exception as exc:return False,{'reason':str(exc)}
    gap=cert.get('minimumGapMmCertified')
    return bool(valid and gap is not None and float(gap)>=3.0),cert

def _attempt(selected,gap,budget,seed,continuous,attempts,label):
    r=ns._run_sparrow(selected,gap,budget,seed,continuous=continuous);valid,cert=_certified(selected,r)
    attempts.append({'phase':label,'figures':[x['figure'] for x in selected],'completeFigures':len(selected),'fits':bool(r and r.get('fits')),'certified':valid,'gapMm':cert.get('minimumGapMmCertified'),'placedParts':r.get('placedParts') if r else 0,'expectedParts':r.get('expectedParts') if r else len(selected)*2,'density':round(float((r or {}).get('density') or 0),1),'seconds':budget,'continuous':continuous,'seed':seed})
    return r,valid,cert

def _learn_failed(group,result):
    ratio=float((result or {}).get('placedParts') or 0)/max(1,float((result or {}).get('expectedParts') or max(1,len(group)*2)));penalty=max(.02,(1-ratio)*.18)
    for x in group:_memory[_key(x)]=min(1.5,_memory.get(_key(x),0.0)+penalty)

def _homogeneous_candidate(kits,target):
    by={}
    for k in kits:by.setdefault((_rank(k),_key(k)),[]).append(k)
    groups=[g for g in by.values() if len(g)>=target]
    if not groups:return None
    groups.sort(key=lambda g:(_rank(g[0]),_compact_score(g[0])))
    return sorted(groups[0],key=lambda k:str(k.get('kitId') or ''))[:target]

def intelligent_nest():
    started=time.time();data=request.get_json(silent=True) or {}
    width=max(1.0,ns._n(data.get('widthCm'),122)*10);height=max(1.0,ns._n(data.get('heightCm'),58)*10);gap=max(3.0,ns._n(data.get('gapCm'),.3)*10)
    raw=sorted(data.get('kits') or [],key=lambda k:(ns._priority(k),str(k.get('date') or ''),str(k.get('figure') or '')))[:MAX_POOL]
    kits=[];rejected=[]
    for k in raw:
        try:
            prepared=ns._prep_kit(k,width,height)
            # _prep_kit normaliza geometría pero no conservaba la fecha. Sin ella,
            # _rank terminaba usando el priority único del frontend y anulaba todas
            # las combinaciones alternativas. La preservamos explícitamente.
            prepared['date']=str(k.get('date') or '')
            prepared['sourcePriority']=k.get('priority')
            kits.append(prepared)
        except Exception as exc:rejected.append({'figure':str(k.get('figure') or ''),'reason':str(exc)})
    if len(kits)<10:return jsonify(ok=False,error=f'Sólo hay {len(kits)} kits utilizables'),422
    attempts=[];base=None;groups=_priority_safe_candidates(kits,10,BASE_CANDIDATES);seeds=(429,41,1701,7919,31337,7001,17011)
    # Fase rápida: mantiene la velocidad de los casos fáciles.
    for idx,(label,g) in enumerate(groups):
        remaining=FAST_BASE_SECONDS-(time.time()-started)
        if remaining<4:break
        r,valid,cert=_attempt(g,gap,min(7.0,max(2.5,remaining-1.0)),seeds[idx%len(seeds)],idx>=2,attempts,'base-10-'+label)
        if valid:base=(g,r,cert);break
        _learn_failed(g,r)
    # Rescate: el límite corto nunca convierte una placa posible en ERROR.
    if base is None:
        rescue=[]
        for idx,(label,g) in enumerate(groups):
            rescue.append((label,g,seeds[(idx+3)%len(seeds)],True));rescue.append((label+'-discreta',g,seeds[(idx+5)%len(seeds)],False))
        for label,g,seed,continuous in rescue:
            remaining=TOTAL_SECONDS-(time.time()-started)
            if remaining<4:break
            r,valid,cert=_attempt(g,gap,min(8.0,max(2.5,remaining-1.0)),seed,continuous,attempts,'rescate-10-'+label)
            if valid:base=(g,r,cert);break
            _learn_failed(g,r)
    if base is None:return jsonify(ok=False,error='No se encontró una base de 10 certificada a 3 mm después del rescate protegido.',engine='Smart-4 estable + rescate',selectorVersion='smart-4-rescue-10plus1-datefix',attempts=attempts,candidatePool=len(kits),candidateGroups=len(groups),elapsedSeconds=round(time.time()-started,1),rescueAttempted=True),422
    best_selected,best_result,best_cert=base
    for x in best_selected:_memory[_key(x)]=max(-1.5,_memory.get(_key(x),0.0)-.25)
    # Sólo después de congelar 10 certificadas se intenta 11.
    for idx,(label,candidate) in enumerate(_priority_safe_candidates(kits,11,GROWTH11_CANDIDATES)):
        remaining=TOTAL_SECONDS-(time.time()-started)
        if remaining<4:break
        r,valid,cert=_attempt(candidate,gap,min(3.5,max(2.0,remaining-1.0)),429+idx*131,True,attempts,'smart-11-'+label)
        if valid:best_selected,best_result,best_cert=candidate,r,cert;break
    if len(best_selected)>=11:
        twelve=_homogeneous_candidate(kits,12)
        if twelve:
            for seed in (429,1701):
                remaining=TOTAL_SECONDS-(time.time()-started)
                if remaining<3:break
                r,valid,cert=_attempt(twelve,gap,min(3.0,remaining-1.0),seed,True,attempts,'homogeneous-12')
                if valid:best_selected,best_result,best_cert=twelve,r,cert;break
    response=ns._result_payload(best_selected,f'Smart-4 estable: {len(best_selected)} completas · base 10 protegida',best_result,kits,rejected,attempts,started,None)
    payload=response.get_json();payload.update({'engine':'Smart-4 estable · base 10 certificada + rescate + crecimiento 11/12','selectorVersion':'smart-4-rescue-10plus1-datefix','smartSelection':True,'priorityAndDateProtected':True,'candidatePool':len(kits),'candidateGroups':len(groups),'minimumGapMm':best_cert.get('minimumGapMmCertified'),'requiredGapMm':3.0,'protectedBase10':True,'rescueEnabled':True,'improvedAbove10':len(best_selected)>10,'completeFigures':len(best_selected),'productiveTargetPercent':75,'hardTotalLimitSeconds':TOTAL_SECONDS})
    return jsonify(payload)

ns.nest_sparrow=intelligent_nest
if 'nest_sparrow' in ns.app.view_functions:ns.app.view_functions['nest_sparrow']=intelligent_nest