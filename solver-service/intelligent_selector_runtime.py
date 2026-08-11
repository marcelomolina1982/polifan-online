from flask import request, jsonify
import time, random
import nest_sparrow as ns
from shapely.affinity import rotate
from shapely.ops import unary_union
from fixed_hole_fill import _placed_geometry, _safe_plate, _all_polygons

MAX_POOL=64
# La base 10 ya está estable. Buscamos varias bases válidas dentro de un presupuesto
# acotado y elegimos la que además de ser densa deja huecos aprovechables para 11+.
MAX_SECONDS=190
PORTFOLIO=7
MAX_VALID_BASES=3
_memory={}
POSITIVE_NAMES={'gato','gato con luces','auto','chase paw patrol','chopp','abejita','boca','woody toy story'}


def _key(k): return str(k.get('figure') or '').strip().lower()
def _difficulty(k):
    env=float(k.get('envelope') or 1); area=max(1.0,float(k.get('area') or 1)); sol=max(.01,float(k.get('solidity') or .01))
    return env/area + (1-sol)*1.8

def _score(k):
    name=_key(k); learned=_memory.get(name,0.0); positive=-2.5 if name in POSITIVE_NAMES else 0.0
    return (float(k.get('priority') or 9),_difficulty(k)+learned+positive,float(k.get('envelope') or 0))

def _portfolio(kits):
    ordered=sorted(kits,key=_score); groups=[]; seen=set()
    def add(g):
        if len(g)!=10:return
        sig=tuple(sorted(str(x.get('kitId')) for x in g))
        if sig not in seen:seen.add(sig); groups.append(g)
    add(ordered[:10])
    for off in (2,5,8):add(ordered[off:off+10])
    anchors=[k for k in ordered if _key(k) in POSITIVE_NAMES]; rest=[k for k in ordered if k not in anchors]
    add((anchors+rest)[:10])
    rng=random.Random(429); top=ordered[:min(30,len(ordered))]
    for _ in range(8):
        add(sorted(rng.sample(top,10),key=_score))
        if len(groups)>=PORTFOLIO:break
    return groups[:PORTFOLIO]


def _occupied(selected,result):
    by_instance={}
    for kit in selected:
        for part in kit.get('parts') or []:
            by_instance[str(part.get('instanceId') or '')]=part
    geoms=[]
    plate=_safe_plate()
    for p in result.get('placements') or []:
        part=by_instance.get(str(p.get('instanceId') or ''))
        if part is None:return None
        geom=_placed_geometry(part,p)
        if not plate.covers(geom):return None
        geoms.append(geom)
    return unary_union(geoms) if geoms else None


def _fits_region(part,regions):
    geom=part.get('geom')
    if geom is None or geom.is_empty:return False
    for angle in (0.0,90.0,180.0,270.0,45.0,135.0,225.0,315.0):
        rg=rotate(geom,angle,origin=(0,0),use_radians=False)
        minx,miny,maxx,maxy=rg.bounds; w=maxx-minx; h=maxy-miny
        for region in regions:
            rx0,ry0,rx1,ry1=region.bounds
            if w <= (rx1-rx0)+1e-6 and h <= (ry1-ry0)+1e-6:
                return True
    return False


def _future_hole_score(selected,result,all_kits,gap_mm):
    occ=_occupied(selected,result)
    if occ is None:return {'score':-1e9,'compatible':0,'holeCount':0,'largestHolePct':0.0}
    plate=_safe_plate()
    free=plate.difference(occ.buffer(float(gap_mm)/2.0,join_style=2))
    regions=sorted(_all_polygons(free),key=lambda g:g.area,reverse=True)[:16]
    if not regions:return {'score':float(result.get('density') or 0),'compatible':0,'holeCount':0,'largestHolePct':0.0}
    used={str(k.get('kitId') or '') for k in selected}
    compatible=0
    for kit in all_kits:
        if str(kit.get('kitId') or '') in used:continue
        parts=kit.get('parts') or []
        if parts and all(_fits_region(part,regions) for part in parts):compatible+=1
    plate_area=max(1.0,float(plate.area))
    largest_pct=100.0*float(regions[0].area)/plate_area
    useful=sum(1 for r in regions if float(r.area)/plate_area >= .025)
    density=float(result.get('density') or 0)
    # Densidad manda, pero una base con huecos futuros útiles puede ganar frente a
    # otra apenas más densa y completamente fragmentada.
    score=density + min(8.0,compatible*.35) + min(4.0,largest_pct*.16) + min(2.0,useful*.35)
    return {'score':score,'compatible':compatible,'holeCount':len(regions),'usefulHoles':useful,'largestHolePct':round(largest_pct,2),'density':density}


