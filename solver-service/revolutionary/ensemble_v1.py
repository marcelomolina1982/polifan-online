"""TVT Revolutionary Ensemble V2.1.

Laboratory-only nesting ensemble. Production is not wired to this module.
The geometry core stays Sparrow/Jagua; the orchestration is TVT-specific:
complete figures first, real 3 mm certification, geometry-aware portfolios,
multiple deterministic seeds, and a high-count-first probe after a safe base-10.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
import time

import nest_sparrow as ns
from revolutionary.selector_v2 import portfolios as select_portfolios

MIN_COMPLETE = 10
MAX_COMPLETE = 16
MIN_GAP_MM = 3.0
TARGET_DENSITY = 70.0
SEEDS = (41, 429, 1701, 7919, 31337, 65537, 104729, 130363)


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


def revolutionary_solve(prepared_kits, total_seconds=150.0, max_workers=4):
    started=time.time(); budget=max(30.0,float(total_seconds)); global_deadline=started+budget; all_attempts=[]; best=None
    last_target=min(MAX_COMPLETE,len(prepared_kits))
    base_seconds=max(12.0,min(24.0,budget*0.20)); base_deadline=min(global_deadline,time.time()+base_seconds)
    base,attempts=run_level(prepared_kits,10,deadline=base_deadline,seconds_per_run=5.5,max_portfolios=14,max_workers=max_workers,phase='base10',stop_on_first=True); all_attempts.extend(attempts)
    if base is None and global_deadline-time.time() >= 8.0:
        retry_deadline=min(global_deadline,time.time()+min(24.0,global_deadline-time.time()))
        base,attempts=run_level(prepared_kits,10,deadline=retry_deadline,seconds_per_run=7.5,max_portfolios=24,max_workers=max_workers,phase='base10-rescue',stop_on_first=True); all_attempts.extend(attempts)
    if base is None:
        return {'ok':False,'engine':'TVT Revolutionary Ensemble V2.1','error':'No certified base-10','attempts':all_attempts,'elapsedSeconds':round(time.time()-started,2)}
    best=base; high_success=None
    for target in range(last_target,10,-1):
        remaining=global_deadline-time.time()
        if remaining < 8.0: break
        if not _optimistic_area_possible(prepared_kits,target): all_attempts.append({'phase':'high-probe-skip','target':target,'reason':'area bound'}); continue
        reserve11=min(32.0,max(14.0,budget*0.24)); usable=max(0.0,remaining-reserve11) if target>11 else remaining
        if target>11 and usable < 6.0: continue
        probe_seconds=min(14.0 if target>=14 else 17.0,max(6.0,usable)); probe_deadline=min(global_deadline,time.time()+probe_seconds)
        level,attempts=run_level(prepared_kits,target,deadline=probe_deadline,seconds_per_run=4.5 if target>=14 else 5.5,max_portfolios=10 if target>=14 else 14,max_workers=max_workers,phase='high-probe',stop_on_first=True); all_attempts.extend(attempts)
        if level is not None: high_success=level; best=level; break
    if high_success is not None:
        target=len(high_success['candidate'].kits); remaining=global_deadline-time.time()
        if remaining >= 8.0:
            refine_deadline=min(global_deadline,time.time()+min(22.0,remaining))
            refined,attempts=run_level(prepared_kits,target,deadline=refine_deadline,seconds_per_run=6.5,max_portfolios=18,max_workers=max_workers,phase='high-refine',stop_on_first=False); all_attempts.extend(attempts)
            if refined is not None and solution_score(refined['candidate'].kits,refined['result']) > solution_score(best['candidate'].kits,best['result']): best=refined
    else:
        remaining=global_deadline-time.time()
        if last_target>=11 and remaining >= 6.0:
            level,attempts=run_level(prepared_kits,11,deadline=global_deadline,seconds_per_run=8.0,max_portfolios=32,max_workers=max_workers,phase='target11-rescue',stop_on_first=False); all_attempts.extend(attempts)
            if level is not None and solution_score(level['candidate'].kits,level['result']) > solution_score(best['candidate'].kits,best['result']): best=level
    result=dict(best['result']); cert=best['certificate'] or {}
    return {'ok':True,'engine':'TVT Revolutionary Ensemble V2.1','completeFigures':len(best['candidate'].kits),'selectionStrategy':best['candidate'].label,'seed':best['seed'],'density':float(result.get('density') or 0.0),'stripWidthMm':float(result.get('stripWidthMm') or 0.0),'placements':result.get('placements') or [],'productionCertificate':cert,'minimumGapMm':cert.get('minimumGapMmCertified'),'requiredGapMm':MIN_GAP_MM,'targetDensityReached':float(result.get('density') or 0.0)>=TARGET_DENSITY,'attempts':all_attempts,'elapsedSeconds':round(time.time()-started,2)}
