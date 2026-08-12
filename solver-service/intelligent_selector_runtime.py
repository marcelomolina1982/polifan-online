from flask import request, jsonify
import time, random
import nest_sparrow as ns

# Motor Lab smart-2:
# 1) recupera primero una base certificable de 10 con la estrategia estable;
# 2) guarda esa solución como piso;
# 3) intenta 11 y luego 12 completas; si no mejora, devuelve las 10 sin perderlas.
MAX_POOL=64
MAX_SECONDS=270
BASE_SEARCH_SECONDS=170
PORTFOLIO=9
EXPANSION_CANDIDATES=8
_memory={}
POSITIVE_NAMES={'gato','gato con luces','auto','chase paw patrol','chopp','abejita','boca','woody toy story'}


def _key(k): return str(k.get('figure') or '').strip().lower()
def _difficulty(k):
    env=float(k.get('envelope') or 1); area=max(1.0,float(k.get('area') or 1)); sol=max(.01,float(k.get('solidity') or .01))
    return env/area + (1-sol)*1.8

def _score(k):
    name=_key(k); learned=_memory.get(name,0.0)
    positive=-2.5 if name in POSITIVE_NAMES else 0.0
    return (float(k.get('priority') or 9), _difficulty(k)+learned+positive, float(k.get('envelope') or 0))

def _portfolio(kits):
    ordered=sorted(kits,key=_score)
    groups=[]; seen=set()
    def add(g):
        if len(g)!=10:return
        sig=tuple(sorted(str(x.get('kitId')) for x in g))
        if sig not in seen: seen.add(sig); groups.append(g)
    add(ordered[:10])
    for off in (2,5,8,12): add(ordered[off:off+10])
    anchors=[k for k in ordered if _key(k) in POSITIVE_NAMES]
    rest=[k for k in ordered if k not in anchors]
    add((anchors+rest)[:10])
    rng=random.Random(429)
    top=ordered[:min(30,len(ordered))]
    for _ in range(12):
        sample=sorted(rng.sample(top,10),key=_score)
        add(sample)
        if len(groups)>=PORTFOLIO:break
    return groups[:PORTFOLIO]

def _attempt(selected,gap,budget,seed,continuous,attempts,label):
    r=ns._run_sparrow(selected,gap,budget,seed,continuous=continuous)
    attempts.append({'phase':label,'figures':[x['figure'] for x in selected],'completeFigures':len(selected),'fits':r.get('fits'),'placedParts':r.get('placedParts'),'expectedParts':r.get('expectedParts'),'density':round(float(r.get('density') or 0),1),'seconds':budget,'continuous':continuous})
    return r

def _learn_failed(group,result):
    ratio=float(result.get('placedParts') or 0)/max(1,float(result.get('expectedParts') or max(1,len(group)*2)))
    penalty=max(.02,(1-ratio)*.18)
    for x in group:_memory[_key(x)]=min(1.5,_memory.get(_key(x),0.0)+penalty)

def _expansion_pool(kits,selected):
    used={str(x.get('kitId')) for x in selected}
    return [x for x in sorted(kits,key=_score) if str(x.get('kitId')) not in used][:EXPANSION_CANDIDATES]

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
    groups=_portfolio(kits)
    for idx,g in enumerate(groups):
        elapsed=time.time()-started
        remaining_base=BASE_SEARCH_SECONDS-elapsed
        if remaining_base<16:break
        budget=min(34 if idx<3 else 24,int(remaining_base-3))
        if budget<12:break
        seed=(429,41,1701,7919,31337,97,811,2027,65537)[idx%9]
        continuous=idx>=3
        r=_attempt(g,gap,budget,seed,continuous,attempts,'base-10')
        if r.get('ok') and r.get('fits'):
            base=(g,r);break
        _learn_failed(g,r)

    if not base:
        return jsonify(ok=False,error='Motor Lab no recuperó la base segura de 10 dentro del presupuesto.',engine='Motor Lab smart-2',selectorVersion='smart-2',attempts=attempts,candidatePool=len(kits),elapsedSeconds=round(time.time()-started,1)),422

    best_selected,best_result=base
    for x in best_selected:_memory[_key(x)]=max(-1.5,_memory.get(_key(x),0.0)-.35)

    # Expansión protegida: la base 10 ya está guardada. Cada intento puede mover
    # las piezas en el laboratorio, pero un fallo jamás reemplaza el piso válido.
    extras=_expansion_pool(kits,best_selected)
    for extra_idx,extra in enumerate(extras):
        remaining=MAX_SECONDS-(time.time()-started)
        if remaining<18:break
        candidate=best_selected+[extra]
        budget=min(24,int(remaining-5))
        if budget<12:break
        r=_attempt(candidate,gap,budget,7001+extra_idx*97,True,attempts,'expand-11')
        if r.get('ok') and r.get('fits'):
            best_selected,best_result=candidate,r
            break

    if len(best_selected)>=11:
        extras12=_expansion_pool(kits,best_selected)
        for extra_idx,extra in enumerate(extras12[:5]):
            remaining=MAX_SECONDS-(time.time()-started)
            if remaining<18:break
            candidate=best_selected+[extra]
            budget=min(22,int(remaining-5))
            if budget<12:break
            r=_attempt(candidate,gap,budget,17011+extra_idx*101,True,attempts,'expand-12')
            if r.get('ok') and r.get('fits'):
                best_selected,best_result=candidate,r
                break

    label=f'Motor Lab protegido: {len(best_selected)} completas (piso 10 conservado)'
    response=ns._result_payload(best_selected,label,best_result,kits,rejected,attempts,started,None)
    payload=response.get_json(); payload.update({'engine':'Motor Lab smart-2 · Sparrow + V1.7','selectorVersion':'smart-2','smartSelection':True,'candidatePool':len(kits),'minimumGapMm':gap,'protectedBase10':True,'improvedAbove10':len(best_selected)>10,'completeFigures':len(best_selected)})
    return jsonify(payload)

ns.nest_sparrow=intelligent_nest
if 'nest_sparrow' in ns.app.view_functions: ns.app.view_functions['nest_sparrow']=intelligent_nest