def intelligent_nest():
    started=time.time(); data=request.get_json(silent=True) or {}
    width=max(1.0,ns._n(data.get('widthCm'),122)*10); height=max(1.0,ns._n(data.get('heightCm'),58)*10)
    requested_gap=max(3.0,ns._n(data.get('gapCm'),.3)*10)
    raw=sorted(data.get('kits') or [],key=lambda k:(ns._priority(k),str(k.get('date') or ''),str(k.get('figure') or '')))[:MAX_POOL]
    kits=[]; rejected=[]
    for k in raw:
        try:kits.append(ns._prep_kit(k,width,height))
        except Exception as exc:rejected.append({'figure':str(k.get('figure') or ''),'reason':str(exc)})
    if len(kits)<10:return jsonify(ok=False,error=f'Sólo hay {len(kits)} kits utilizables'),422
    groups=_portfolio(kits); attempts=[]; valid_bases=[]
    for idx,g in enumerate(groups):
        remaining=MAX_SECONDS-(time.time()-started)
        if remaining<18:break
        budget=min(25 if idx<3 else 20,int(remaining-5)); seed=(429,41,1701,7919,31337,97,811)[idx%7]
        continuous=idx>=3
        r=ns._run_sparrow(g,requested_gap,budget,seed,continuous=continuous)
        record={'candidate':idx+1,'figures':[x['figure'] for x in g],'fits':r.get('fits'),'placedParts':r.get('placedParts'),'expectedParts':r.get('expectedParts'),'density':round(float(r.get('density') or 0),1),'seconds':budget,'continuous':continuous}
        if r.get('ok') and r.get('fits'):
            future=_future_hole_score(g,r,kits,requested_gap)
            record['futureHoleScore']=round(float(future.get('score') or 0),2)
            record['futureCompatible']=future.get('compatible',0)
            record['largestHolePct']=future.get('largestHolePct',0)
            valid_bases.append((float(future.get('score') or -1e9),g,r,future))
            if len(valid_bases)>=MAX_VALID_BASES:break
        else:
            ratio=float(r.get('placedParts') or 0)/max(1,float(r.get('expectedParts') or 20)); penalty=max(.02,(1-ratio)*.18)
            for x in g:_memory[_key(x)]=min(1.5,_memory.get(_key(x),0.0)+penalty)
        attempts.append(record)
    if not valid_bases:return jsonify(ok=False,error='El selector inteligente propuso grupos distintos de 10, pero Sparrow no certificó ninguno dentro del presupuesto.',engine='Selector inteligente + Sparrow + V1.7',selectorVersion='smart-1.3',attempts=attempts,candidatePool=len(kits),elapsedSeconds=round(time.time()-started,1)),422
    valid_bases.sort(key=lambda row:row[0],reverse=True)
    _,selected,result,future=valid_bases[0]
    for x in selected:_memory[_key(x)]=max(-1.5,_memory.get(_key(x),0.0)-.35)
    response=ns._result_payload(selected,'selector inteligente: mejor base 10 por densidad + huecos futuros',result,kits,rejected,attempts,started,None)
    payload=response.get_json()
    if not isinstance(payload,dict):return response
    if not payload.get('ok'):return response
    certificate=payload.get('productionCertificate') or {}
    measured=certificate.get('minimumGapMmCertified')
    if measured is None or float(measured)<3.0:
        return jsonify(ok=False,error='Bloqueo de seguridad: la placa no alcanza 3 mm reales certificados',productionCertificate=certificate,completeFigures=len(selected)),422
    payload.update({'engine':'Selector inteligente + Sparrow + V1.7','selectorVersion':'smart-1.3','smartSelection':True,'candidatePool':len(kits),'requestedGapMm':requested_gap,'minimumGapMm':measured,'requiredGapMm':3.0,'base10ElapsedSeconds':round(time.time()-started,1),'base10Alternatives':len(valid_bases),'futureHoleScore':round(float(future.get('score') or 0),2),'futureCompatibleKits':future.get('compatible',0),'largestFutureHolePct':future.get('largestHolePct',0),'usefulFutureHoles':future.get('usefulHoles',0)})
    return jsonify(payload)

ns.nest_sparrow=intelligent_nest
if 'nest_sparrow' in ns.app.view_functions:ns.app.view_functions['nest_sparrow']=intelligent_nest
