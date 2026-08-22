from __future__ import annotations

import json,time,threading
from revolutionary.benchmark_suite_v2 import _load_payload,_prepared_from_payload
from revolutionary.ensemble_v8 import revolutionary_solve_v8

CASE_SPECS={
 'plate02-cactus':{'file':'plate02_cactus_real_case.gz.b64','manualKnownComplete':11,'seconds':150.0},
 'plate06-mama':{'file':'plate06_mama_case.gz.b64','manualKnownComplete':12,'seconds':150.0},
 'homogeneous-real-stress':{'file':'homogeneous_real_stress_case.gz.b64','manualKnownComplete':10,'seconds':120.0},
}

def run_case(case_id,seconds=None):
    spec=CASE_SPECS[case_id];payload=_load_payload(spec['file']);kits=_prepared_from_payload(payload)
    started=time.time();r=revolutionary_solve_v8(kits,total_seconds=float(seconds or spec['seconds']),max_workers=4)
    count=int(r.get('completeFigures') or 0);gap=float(r.get('minimumGapMm') or 0)
    r['benchmarkCase']=case_id;r['manualKnownComplete']=int(spec['manualKnownComplete']);r['passedCaseGate']=bool(r.get('ok') and count>=int(spec['manualKnownComplete']) and gap>=3.0);r['benchmarkElapsedSeconds']=round(time.time()-started,2);r['productionUntouched']=True
    return r

def run_suite(seconds_each=None):
    rows=[]
    for case_id in CASE_SPECS:
        try:
            r=run_case(case_id,seconds_each)
            rows.append({'case':case_id,'ok':bool(r.get('ok')),'engine':r.get('engine'),'completeFigures':r.get('completeFigures'),'manualKnownComplete':r.get('manualKnownComplete'),'minimumGapMm':r.get('minimumGapMm'),'density':r.get('density'),'selectionStrategy':r.get('selectionStrategy'),'incumbentSource':r.get('incumbentSource'),'workshopTopologyTried':r.get('workshopTopologyTried'),'workshopTopologyCertified':r.get('workshopTopologyCertified'),'climbHistory':r.get('climbHistory'),'passedCaseGate':r.get('passedCaseGate'),'elapsedSeconds':r.get('benchmarkElapsedSeconds'),'error':r.get('error')})
        except Exception as exc:rows.append({'case':case_id,'ok':False,'passedCaseGate':False,'error':repr(exc)})
    return {'ok':all(bool(x.get('passedCaseGate')) for x in rows),'engine':'TVT Revolutionary Ensemble V8.0','suite':'TVT workshop-topology regression v8','cases':rows,'productionUntouched':True}

def _auto():
    time.sleep(55)
    try:print('REV_V8_SUITE_RESULT '+json.dumps(run_suite(),separators=(',',':'),ensure_ascii=False),flush=True)
    except Exception as exc:print('REV_V8_SUITE_RESULT '+json.dumps({'ok':False,'error':repr(exc),'productionUntouched':True},separators=(',',':')),flush=True)
threading.Thread(target=_auto,name='revolutionary-v8-suite',daemon=True).start()
