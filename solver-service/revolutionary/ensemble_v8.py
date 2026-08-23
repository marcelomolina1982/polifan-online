"""TVT Revolutionary Ensemble V10 — workshop topology + deep repair + U-Nesting rescue.

The incumbent is always certified by the existing TVT geometry validator. U-Nesting
is only a proposal engine used when local/deep Sparrow repair stalls at N complete
kits. It may win only if the complete N+1 layout independently certifies at >=3 mm,
with zero collisions and zero border violations.
"""
from __future__ import annotations

import time

from revolutionary import ensemble_v4 as v4
from revolutionary import ensemble_v6 as v6
from revolutionary.topology_v8 import workshop_seeds
from revolutionary.deep_lns_v9 import deep_grow_beam
from revolutionary import unesting_v9

ENGINE='TVT Revolutionary Ensemble V10-certified-portfolio'
MAX_COMPLETE=18


def _row_from_result(result,prepared_kits):
    ids=[];seen=set()
    for p in result.get('placements') or []:
        kid=str(p.get('kitId') or '')
        if kid and kid not in seen:seen.add(kid);ids.append(kid)
    by={str(k.get('kitId') or ''):k for k in prepared_kits}
    kits=[by[x] for x in ids if x in by]
    if not kits:return None
    candidate=type('V10BaseCandidate',(),{'label':str(result.get('selectionStrategy') or 'v6-base'),'kits':kits})()
    return {'candidate':candidate,'seed':result.get('seed'),'result':{'ok':True,'fits':True,'placements':result.get('placements') or [],'density':float(result.get('density') or 0),'stripWidthMm':float(result.get('stripWidthMm') or 0),'elapsedSeconds':float(result.get('elapsedSeconds') or 0)},'certified':True,'certificate':result.get('productionCertificate') or {}}


def _best(rows):
    good=[r for r in rows if r and r.get('certified')]
    if not good:return None
    return sorted(good,key=v4._score,reverse=True)[0]


def _unesting_row(selected,strategy,milliseconds):
    """Run one U-Nesting candidate and pass it through the normal TVT certifier."""
    started=time.time()
    try:
        proposal=unesting_v9.solve(selected,strategy=strategy,time_limit_ms=max(2500,int(milliseconds)))
    except Exception as exc:
        return None,{'phase':'u-nesting-rescue','strategy':strategy,'target':len(selected),'certified':False,'error':str(exc)[:260]}
    placements=list(proposal.get('placements') or [])
    expected=sum(len(k.get('parts') or []) for k in selected)
    density=100.0*sum(float(k.get('area') or 0.0) for k in selected)/(1220.0*580.0)
    result={'ok':bool(proposal.get('ok')),'fits':bool(proposal.get('ok')) and len(placements)==expected,
            'placements':placements,'density':density,'stripWidthMm':1220.0,
            'elapsedSeconds':round(time.time()-started,2),'externalEngine':proposal.get('engine'),'externalStrategy':strategy}
    ok,cert=v4._certified(selected,result)
    candidate=type('V10UNestingCandidate',(),{'label':f'u-nesting-{strategy}-{len(selected)}','kits':selected})()
    row={'candidate':candidate,'seed':None,'result':result,'certified':ok,'certificate':cert}
    attempt={'phase':'u-nesting-rescue','strategy':strategy,'target':len(selected),'certified':bool(ok),
             'placedParts':len(placements),'expectedParts':expected,'gapMm':cert.get('minimumGapMmCertified'),
             'collisionCount':cert.get('collisionCount'),'outsidePlateCount':cert.get('outsidePlateCount'),
             'elapsedSeconds':result['elapsedSeconds'],'error':str(proposal.get('error') or '')[:260]}
    return row,attempt


def _unesting_rescue(beam,prepared_kits,target,deadline):
    """Try full N+1 repacks around the strongest incumbents.

    We deliberately vary the extra kit instead of sending the whole pending pool: the
    external engine gets exactly complete kits and therefore cannot win with orphan
    bases/tops. Every returned candidate is certified again by TVT.
    """
    if not unesting_v9.available() or deadline-time.time()<4:return [],[]
    rows=[];attempts=[];seen=set()
    strategies=('alns','gdrr','brkga','ga')
    for base in beam[:2]:
        current=list(base['candidate'].kits)
        current_ids={str(k.get('kitId') or '') for k in current}
        extras=[k for k in prepared_kits if str(k.get('kitId') or '') not in current_ids]
        extras=sorted(extras,key=v4._extra_rank)[:5]
        for extra in extras:
            selected=current+[extra]
            if len(selected)!=target:continue
            sig=tuple(sorted(str(k.get('kitId') or '') for k in selected))
            if sig in seen:continue
            seen.add(sig)
            for strategy in strategies:
                remain=deadline-time.time()
                if remain<3:return v4._unique_beam(rows,width=4),attempts
                ms=int(max(2500,min(12000,remain*1000/2.2)))
                row,attempt=_unesting_row(selected,strategy,ms)
                attempts.append(attempt)
                if row and row.get('certified'):
                    rows.append(row)
                    if len(row['candidate'].kits)>=target:
                        return v4._unique_beam(rows,width=4),attempts
    return v4._unique_beam(rows,width=4),attempts


