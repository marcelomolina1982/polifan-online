"""Simulated-annealing escape layer for the isolated Polifan nesting lab.

This module does not replace Sparrow.  It perturbs kit order/selection aggressively,
lets Sparrow solve the real polygons with continuous rotation, and deliberately accepts
worse intermediate states while temperature is high.  The lexicographic objective is:
1) complete target set fits, 2) more parts placed, 3) less strip width / fragmentation.
"""
import math
import random
import time


def _state_signature(rows):
    return tuple(str(k.get('kitId') or '') for k in rows)


def _result_energy(result, target_count):
    """Lower is better. A complete target fit dominates every partial solution."""
    if not isinstance(result, dict) or not result.get('ok'):
        return 1e12
    expected=max(1, int(result.get('expectedParts') or target_count*2 or 1))
    placed=max(0, int(result.get('placedParts') or len(result.get('placements') or [])))
    missing=max(0, expected-placed)
    strip=float(result.get('stripWidthMm') or 1e6)
    solver_density=float(result.get('solverDensity') or 0.0)
    if result.get('fits') and missing==0:
        return -1e9 + strip*100.0 - solver_density*10.0
    # Missing even one physical component must be extremely expensive, but still
    # gives SA a gradient so it can cross bad intermediate orderings.
    return missing*1e7 + strip*100.0 - placed*2e5 - solver_density*10.0


def _violent_mutation(state, anchors, pool, rng, temperature):
    rows=list(state)
    fixed=list(rows[:anchors])
    tail=list(rows[anchors:])
    if not tail:
        return rows
    op=rng.randrange(5)
    if op==0 and len(tail)>=2:
        a,b=rng.sample(range(len(tail)),2);tail[a],tail[b]=tail[b],tail[a]
    elif op==1:
        rng.shuffle(tail)
    elif op==2 and len(tail)>=3:
        a,b=sorted(rng.sample(range(len(tail)),2));tail[a:b+1]=reversed(tail[a:b+1])
    elif op==3:
        used={str(k.get('kitId') or '') for k in rows}
        outsiders=[k for k in pool if str(k.get('kitId') or '') not in used]
        if outsiders:
            idx=rng.randrange(len(tail));tail[idx]=rng.choice(outsiders)
        else:
            rng.shuffle(tail)
    else:
        # violent block relocation; larger at high temperature
        n=len(tail)
        span=max(1,min(n,int(round(1+(temperature*max(1,n-1))))))
        start=rng.randrange(n);idxs=[(start+i)%n for i in range(span)]
        block=[tail[i] for i in idxs]
        rest=[v for i,v in enumerate(tail) if i not in set(idxs)]
        rng.shuffle(block);insert=rng.randrange(len(rest)+1);tail=rest[:insert]+block+rest[insert:]
    # Remove accidental duplicates introduced by replacement and refill deterministically.
    out=[];seen=set()
    for k in fixed+tail:
        kid=str(k.get('kitId') or '')
        if kid and kid not in seen:
            seen.add(kid);out.append(k)
    for k in pool:
        kid=str(k.get('kitId') or '')
        if len(out)>=len(state):break
        if kid and kid not in seen:
            seen.add(kid);out.append(k)
    return out[:len(state)]


def anneal_plus_one(selected, kits, anchor_kept, run_attempt, deadline,
                    max_iterations=18, seconds_per_attempt=5, seed=92821):
    """Try to escape the greedy local minimum and fit one additional complete kit.

    run_attempt(rows, label, seed, seconds) must invoke Sparrow on real geometry with
    continuous rotation and return its normal result dict.
    """
    used={str(k.get('kitId') or '') for k in selected}
    pending=[k for k in kits if str(k.get('kitId') or '') not in used]
    if not pending:
        return None, {'iterations':0,'acceptedWorse':0,'reason':'no-pending'}

    # Start with the most compact pending candidates; for a larger pool SA may replace
    # non-urgent members, but it never drops the protected urgent anchors.
    pending=sorted(pending,key=lambda k:(float(k.get('envelope') or 1e18),-float(k.get('solidity') or 0),int(k.get('priority') or 999999)))
    target=min(len(kits),len(selected)+1)
    state=list(selected)+pending[:max(0,target-len(selected))]
    if len(state)!=target:
        return None, {'iterations':0,'acceptedWorse':0,'reason':'cannot-build-target'}

    rng=random.Random(seed)
    current=list(state);current_energy=1e15
    best=None;best_energy=1e15;accepted_worse=0;seen=set();iterations=0
    temp=1.0
    while iterations<max_iterations and time.time()+max(2,seconds_per_attempt+1)<deadline:
        if iterations==0:
            candidate=list(current)
        else:
            candidate=_violent_mutation(current,min(anchor_kept,len(current)),kits,rng,temp)
        sig=_state_signature(candidate)
        if sig in seen:
            rng.shuffle(candidate[min(anchor_kept,len(candidate)):])
            sig=_state_signature(candidate)
        seen.add(sig)
        run_seed=seed+iterations*7919+rng.randrange(997)
        result=run_attempt(candidate,f'SA +1 iter {iterations+1}',run_seed,seconds_per_attempt)
        iterations+=1
        energy=_result_energy(result,target)
        if result.get('ok') and result.get('fits'):
            return (candidate,result), {'iterations':iterations,'acceptedWorse':accepted_worse,'target':target,'energy':energy,'success':True}
        if energy<best_energy:
            best=(list(candidate),result);best_energy=energy
        delta=energy-current_energy
        accept=energy<=current_energy
        if not accept and current_energy<1e14:
            scale=max(1.0,abs(current_energy)*0.025)
            accept=rng.random()<math.exp(-min(60.0,max(0.0,delta)/(scale*max(0.04,temp))))
            if accept:accepted_worse+=1
        if accept or current_energy>=1e14:
            current=list(candidate);current_energy=energy
        temp=max(0.04,temp*0.82)
    return None, {'iterations':iterations,'acceptedWorse':accepted_worse,'target':target,'bestEnergy':best_energy,'success':False}
