from __future__ import annotations

import json,time,threading,multiprocessing as mp,traceback
from revolutionary.benchmark_suite_v2 import _load_payload,_prepared_from_payload
from revolutionary.ensemble_v8 import revolutionary_solve_v8

CASE_SPECS={
 'plate02-cactus':{'file':'plate02_cactus_real_case.gz.b64','manualKnownComplete':11,'seconds':150.0},
 'plate06-mama':{'file':'plate06_mama_case.gz.b64','manualKnownComplete':12,'seconds':150.0},
 'homogeneous-real-stress':{'file':'homogeneous_real_stress_case.gz.b64','manualKnownComplete':10,'seconds':120.0},
}

# Run the cases that still need evidence first. Pure-Mama has its own independent
# truth benchmark, so the deploy exam should not make Cactus/Stress wait behind it.
AUTO_ORDER=('plate02-cactus','homogeneous-real-stress','plate06-mama')


def _summary(case_id,r,started):
    spec=CASE_SPECS[case_id]
    count=int(r.get('completeFigures') or 0)
    gap=float(r.get('minimumGapMm') or 0)
    passed=bool(r.get('ok') and count>=int(spec['manualKnownComplete']) and gap>=3.0)
    return {
        'case':case_id,
        'ok':bool(r.get('ok')),
        'engine':r.get('engine'),
        'completeFigures':count,
        'manualKnownComplete':int(spec['manualKnownComplete']),
        'minimumGapMm':r.get('minimumGapMm'),
        'density':r.get('density'),
        'selectionStrategy':r.get('selectionStrategy'),
        'incumbentSource':r.get('incumbentSource'),
        'workshopTopologyTried':r.get('workshopTopologyTried'),
        'workshopTopologyCertified':r.get('workshopTopologyCertified'),
        'climbHistory':r.get('climbHistory'),
        'passedCaseGate':passed,
        'elapsedSeconds':round(time.time()-started,2),
        'error':r.get('error'),
        'productionUntouched':True,
    }


def run_case(case_id,seconds=None):
    spec=CASE_SPECS[case_id]
    payload=_load_payload(spec['file'])
    kits=_prepared_from_payload(payload)
    started=time.time()
    r=revolutionary_solve_v8(kits,total_seconds=float(seconds or spec['seconds']),max_workers=4)
    return _summary(case_id,r,started)


def _case_child(case_id,seconds,q):
    try:
        q.put({'kind':'result','row':run_case(case_id,seconds)})
    except BaseException as exc:
        q.put({'kind':'result','row':{
            'case':case_id,'ok':False,'passedCaseGate':False,
            'error':repr(exc),'trace':traceback.format_exc(limit=8),
            'productionUntouched':True,
        }})


def run_case_isolated(case_id,seconds=None,watchdog_extra=45.0,emit=False):
    """Run one benchmark in its own process so a hung solver cannot block the suite."""
    spec=CASE_SPECS[case_id]
    budget=float(seconds or spec['seconds'])
    timeout=max(30.0,budget+float(watchdog_extra))
    if emit:
        print('REV_V9_CASE_START '+json.dumps({'case':case_id,'budgetSeconds':budget,'watchdogSeconds':timeout},separators=(',',':')),flush=True)
    ctx=mp.get_context('fork')
    q=ctx.Queue(maxsize=1)
    p=ctx.Process(target=_case_child,args=(case_id,budget,q),daemon=True)
    started=time.time();p.start();p.join(timeout)
    if p.is_alive():
        p.terminate();p.join(8)
        row={
            'case':case_id,'ok':False,'passedCaseGate':False,'timedOut':True,
            'budgetSeconds':budget,'elapsedSeconds':round(time.time()-started,2),
            'error':'watchdog timeout: case process terminated',
            'productionUntouched':True,
        }
    else:
        try: row=q.get(timeout=2)
        except Exception:
            row={'kind':'result','row':{
                'case':case_id,'ok':False,'passedCaseGate':False,
                'error':f'case process exited without result (exitcode={p.exitcode})',
                'elapsedSeconds':round(time.time()-started,2),'productionUntouched':True,
            }}
        row=row.get('row',row)
    if emit:
        print('REV_V9_CASE_RESULT '+json.dumps(row,separators=(',',':'),ensure_ascii=False),flush=True)
    try:q.close()
    except Exception:pass
    return row


def run_suite(seconds_each=None,order=None,emit=False):
    rows=[]
    for case_id in (order or tuple(CASE_SPECS)):
        rows.append(run_case_isolated(case_id,seconds_each,emit=emit))
    return {
        'ok':all(bool(x.get('passedCaseGate')) for x in rows),
        'engine':'TVT Revolutionary Ensemble V8.0',
        'suite':'TVT isolated replacement regression v9',
        'cases':rows,
        'productionUntouched':True,
    }


def _auto():
    # Give gunicorn time to become healthy, then stream each case independently.
    time.sleep(12)
    try:
        result=run_suite(order=AUTO_ORDER,emit=True)
        print('REV_V9_REPLACEMENT_EXAM_RESULT '+json.dumps(result,separators=(',',':'),ensure_ascii=False),flush=True)
    except BaseException as exc:
        print('REV_V9_REPLACEMENT_EXAM_RESULT '+json.dumps({'ok':False,'error':repr(exc),'productionUntouched':True},separators=(',',':')),flush=True)

threading.Thread(target=_auto,name='revolutionary-v9-isolated-suite',daemon=True).start()