def revolutionary_solve_v8(prepared_kits,total_seconds=180.0,max_workers=4):
    started=time.time();budget=max(60.0,float(total_seconds));deadline=started+budget
    attempts=[]

    topo=workshop_seeds(prepared_kits)
    for row in topo:
        r=row.get('result') or {};cert=row.get('certificate') or {}
        attempts.append({'phase':'workshop-topology','label':row['candidate'].label,'target':len(row['candidate'].kits),'certified':bool(row.get('certified')),'density':round(float(r.get('density') or 0),2),'gapMm':cert.get('minimumGapMmCertified'),'collisionCount':cert.get('collisionCount'),'outsidePlateCount':cert.get('outsidePlateCount')})
    topo_best=_best(topo)

    topo_count=len(topo_best['candidate'].kits) if topo_best else 0
    if topo_count>=12:
        base_budget=max(36.0,min(52.0,budget*0.28))
    else:
        # Preserve time for deep repair and the independent U-Nesting family.
        base_budget=max(44.0,min(68.0,budget*0.40))
    base=v6.revolutionary_solve_v6(prepared_kits,total_seconds=base_budget,max_workers=max_workers)
    base_row=_row_from_result(base,prepared_kits) if base.get('ok') else None
    if base.get('attempts'):attempts.extend(base.get('attempts') or [])

    best=_best([topo_best,base_row])
    if best is None:
        return {'ok':False,'engine':ENGINE,'error':'Neither workshop topology nor V6 produced a certified incumbent','attempts':attempts,'elapsedSeconds':round(time.time()-started,2)}

    climb=[]
    if base.get('climbHistory'):climb.extend(base.get('climbHistory') or [])
    count=len(best['candidate'].kits)
    if not climb or climb[-1]!=count:climb.append(count)
    beam=v4._unique_beam([x for x in [topo_best,base_row] if x and x.get('certified')],width=4)

    ceiling=min(MAX_COMPLETE,len(prepared_kits))
    while count<ceiling and deadline-time.time()>10:
        remaining=deadline-time.time()
        local_cap=20.0 if count>=9 else 28.0
        step_deadline=min(deadline,time.time()+min(local_cap,max(8.0,remaining*0.34)))
        grown,rows=v4.lns_grow_beam(beam,prepared_kits,step_deadline,max_workers=max(1,min(4,max_workers)),extras_per_base=10 if count<=12 else 6)
        attempts.extend(rows)

        if not grown and count>=8 and deadline-time.time()>12:
            attempts.append({'phase':'deep-lns-trigger','target':count+1,'certified':False,'reason':'local LNS stalled; freeing 3-5 complete kits for topology change'})
            deep_slice=min(28.0,max(8.0,(deadline-time.time())*0.42))
            deep_deadline=min(deadline,time.time()+deep_slice)
            grown,deep_rows=deep_grow_beam(beam,prepared_kits,deep_deadline,max_workers=max(1,min(4,max_workers)),extras_per_base=7 if count<=11 else 5)
            attempts.extend(deep_rows)

        if not grown and deadline-time.time()>4:
            attempts.append({'phase':'u-nesting-trigger','target':count+1,'certified':False,'available':unesting_v9.available(),'reason':'Sparrow local/deep repair stalled; trying independent full N+1 repack'})
            grown,urows=_unesting_rescue(beam,prepared_kits,count+1,deadline)
            attempts.extend(urows)

        if not grown:
            attempts.append({'phase':'v10-portfolio-practical-maximum','target':count+1,'certified':False,'reason':'local, deep and U-Nesting certified rescue exhausted; incumbent preserved'})
            break

        candidate=grown[0]
        if v4._score(candidate)>v4._score(best):best=candidate
        beam=v4._unique_beam(grown+beam,width=4)
        count=len(best['candidate'].kits)
        if climb[-1]!=count:climb.append(count)

    r=best.get('result') or {};cert=best.get('certificate') or {};final=len(best['candidate'].kits)
    label=str(best['candidate'].label)
    source='workshop-topology' if label.startswith('workshop-topology') else ('u-nesting' if label.startswith('u-nesting-') else ('deep-lns' if label.startswith('lns-deep-') else 'v6-or-lns'))
    return {'ok':True,'engine':ENGINE,'completeFigures':final,'commercialTarget':v4.COMMERCIAL_TARGET,'probablePracticalMaximum':final,'selectionStrategy':label,'incumbentSource':source,'seed':best.get('seed'),'density':float(r.get('density') or 0),'stripWidthMm':float(r.get('stripWidthMm') or 0),'placements':r.get('placements') or [],'productionCertificate':cert,'minimumGapMm':cert.get('minimumGapMmCertified'),'requiredGapMm':v4.MIN_GAP_MM,'targetDensityReached':float(r.get('density') or 0)>=v4.TARGET_DENSITY,'workshopTopologyTried':len(topo),'workshopTopologyCertified':sum(1 for x in topo if x.get('certified')),'uNestingAvailable':unesting_v9.available(),'searchPhilosophy':'certified topology -> V6 incumbent -> local repair -> deep repair -> certified U-Nesting full repack','deepNeighborhoodSizes':[3,4,5],'climbHistory':climb,'attempts':attempts,'elapsedSeconds':round(time.time()-started,2)}
