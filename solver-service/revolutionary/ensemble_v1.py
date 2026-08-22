"""TVT Revolutionary Ensemble V3.0.

Laboratory-only nesting ensemble. Production is not wired to this module.
The geometry core stays Sparrow/Jagua; orchestration is TVT-specific:
complete figures first, real 3 mm certification, geometry-aware portfolios,
multiple deterministic seeds, and an incumbent warm-start grow stage that
repairs a certified base-10 while injecting an 11th complete figure.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import os
import subprocess
import tempfile
import time

import nest_sparrow as ns
from revolutionary.selector_v2 import portfolios as select_portfolios

MIN_COMPLETE = 10
MAX_COMPLETE = 16
MIN_GAP_MM = 3.0
SOLVER_GAP_MM = 3.2
TARGET_DENSITY = 70.0
SEEDS = (41, 429, 1701, 7919, 31337, 65537, 104729, 130363)
SPARROW_BIN = os.environ.get('SPARROW_BIN','/usr/local/bin/sparrow')


def solution_score(selected, result):
    count = len(selected)
    density = float((result or {}).get('density') or 0.0)
    width = float((result or {}).get('stripWidthMm') or 1e18)
    seconds = float((result or {}).get('elapsedSeconds') or 1e18)
    return (count, density, -width, -seconds)


def certified(selected, result):
    if not result or not result.get('ok') or not result.get('fits'):
        return False, {}
    validator = getattr(ns, '_validate_final_geometry', None)
    if validator is None:
        return False, {'reason': 'certifier unavailable'}
    valid, cert = validator(selected, result)
    gap = cert.get('minimumGapMmCertified')
    return bool(valid and gap is not None and float(gap) >= MIN_GAP_MM), cert


def _run_one(candidate, seconds, seed):
    result = ns._run_sparrow(candidate.kits, MIN_GAP_MM, seconds, seed, continuous=True)
    ok, cert = certified(candidate.kits, result)
    return {'candidate': candidate, 'seed': seed, 'result': result, 'certified': ok, 'certificate': cert}


def _attempt_row(row, target, phase='race'):
    c = row['candidate']
    r = row['result'] or {}
    return {
        'phase': phase,
        'label': c.label,
        'seed': row['seed'],
        'target': target,
        'certified': row['certified'],
        'density': round(float(r.get('density') or 0.0), 2),
        'stripWidthMm': round(float(r.get('stripWidthMm') or 0.0), 2),
        'elapsedSeconds': r.get('elapsedSeconds'),
        'gapMm': row['certificate'].get('minimumGapMmCertified'),
        'fits': bool(r.get('fits')),
        'error': str(r.get('error') or '')[:300],
        'logTail': str(r.get('log') or '')[-600:],
    }


def run_level(kits, target, deadline, seconds_per_run=8.0, max_portfolios=14, max_workers=4, phase='race', stop_on_first=False):
    candidates = select_portfolios(kits, target, max_portfolios)
    if not candidates:
        return None, []
    jobs=[]
    for idx,c in enumerate(candidates):
        jobs.append((c, SEEDS[(idx*2) % len(SEEDS)])); jobs.append((c, SEEDS[(idx*2+1) % len(SEEDS)]))
    best=None; attempts=[]; wave_size=max_workers*2
    for start in range(0,len(jobs),wave_size):
        remaining=deadline-time.time()
        if remaining < 2.5: break
        wave=jobs[start:start+wave_size]
        per=max(2.2,min(seconds_per_run, remaining/max(1,len(wave)/max_workers)))
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            future_map={pool.submit(_run_one,c,per,seed):(c,seed) for c,seed in wave}
            for fut in as_completed(future_map):
                try: row=fut.result()
                except Exception as exc:
                    c,seed=future_map[fut]; attempts.append({'phase':phase,'label':c.label,'seed':seed,'target':target,'certified':False,'error':str(exc)[:300]}); continue
                attempts.append(_attempt_row(row,target,phase))
                if row['certified'] and (best is None or solution_score(row['candidate'].kits,row['result']) > solution_score(best['candidate'].kits,best['result'])): best=row
        if best is not None and (stop_on_first or target == 10): break
        if best is not None:
            r=best['result'] or {}
            if float(r.get('density') or 0.0) >= 72.0 and float(r.get('stripWidthMm') or 1e18) <= 1180.0: break
    return best, attempts


def _optimistic_area_possible(kits, target):
    if len(kits) < target: return False
    plate_area=float(getattr(ns,'PLATE_AREA_MM2',1220.0*580.0))
    smallest=sorted(max(0.0,float(k.get('area') or 0.0)) for k in kits)[:target]
    return sum(smallest) <= plate_area*0.98


def _extra_rank(k):
    area=max(1.0,float(k.get('area') or 1.0))
    env=max(area,float(k.get('envelope') or area))
    solidity=max(0.01,float(k.get('solidity') or area/env))
    priority=float(k.get('priority') or 999999)
    return (priority, env/solidity, -area)


def _warm_result(selected, out, elapsed, log_tail=''):
    sol=(out or {}).get('solution') or {}
    layout=sol.get('layout') or {}
    rows=layout.get('placed_items') or []
    idmap={}
    item_id=0
    for kit in selected:
        for part in kit.get('parts') or []:
            idmap[item_id]=part
            item_id+=1
    placements=[]
    for row in rows:
        part=idmap.get(int(row.get('item_id',-1)))
        if not part: continue
        tr=row.get('transformation') or {}
        trans=tr.get('translation') or [0,0]
        tx=float(trans[0] if len(trans)>0 else 0.0); ty=float(trans[1] if len(trans)>1 else 0.0)
        placements.append({
            'instanceId':part['instanceId'],'kitId':part['kitId'],'figure':part['figure'],
            'name':part['name'],'role':part['role'],'xCm':tx/10.0,'yCm':ty/10.0,
            'angle':float(tr.get('rotation') or 0.0),'trimXCm':part['trimXmm']/10.0,
            'trimYCm':part['trimYmm']/10.0,'partialExtra':False,
        })
    expected=sum(len(k.get('parts') or []) for k in selected)
    strip=float(sol.get('strip_width') or 1e18)
    density=100.0*sum(float(k.get('area') or 0.0) for k in selected)/(1220.0*580.0)
    return {
        'ok':True,'fits':len(placements)==expected and strip<=1220.5,
        'stripWidthMm':strip,'density':density,'placements':placements,
        'elapsedSeconds':round(elapsed,2),'solverDensity':float(sol.get('density') or 0.0)*100.0,
        'placedParts':len(placements),'expectedParts':expected,'continuousRotation':True,
        'log':log_tail,
    }


def _warm_grow_one(base, extra, seconds, seed):
    selected=list(base['candidate'].kits)+[extra]
    base_placements={(p.get('instanceId') or ''):p for p in ((base.get('result') or {}).get('placements') or [])}
    items=[]; placed=[]; item_id=0
    base_width=float((base.get('result') or {}).get('stripWidthMm') or 1000.0)
    inject_x=max(650.0,min(1030.0,base_width-120.0))
    inject_y_slots=(20.0,300.0,145.0,420.0)
    for kit in selected:
        is_extra=str(kit.get('kitId'))==str(extra.get('kitId'))
        for part_index,part in enumerate(kit.get('parts') or []):
            items.append({'id':item_id,'demand':1,'shape':part['shape']})
            bp=base_placements.get(part.get('instanceId') or '')
            if bp is not None and not is_extra:
                tx=float(bp.get('xCm') or 0.0)*10.0; ty=float(bp.get('yCm') or 0.0)*10.0; rot=float(bp.get('angle') or 0.0)
            else:
                minx,miny,maxx,maxy=part['geom'].bounds
                width=maxx-minx; height=maxy-miny
                tx=max(-minx, min(1220.0-maxx, inject_x-minx+(part_index%2)*35.0))
                slot=inject_y_slots[part_index % len(inject_y_slots)]
                ty=max(-miny, min(580.0-maxy, slot-miny))
                rot=0.0
            placed.append({'item_id':item_id,'transformation':{'rotation':rot,'translation':[float(tx),float(ty)]}})
            item_id+=1
    area=sum(float(k.get('area') or 0.0) for k in selected)
    initial_width=max(1220.0,base_width)
    warm={'name':'tvt_incumbent_grow','items':items,'strip_height':580.0,'solution':{'strip_width':initial_width,'layout':{'container_id':0,'placed_items':placed,'density':area/max(1.0,initial_width*580.0)},'density':area/max(1.0,initial_width*580.0),'run_time_sec':0}}
    started=time.time()
    with tempfile.TemporaryDirectory(prefix='tvt-warm-grow-') as td:
        inp=os.path.join(td,'warm.json')
        with open(inp,'w',encoding='utf-8') as f: json.dump(warm,f,separators=(',',':'))
        cmd=[SPARROW_BIN,'-i',inp,'-t',str(max(2,int(seconds))),'--min-item-separation',str(SOLVER_GAP_MM),'--workers','1','-s',str(int(seed)),'-x']
        try:
            proc=subprocess.run(cmd,cwd=td,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=seconds+18)
        except subprocess.TimeoutExpired as exc:
            tail=exc.stdout[-1200:] if isinstance(exc.stdout,str) else ''
            return {'candidate':type('WarmCandidate',(),{'label':'warm-grow','kits':selected})(),'seed':seed,'result':{'ok':False,'error':'warm grow timeout','log':tail},'certified':False,'certificate':{}}
        outpath=os.path.join(td,'output','final_tvt_incumbent_grow.json')
        if proc.returncode!=0 or not os.path.exists(outpath):
            return {'candidate':type('WarmCandidate',(),{'label':'warm-grow','kits':selected})(),'seed':seed,'result':{'ok':False,'error':f'warm grow exit {proc.returncode}','log':(proc.stdout or '')[-1200:]},'certified':False,'certificate':{}}
        with open(outpath,'r',encoding='utf-8') as f: out=json.load(f)
    result=_warm_result(selected,out,time.time()-started,(proc.stdout or '')[-1000:])
    ok,cert=certified(selected,result)
    label=f"warm-grow + {str(extra.get('figure') or extra.get('kitId') or '')[:42]}"
    candidate=type('WarmCandidate',(),{'label':label,'kits':selected})()
    return {'candidate':candidate,'seed':seed,'result':result,'certified':ok,'certificate':cert}


def warm_grow_from_base(base, all_kits, deadline, max_workers=4, limit_extras=8):
    used={str(k.get('kitId')) for k in base['candidate'].kits}
    extras=sorted([k for k in all_kits if str(k.get('kitId')) not in used],key=_extra_rank)[:limit_extras]
    attempts=[]; best=None
    if not extras: return None,attempts
    jobs=[]
    for idx,extra in enumerate(extras):
        jobs.append((extra,SEEDS[(idx*2) % len(SEEDS)]))
        if idx<4: jobs.append((extra,SEEDS[(idx*2+1) % len(SEEDS)]))
    wave_size=max_workers
    for start in range(0,len(jobs),wave_size):
        remaining=deadline-time.time()
        if remaining<4.0: break
        wave=jobs[start:start+wave_size]
        per=max(3.0,min(13.0,remaining/max(1,len(wave)/max_workers)))
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            futures={pool.submit(_warm_grow_one,base,extra,per,seed):(extra,seed) for extra,seed in wave}
            for fut in as_completed(futures):
                extra,seed=futures[fut]
                try: row=fut.result()
                except Exception as exc:
                    attempts.append({'phase':'incumbent-warm-grow','label':str(extra.get('figure') or ''),'seed':seed,'target':11,'certified':False,'error':str(exc)[:300]}); continue
                attempts.append(_attempt_row(row,11,'incumbent-warm-grow'))
                if row['certified'] and (best is None or solution_score(row['candidate'].kits,row['result'])>solution_score(best['candidate'].kits,best['result'])):
                    best=row
        if best is not None: break
    return best,attempts


def revolutionary_solve(prepared_kits, total_seconds=150.0, max_workers=4):
    started=time.time(); budget=max(30.0,float(total_seconds)); global_deadline=started+budget; all_attempts=[]; best=None
    last_target=min(MAX_COMPLETE,len(prepared_kits))
    base_seconds=max(12.0,min(24.0,budget*0.20)); base_deadline=min(global_deadline,time.time()+base_seconds)
    base,attempts=run_level(prepared_kits,10,deadline=base_deadline,seconds_per_run=5.5,max_portfolios=14,max_workers=max_workers,phase='base10',stop_on_first=True); all_attempts.extend(attempts)
    if base is None and global_deadline-time.time() >= 8.0:
        retry_deadline=min(global_deadline,time.time()+min(24.0,global_deadline-time.time()))
        base,attempts=run_level(prepared_kits,10,deadline=retry_deadline,seconds_per_run=7.5,max_portfolios=24,max_workers=max_workers,phase='base10-rescue',stop_on_first=True); all_attempts.extend(attempts)
    if base is None:
        return {'ok':False,'engine':'TVT Revolutionary Ensemble V3.0','error':'No certified base-10','attempts':all_attempts,'elapsedSeconds':round(time.time()-started,2)}
    best=base

    # V3: exploit a certified incumbent before spending budget on blind 11+ restarts.
    remaining=global_deadline-time.time()
    if last_target>=11 and remaining>=12.0:
        warm_deadline=min(global_deadline,time.time()+min(42.0,max(12.0,budget*0.32)))
        warm,attempts=warm_grow_from_base(base,prepared_kits,warm_deadline,max_workers=max_workers,limit_extras=10); all_attempts.extend(attempts)
        if warm is not None and solution_score(warm['candidate'].kits,warm['result'])>solution_score(best['candidate'].kits,best['result']):
            best=warm

    # If warm-grow already reached 11, spend remaining budget probing 12+; otherwise keep the old high-count race.
    floor_target=len(best['candidate'].kits)
    high_success=None
    for target in range(last_target,max(10,floor_target),-1):
        remaining=global_deadline-time.time()
        if remaining < 8.0: break
        if target<=floor_target: continue
        if not _optimistic_area_possible(prepared_kits,target): all_attempts.append({'phase':'high-probe-skip','target':target,'reason':'area bound'}); continue
        reserve11=0.0 if floor_target>=11 else min(24.0,max(10.0,budget*0.18))
        usable=max(0.0,remaining-reserve11) if target>11 else remaining
        if target>11 and usable<6.0: continue
        probe_seconds=min(14.0 if target>=14 else 17.0,max(6.0,usable)); probe_deadline=min(global_deadline,time.time()+probe_seconds)
        level,attempts=run_level(prepared_kits,target,deadline=probe_deadline,seconds_per_run=4.5 if target>=14 else 5.5,max_portfolios=10 if target>=14 else 14,max_workers=max_workers,phase='high-probe',stop_on_first=True); all_attempts.extend(attempts)
        if level is not None: high_success=level; best=level; break
    if high_success is not None:
        target=len(high_success['candidate'].kits); remaining=global_deadline-time.time()
        if remaining >= 8.0:
            refine_deadline=min(global_deadline,time.time()+min(22.0,remaining))
            refined,attempts=run_level(prepared_kits,target,deadline=refine_deadline,seconds_per_run=6.5,max_portfolios=18,max_workers=max_workers,phase='high-refine',stop_on_first=False); all_attempts.extend(attempts)
            if refined is not None and solution_score(refined['candidate'].kits,refined['result']) > solution_score(best['candidate'].kits,best['result']): best=refined
    elif floor_target<11:
        remaining=global_deadline-time.time()
        if last_target>=11 and remaining>=6.0:
            level,attempts=run_level(prepared_kits,11,deadline=global_deadline,seconds_per_run=8.0,max_portfolios=32,max_workers=max_workers,phase='target11-rescue',stop_on_first=False); all_attempts.extend(attempts)
            if level is not None and solution_score(level['candidate'].kits,level['result']) > solution_score(best['candidate'].kits,best['result']): best=level
    result=dict(best['result']); cert=best['certificate'] or {}
    return {'ok':True,'engine':'TVT Revolutionary Ensemble V3.0','completeFigures':len(best['candidate'].kits),'selectionStrategy':best['candidate'].label,'seed':best['seed'],'density':float(result.get('density') or 0.0),'stripWidthMm':float(result.get('stripWidthMm') or 0.0),'placements':result.get('placements') or [],'productionCertificate':cert,'minimumGapMm':cert.get('minimumGapMmCertified'),'requiredGapMm':MIN_GAP_MM,'targetDensityReached':float(result.get('density') or 0.0)>=TARGET_DENSITY,'attempts':all_attempts,'elapsedSeconds':round(time.time()-started,2)}
