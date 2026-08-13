from flask import request, jsonify
import time
from itertools import combinations
import nest_sparrow as ns

# Motor Lab smart-4:
# - respeta prioridad + fecha de entrega;
# - busca 10 seguras;
# - intenta 11 eligiendo inteligentemente QUE 11 probar dentro del mismo nivel;
# - conserva siempre la mejor placa certificada;
# - 12 se intenta sólo en lotes claramente homogéneos/favorables.
MAX_POOL=64
MAX_SECONDS=90
BASE_SEARCH_SECONDS=55
BASE_CANDIDATES=7
GROWTH11_CANDIDATES=10
_memory={}
POSITIVE_NAMES={'gato','gato con luces','auto','chase paw patrol','chopp','abejita','boca','woody toy story'}


def _key(k): return str(k.get('figure') or '').strip().lower()
def _rank(k): return (float(k.get('priority') or 9), str(k.get('date') or '9999-12-31'))
def _difficulty(k):
    env=float(k.get('envelope') or 1); area=max(1.0,float(k.get('area') or 1)); sol=max(.01,float(k.get('solidity') or .01))
    return env/area + (1-sol)*1.8

def _score(k):
    name=_key(k); learned=_memory.get(name,0.0)
    positive=-2.5 if name in POSITIVE_NAMES else 0.0
    return (_rank(k), _difficulty(k)+learned+positive, float(k.get('envelope') or 0), str(k.get('kitId') or ''))

def _compact_score(k):
    env=float(k.get('envelope') or 1e18); area=max(1.0,float(k.get('area') or 1.0)); solidity=max(.01,float(k.get('solidity') or .01))
    learned=_memory.get(_key(k),0.0)
    positive=-12000.0 if _key(k) in POSITIVE_NAMES else 0.0
    return env + 0.35*(env-area) + 15000.0*(1.0-solidity) + learned*5000.0 + positive

def _priority_safe_candidates(kits,target,max_candidates):
    # Nunca saltea un pedido más urgente o de fecha anterior para elegir uno posterior.
    # Sólo optimiza dentro del grupo que comparte exactamente el mismo rango prioridad+fecha
    # en la frontera del target (10, 11 o 12).
    if len(kits)<target:return []
    ordered=sorted(kits,key=lambda k:(_rank(k),str(k.get('kitId') or '')))
    boundary=_rank(ordered[target-1])
    mandatory=[k for k in ordered if _rank(k)<boundary]
    frontier=[k for k in ordered if _rank(k)==boundary]
    slots=target-len(mandatory)
    if slots<0 or len(frontier)<slots:return []

    out=[]; seen=set()
    def add(group,label):
        if len(group)!=target:return
        sig=tuple(sorted(str(k.get('kitId')) for k in group))
        if sig in seen:return
        seen.add(sig);out.append((label,list(group)))

    # baseline cronológico dentro del mismo rango
    add(mandatory+frontier[:slots],f'baseline-{target}')
    scored=sorted(frontier,key=lambda k:(_compact_score(k),str(k.get('kitId') or '')))
    add(mandatory+scored[:slots],f'compact-{target}')

    # Ventanas cercanas: baratas y deterministas.
    for off in range(1,min(5,max(1,len(scored)-slots+1))):
        add(mandatory+scored[off:off+slots],f'window-{target}-{off}')
        if len(out)>=max_candidates:return out[:max_candidates]

    # Portfolio tipo 8+3 (generalizado): conserva los mejores anchors y varía hasta 3.
    vary=min(3,slots)
    anchors=scored[:max(0,slots-vary)]
    tail=scored[max(0,slots-vary):min(len(scored),max(0,slots-vary)+10)]
    for idx,combo in enumerate(sorted(combinations(tail,vary),key=lambda c:sum(_compact_score(k) for k in c))[:max_candidates]):
        add(mandatory+anchors+list(combo),f'combo-{target}-{idx}')
        if len(out)>=max_candidates:break
    return out[:max_candidates]

def _attempt(selected,gap,budget,seed,continuous,attempts,label):
    r=ns._run_sparrow(selected,gap,budget,seed,continuous=continuous)
    attempts.append({'phase':label,'figures':[x['figure'] for x in selected],'completeFigures':len(selected),'fits':r.get('fits'),'placedParts':r.get('placedParts'),'expectedParts':r.get('expectedParts'),'density':round(float(r.get('density') or 0),1),'seconds':budget,'continuous':continuous})
    return r

def _learn_failed(group,result):
    ratio=float(result.get('placedParts') or 0)/max(1,float(result.get('expectedParts') or max(1,len(group)*2)))
    penalty=max(.02,(1-ratio)*.18)
    for x in group:_memory[_key(x)]=min(1.5,_memory.get(_key(x),0.0)+penalty)

