from __future__ import annotations

import copy,json,multiprocessing as mp,os,signal,threading,time,traceback
from revolutionary.fixture_loader import load_payload,prepared_from_payload
from revolutionary.ensemble_v10_9 import revolutionary_solve
from revolutionary.runtime_gate import solver_lane

CASE_SPECS={
 'plate02-cactus':{'file':'plate02_cactus_real_case.gz.b64','manualKnownComplete':11,'seconds':180.0},
 'homogeneous-real-stress':{'file':'homogeneous_real_stress_case.gz.b64','manualKnownComplete':10,'seconds':180.0},
 'plate06-mama':{'file':'plate06_mama_case.gz.b64','manualKnownComplete':12,'seconds':240.0},
}
WORKERS=1


def _kits_for_variant(case_id,variant):
    payload=load_payload(CASE_SPECS[case_id]['file'])
    kits,rejected=prepared_from_payload(payload,require_complete_pair=True);kits=copy.deepcopy(kits)
    if variant=='reverse-priority':
        n=len(kits)
        for i,k in enumerate(kits):k['priority']=float(n-i);k['date']='2026-08-23'
    elif variant=='alternating-priority':
        for i,k in enumerate(kits):k['priority']=1.0 if i%2==0 else 20.0+i;k['date']='2026-08-23' if i%3 else '2026-08-24'
    return kits,rejected


def _summary(case_id,r,started,available,rejected,variant):
    gate=min(int(CASE_SPECS[case_id]['manualKnownComplete']),int(available));count=int(r.get('completeFigures') or 0)
    try:gap=float(r.get('minimumGapMm') or 0)
    except Exception:gap=0
    return {'case':case_id,'variant':variant,'ok':bool(r.get('ok')),'engine':r.get('engine'),
      'completeFigures':count,'availableCompleteKits':available,'effectiveGate':gate,'rejectedIncompleteKits':len(rejected),
      'minimumGapMm':r.get('minimumGapMm'),'density':r.get('density'),'selectionStrategy':r.get('selectionStrategy'),
      'attempts':r.get('attempts'),'passedCaseGate':bool(r.get('ok') and count>=gate and gap>=3.0),
      'elapsedSeconds':round(time.time()-started,2),'error':r.get('error'),'runtimeWorkers':1,'productionUntouched':True}


def run_case(case_id,seconds,variant='baseline',fast=False):
    kits,rejected=_kits_for_variant(case_id,variant);started=time.time()
    with solver_lane():
        r=revolutionary_solve(kits,total_seconds=float(seconds),max_workers=1,stop_at_commercial=bool(fast))
    return _summary(case_id,r,started,len(kits),rejected,variant)


def _case_child(case_id,seconds,variant,fast,q):
    try:
        try:os.setsid()
        except Exception:pass
        row=run_case(case_id,seconds,variant,fast)
        q.put_nowait({'kind':'result','row':row});q.cancel_join_thread()
    except BaseException as exc:
        try:q.put_nowait({'kind':'result','row':{'case':case_id,'variant':variant,'ok':False,'passedCaseGate':False,'error':repr(exc),'trace':traceback.format_exc(limit=6),'productionUntouched':True}});q.cancel_join_thread()
        except Exception:pass


def run_case_isolated(case_id,seconds,variant='baseline',fast=False,watchdog_extra=75.0,emit=True):
    timeout=max(90.0,float(seconds)+float(watchdog_extra));prefix='REV_V10_12_TORTURE'
    if emit:print(prefix+'_CASE_START '+json.dumps({'case':case_id,'variant':variant,'fast':fast,'budgetSeconds':seconds,'watchdogSeconds':timeout,'workers':1},separators=(',',':')),flush=True)
    ctx=mp.get_context('fork');q=ctx.Queue(maxsize=1);p=ctx.Process(target=_case_child,args=(case_id,seconds,variant,fast,q),daemon=False)
    started=time.time();p.start();p.join(timeout)
    if p.is_alive():
        # Kill Python child AND any Sparrow subprocess it spawned.
        try:os.killpg(p.pid,signal.SIGKILL)
        except Exception:
            try:p.kill()
            except Exception:pass
        p.join(5)
        row={'case':case_id,'variant':variant,'ok':False,'passedCaseGate':False,'timedOut':True,
          'budgetSeconds':seconds,'elapsedSeconds':round(time.time()-started,2),'error':'hard watchdog timeout; solver process group killed','productionUntouched':True}
    else:
        try:row=q.get_nowait();row=row.get('row',row)
        except Exception:row={'case':case_id,'variant':variant,'ok':False,'passedCaseGate':False,'error':f'child exited without result (exitcode={p.exitcode})','productionUntouched':True}
    try:q.close();q.cancel_join_thread()
    except Exception:pass
    if emit:print(prefix+'_CASE_RESULT '+json.dumps(row,separators=(',',':'),ensure_ascii=False),flush=True)
    return row


def run_pending_torture(emit=True):
    # Only the cases that were still pending when V10.11 exposed the stuck-watchdog bug.
    plan=[
      ('homogeneous-real-stress','alternating-priority',150.0,True),
      ('plate06-mama','baseline',210.0,False),
      ('plate06-mama','reverse-priority',240.0,False),
    ]
    rows=[run_case_isolated(c,s,v,fast=f,emit=emit) for c,v,s,f in plan]
    return {'ok':all(bool(r.get('passedCaseGate')) for r in rows),'passed':sum(bool(r.get('passedCaseGate')) for r in rows),
      'total':len(rows),'engine':'TVT Revolutionary V10.12','suite':'pending torture after hard-watchdog fix',
      'cases':rows,'productionUntouched':True}


def run_suite(seconds_each=None):
    # Manual compatibility endpoint: fast production-style regression on commercial target.
    rows=[]
    for case_id in ('plate02-cactus','homogeneous-real-stress'):
        rows.append(run_case_isolated(case_id,float(seconds_each or 150.0),fast=True,emit=False))
    rows.append(run_case_isolated('plate06-mama',float(seconds_each or 210.0),fast=False,emit=False))
    return {'ok':all(bool(r.get('passedCaseGate')) for r in rows),'engine':'TVT Revolutionary V10.12','cases':rows,'productionUntouched':True}


def _auto():
    time.sleep(12)
    try:result=run_pending_torture(True)
    except BaseException as exc:result={'ok':False,'error':repr(exc),'productionUntouched':True}
    print('REV_V10_12_TORTURE_RESULT '+json.dumps(result,separators=(',',':'),ensure_ascii=False),flush=True)

threading.Thread(target=_auto,name='revolutionary-v10-12-pending-torture',daemon=True).start()
