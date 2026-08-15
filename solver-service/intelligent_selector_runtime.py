from flask import request, jsonify
import time, random
import nest_sparrow as ns

# Selector inteligente especializado: decide QUE 10 probar; Sparrow sólo acomoda.
# Aprende durante la vida de la instancia de los grupos que fallan/funcionan.
MAX_POOL=64
MAX_SECONDS=235
PORTFOLIO=9
_memory={}
# Anclas de la primera placa real certificada. Si siguen pendientes, reciben bonus;
# si ya fueron consumidas simplemente se ignoran.
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
    # Ventanas diversas: no repetir diez casi iguales.
    for off in (2,5,8,12): add(ordered[off:off+10])
    # Mezcla anclas conocidas + candidatos compactos actuales.
    anchors=[k for k in ordered if _key(k) in POSITIVE_NAMES]
    rest=[k for k in ordered if k not in anchors]
    add((anchors+rest)[:10])
    # Exploración determinista de candidatos prioritarios/compactos.
    rng=random.Random(429)
    top=ordered[:min(30,len(ordered))]
    for _ in range(12):
        sample=sorted(rng.sample(top,10),key=_score)
        add(sample)
        if len(groups)>=PORTFOLIO:break
    return groups[:PORTFOLIO]

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
    groups=_portfolio(kits); attempts=[]; best=None
    for idx,g in enumerate(groups):
        remaining=MAX_SECONDS-(time.time()-started)
        if remaining<18:break
        # Sparrow recibe grupos completos de 10; no decide selección.
        budget=min(34 if idx<3 else 26,int(remaining-5))
        seed=(429,41,1701,7919,31337,97,811,2027,65537)[idx%9]
        continuous=idx>=3
        r=ns._run_sparrow(g,gap,budget,seed,continuous=continuous)
        attempts.append({'candidate':idx+1,'figures':[x['figure'] for x in g],'fits':r.get('fits'),'placedParts':r.get('placedParts'),'expectedParts':r.get('expectedParts'),'density':round(float(r.get('density') or 0),1),'seconds':budget,'continuous':continuous})
        if r.get('ok') and r.get('fits'):
            best=(g,r); break
        # Aprendizaje liviano: penalizar especialmente las piezas de grupos que fallan.
        ratio=float(r.get('placedParts') or 0)/max(1,float(r.get('expectedParts') or 20))
        penalty=max(.02,(1-ratio)*.18)
        for x in g:_memory[_key(x)]=min(1.5,_memory.get(_key(x),0.0)+penalty)
    if not best:
        return jsonify(ok=False,error='El selector inteligente propuso grupos distintos de 10, pero Sparrow no certificó ninguno dentro del presupuesto.',engine='Selector inteligente + Sparrow + V1.7',selectorVersion='smart-1',attempts=attempts,candidatePool=len(kits),elapsedSeconds=round(time.time()-started,1)),422
    selected,result=best
    for x in selected:_memory[_key(x)]=max(-1.5,_memory.get(_key(x),0.0)-.35)
    response=ns._result_payload(selected,'selector inteligente: 10 candidatas aprendidas',result,kits,rejected,attempts,started,None)
    payload=response.get_json(); payload.update({'engine':'Selector inteligente + Sparrow + huecos + V1.7','selectorVersion':'smart-1','smartSelection':True,'candidatePool':len(kits),'minimumGapMm':gap})
    return jsonify(payload)

ns.nest_sparrow=intelligent_nest
if 'nest_sparrow' in ns.app.view_functions: ns.app.view_functions['nest_sparrow']=intelligent_nest