def _homogeneous_candidate(kits,target):
    by={}
    for k in kits:by.setdefault((_rank(k),_key(k)),[]).append(k)
    groups=[g for g in by.values() if len(g)>=target]
    if not groups:return None
    groups.sort(key=lambda g:(_rank(g[0]),_compact_score(g[0])))
    return sorted(groups[0],key=lambda k:str(k.get('kitId') or ''))[:target]

def intelligent_nest():
    started=time.time(); data=request.get_json(silent=True) or {}
    width=max(1.0,ns._n(data.get('widthCm'),122)*10); height=max(1.0,ns._n(data.get('heightCm'),58)*10)
    gap=max(3.0,ns._n(data.get('gapCm'),.3)*10)
    raw=sorted(data.get('kits') or [],key=lambda k:(ns._priority(k),str(k.get('date') or ''),str(k.get('figure') or '')))[:MAX_POOL]
    kits=[]; rejected=[]
    for k in raw:
        try:kits.append(ns._prep_kit(k,width,height))
        except Exception as exc: rejected.append({'figure':str(k.get('figure') or ''),'reason':str(exc)})
    if len(kits)<10:return jsonify(ok=False,error=f'Sólo hay {len(kits)} kits utilizables'),422

    attempts=[]; base=None
    groups=_priority_safe_candidates(kits,10,BASE_CANDIDATES)
    seeds=(429,41,1701,7919,31337,7001,17011)
    for idx,(label,g) in enumerate(groups):
        remaining=BASE_SEARCH_SECONDS-(time.time()-started)
        if remaining<5:break
        budget=min(7.0,max(2.2,remaining-1.5))
        r=_attempt(g,gap,budget,seeds[idx%len(seeds)],idx>=2,attempts,'base-10-'+label)
        if r.get('ok') and r.get('fits'):
            base=(g,r);break
        _learn_failed(g,r)

    if not base:
        return jsonify(ok=False,error='Motor Lab no recuperó una base segura de 10 dentro del límite corto.',engine='Motor Lab smart-4',selectorVersion='smart-4-priority-10plus1',attempts=attempts,candidatePool=len(kits),elapsedSeconds=round(time.time()-started,1),hardBaseLimitSeconds=BASE_SEARCH_SECONDS),422

    best_selected,best_result=base
    for x in best_selected:_memory[_key(x)]=max(-1.5,_memory.get(_key(x),0.0)-.25)

    # 10+1 inteligente: reconstruye 11 respetando exactamente prioridad y fecha.
    # No queda atado a las 10 de la base; puede elegir una combinación geométricamente
    # mejor dentro del mismo nivel, que fue la mejora 0/4 -> 4/4 en pruebas reales.
    eleven=_priority_safe_candidates(kits,11,GROWTH11_CANDIDATES)
    for idx,(label,candidate) in enumerate(eleven):
        remaining=MAX_SECONDS-(time.time()-started)
        if remaining<4:break
        budget=min(3.0,max(2.0,remaining-1.5))
        r=_attempt(candidate,gap,budget,429+idx*131,True,attempts,'smart-11-'+label)
        if r.get('ok') and r.get('fits'):
            best_selected,best_result=candidate,r
            break

    # 12 sólo si hay un modelo homogéneo de 12 dentro del mismo rango prioridad+fecha.
    if len(best_selected)>=11:
        twelve=_homogeneous_candidate(kits,12)
        if twelve and MAX_SECONDS-(time.time()-started)>=4:
            for idx,seed in enumerate((429,1701)):
                remaining=MAX_SECONDS-(time.time()-started)
                if remaining<3:break
                r=_attempt(twelve,gap,min(3.0,remaining-1.0),seed,True,attempts,'homogeneous-12')
                if r.get('ok') and r.get('fits'):
                    best_selected,best_result=twelve,r;break

    label=f'Motor Lab smart-4: {len(best_selected)} completas · prioridad protegida'
    response=ns._result_payload(best_selected,label,best_result,kits,rejected,attempts,started,None)
    payload=response.get_json(); payload.update({'engine':'Motor Lab smart-4 · selector 10+1 + Sparrow + V1.7','selectorVersion':'smart-4-priority-10plus1','smartSelection':True,'priorityAndDateProtected':True,'candidatePool':len(kits),'minimumGapMm':gap,'protectedBase10':True,'improvedAbove10':len(best_selected)>10,'completeFigures':len(best_selected),'hardBaseLimitSeconds':BASE_SEARCH_SECONDS,'hardTotalLimitSeconds':MAX_SECONDS})
    return jsonify(payload)

ns.nest_sparrow=intelligent_nest
if 'nest_sparrow' in ns.app.view_functions: ns.app.view_functions['nest_sparrow']=intelligent_nest
