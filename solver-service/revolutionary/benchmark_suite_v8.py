from __future__ import annotations

import json,time,threading,multiprocessing as mp,traceback,copy
from revolutionary.fixture_loader import load_payload, prepared_from_payload
from revolutionary.ensemble_v10_9 import revolutionary_solve
from revolutionary.runtime_gate import solver_lane

CASE_SPECS={
 'plate02-cactus':{'file':'plate02_cactus_real_case.gz.b64','manualKnownComplete':11,'seconds':300.0},
 'homogeneous-real-stress':{'file':'homogeneous_real_stress_case.gz.b64','manualKnownComplete':10,'seconds':270.0},
 'plate06-mama':{'file':'plate06_mama_case.gz.b64','manualKnownComplete':12,'seconds':300.0},
}
AUTO_ORDER=('plate02-cactus','homogeneous-real-stress','plate06-mama')
WORKERS=1


def _summary(case_id,r,started,available,rejected,variant='baseline'):
    spec=CASE_SPECS[case_id]
    count=int(r.get('completeFigures') or 0)
    gap=float(r.get('minimumGapMm') or 0)
    gate=min(int(spec['manualKnownComplete']),int(available))
    passed=bool(r.get('ok') and count>=gate and gap>=3.0)
    return {
        'case':case_id,'variant':variant,'ok':bool(r.get('ok')),'engine':r.get('engine'),
        'completeFigures':count,'manualKnownComplete':int(spec['manualKnownComplete']),
        'availableCompleteKits':int(available),'effectiveGate':gate,'rejectedIncompleteKits':len(rejected),
        'minimumGapMm':r.get('minimumGapMm'),'density':r.get('density'),
        'selectionStrategy':r.get('selectionStrategy'),'climbHistory':r.get('climbHistory'),
        'attempts':r.get('attempts'),'passedCaseGate':passed,
        'elapsedSeconds':round(time.time()-started,2),'error':r.get('error'),
        'runtimeWorkers':WORKERS,'productionUntouched':True,
    }


def _kits_for_variant(case_id,variant):
    spec=CASE_SPECS[case_id]
    payload=load_payload(spec['file'])
    kits,rejected=prepared_from_payload(payload,require_complete_pair=True)
    kits=copy.deepcopy(kits)
    if variant=='reverse-priority':
        n=len(kits)
        for i,k in enumerate(kits):
            k['priority']=float(n-i)
            k['date']='2026-08-23'
    elif variant=='alternating-priority':
        for i,k in enumerate(kits):
            k['priority']=1.0 if i%2==0 else 20.0+i
            k['date']='2026-08-23' if i%3 else '2026-08-24'
    return kits,rejected


def run_case(case_id,seconds=None,variant='baseline'):
    spec=CASE_SPECS[case_id]
    kits,rejected=_kits_for_variant(case_id,variant)
    started=time.time()
    with solver_lane():
        r=revolutionary_solve(kits,total_seconds=float(seconds or spec['seconds']),max_workers=WORKERS)
    return _summary(case_id,r,started,len(kits),rejected,variant)


def _case_child(case_id,seconds,variant,q):
    try:q.put({'kind':'result','row':run_case(case_id,seconds,variant)})
    except BaseException as exc:
        q.put({'kind':'result','row':{'case':case_id,'variant':variant,'ok':False,'passedCaseGate':False,
          'error':repr(exc),'trace':traceback.format_exc(limit=8),'runtimeWorkers':WORKERS,'productionUntouched':True}})


def run_case_isolated(case_id,seconds=None,variant='baseline',watchdog_extra=120.0,emit=False,prefix='REV_V10_11'):
    spec=CASE_SPECS[case_id]; budget=float(seconds or spec['seconds'])
    timeout=max(90.0,budget+float(watchdog_extra))
    if emit:print(prefix+'_CASE_START '+json.dumps({'case':case_id,'variant':variant,'budgetSeconds':budget,'watchdogSeconds':timeout,'workers':WORKERS},separators=(',',':')),flush=True)
    ctx=mp.get_context('fork');q=ctx.Queue(maxsize=1);p=ctx.Process(target=_case_child,args=(case_id,budget,variant,q),daemon=True)
    started=time.time();p.start();p.join(timeout)
    if p.is_alive():
        p.terminate();p.join(8)
        row={'case':case_id,'variant':variant,'ok':False,'passedCaseGate':False,'timedOut':True,'budgetSeconds':budget,
             'elapsedSeconds':round(time.time()-started,2),'error':'V10.11 watchdog timeout','runtimeWorkers':WORKERS,'productionUntouched':True}
    else:
        try:row=q.get(timeout=2)
        except Exception:row={'kind':'result','row':{'case':case_id,'variant':variant,'ok':False,'passedCaseGate':False,
          'error':f'case process exited without result (exitcode={p.exitcode})','elapsedSeconds':round(time.time()-started,2),'runtimeWorkers':WORKERS,'productionUntouched':True}}
        row=row.get('row',row)
    if emit:print(prefix+'_CASE_RESULT '+json.dumps(row,separators=(',',':'),ensure_ascii=False),flush=True)
    try:q.close()
    except Exception:pass
    return row


def run_suite(seconds_each=None,order=None,emit=False):
    rows=[]
    for case_id in (order or AUTO_ORDER):rows.append(run_case_isolated(case_id,seconds_each,variant='baseline',emit=emit,prefix='REV_V10_11_BASE'))
    return {'ok':all(bool(x.get('passedCaseGate')) for x in rows),'engine':'TVT Revolutionary V10.10',
      'suite':'true clean single-lane lowcpu regression','runtimeWorkers':WORKERS,'cases':rows,'productionUntouched':True}


def run_torture(emit=False):
    plan=[
      ('plate02-cactus','baseline',180.0),
      ('plate02-cactus','reverse-priority',210.0),
      ('homogeneous-real-stress','baseline',270.0),
      ('homogeneous-real-stress','alternating-priority',270.0),
      ('plate06-mama','baseline',210.0),
      ('plate06-mama','reverse-priority',240.0),
    ]
    rows=[]
    for case_id,variant,seconds in plan:
        rows.append(run_case_isolated(case_id,seconds,variant=variant,emit=emit,prefix='REV_V10_11_TORTURE'))
    passed=sum(1 for r in rows if r.get('passedCaseGate'))
    return {'ok':passed==len(rows),'passed':passed,'total':len(rows),'engine':'TVT Revolutionary V10.10',
      'suite':'V10.11 sequential torture: repeats + priority/order perturbations','runtimeWorkers':WORKERS,
      'cases':rows,'productionUntouched':True}


def _auto():
    time.sleep(12)
    try:
        baseline=run_suite(order=AUTO_ORDER,emit=True)
        print('REV_V10_11_BASE_SUITE_RESULT '+json.dumps(baseline,separators=(',',':'),ensure_ascii=False),flush=True)
        if not baseline.get('ok'):
            print('REV_V10_11_TORTURE_RESULT '+json.dumps({'ok':False,'skipped':True,'reason':'baseline regression failed; torture not trusted','productionUntouched':True},separators=(',',':')),flush=True)
            return
        torture=run_torture(emit=True)
        print('REV_V10_11_TORTURE_RESULT '+json.dumps(torture,separators=(',',':'),ensure_ascii=False),flush=True)
    except BaseException as exc:
        print('REV_V10_11_TORTURE_RESULT '+json.dumps({'ok':False,'error':repr(exc),'productionUntouched':True},separators=(',',':')),flush=True)

threading.Thread(target=_auto,name='revolutionary-v10-11-sequential-torture',daemon=True).start()
