from __future__ import annotations

import base64, gzip, json, time, threading
from collections import defaultdict
from pathlib import Path
from shapely.geometry import Polygon
from shapely.geometry.polygon import orient

from revolutionary.ensemble_v6 import revolutionary_solve_v6

CASES_DIR=Path(__file__).resolve().parent/'cases'
CASE_SPECS={
    'plate02-cactus':{'file':'plate02_cactus_real_case.gz.b64','kind':'real+manual-known','manualKnownComplete':11,'seconds':135.0},
    'plate06-mama':{'file':'plate06_mama_case.gz.b64','kind':'real+manual-known','manualKnownComplete':12,'seconds':135.0},
    'homogeneous-real-stress':{'file':'homogeneous_real_stress_case.gz.b64','kind':'stress-derived-real','seconds':120.0},
}


def _load_payload(filename):
    text=(CASES_DIR/filename).read_text(encoding='utf-8').strip();text+='='*(-len(text)%4)
    return json.loads(gzip.decompress(base64.b64decode(text)).decode('utf-8'))


def _prepared_from_payload(payload):
    pieces=payload.get('pieces') or []
    grouped=defaultdict(list)
    if pieces and isinstance(pieces[0],dict):
        for row in pieces:grouped[str(row.get('kitId') or '')].append(row)
    else:
        for i,coords in enumerate(pieces):
            kid=f'fixture-{i//2+1:02d}'
            grouped[kid].append({'kitId':kid,'figure':kid,'role':'base' if i%2==0 else 'tapa','points':coords})
    kits=[]
    for order,(kid,rows) in enumerate(grouped.items()):
        if not kid:continue
        parts=[]
        for idx,row in enumerate(rows):
            pts=row.get('points') or []
            if len(pts)<3:continue
            g=orient(Polygon([(float(x),float(y)) for x,y in pts]),sign=1.0)
            if not g.is_valid:g=g.buffer(0)
            if g.is_empty:continue
            if g.geom_type!='Polygon':g=max(g.geoms,key=lambda q:q.area)
            minx,miny,maxx,maxy=g.bounds;area=float(g.area);env=max(1.0,float((maxx-minx)*(maxy-miny)))
            role=str(row.get('role') or ('base' if idx==0 else 'tapa'))
            parts.append({'instanceId':str(row.get('instanceId') or f'{kid}-p{idx}'),'kitId':kid,'figure':str(row.get('figure') or kid),'name':role,'role':role,'geom':g,'shape':{'type':'simple_polygon','data':[[float(x),float(y)] for x,y in list(g.exterior.coords)[:-1]]},'trimXmm':0.0,'trimYmm':0.0,'area':area,'envelope':env})
        if not parts:continue
        area=sum(p['area'] for p in parts);env=sum(p['envelope'] for p in parts)
        kits.append({'kitId':kid,'figure':str(rows[0].get('figure') or kid),'priority':1.0,'date':'2026-08-22','parts':parts,'area':area,'envelope':env,'solidity':area/max(1.0,env),'_order':order})
    return kits


def run_case(case_id,seconds=None):
    spec=CASE_SPECS[case_id];payload=_load_payload(spec['file']);kits=_prepared_from_payload(payload)
    started=time.time();result=revolutionary_solve_v6(kits,total_seconds=float(seconds or spec['seconds']),max_workers=4)
    result['benchmarkCase']=case_id;result['benchmarkKind']=spec['kind'];result['candidateKitsUsed']=len(kits);result['manualKnownComplete']=spec.get('manualKnownComplete');result['benchmarkElapsedSeconds']=round(time.time()-started,2);result['productionUntouched']=True
    count=int(result.get('completeFigures') or 0);gap=float(result.get('minimumGapMm') or 0)
    if spec.get('manualKnownComplete'):
        result['passedCaseGate']=bool(result.get('ok') and count>=int(spec['manualKnownComplete']) and gap>=3.0)
    else:
        result['passedCaseGate']=bool(result.get('ok') and count>=4 and gap>=3.0)
    return result


def run_suite(seconds_each=None):
    rows=[]
    for case_id in CASE_SPECS:
        try:
            r=run_case(case_id,seconds_each)
            rows.append({'case':case_id,'ok':bool(r.get('ok')),'engine':r.get('engine'),'completeFigures':r.get('completeFigures'),'initialCertifiedCount':r.get('initialCertifiedCount'),'probablePracticalMaximum':r.get('probablePracticalMaximum'),'climbHistory':r.get('climbHistory'),'density':r.get('density'),'stripWidthMm':r.get('stripWidthMm'),'minimumGapMm':r.get('minimumGapMm'),'selectionStrategy':r.get('selectionStrategy'),'passedCaseGate':r.get('passedCaseGate'),'elapsedSeconds':r.get('benchmarkElapsedSeconds'),'error':r.get('error')})
        except Exception as exc:rows.append({'case':case_id,'ok':False,'passedCaseGate':False,'error':repr(exc)})
    return {'ok':all(bool(r.get('passedCaseGate')) for r in rows),'engine':'TVT Revolutionary Ensemble V6.0','suite':'TVT fixed regression suite v2','cases':rows,'productionUntouched':True}


def _auto_regression():
    time.sleep(75)
    try:result=run_suite(seconds_each=120.0);print('REV_V6_SUITE_RESULT '+json.dumps(result,separators=(',',':'),ensure_ascii=False),flush=True)
    except Exception as exc:print('REV_V6_SUITE_RESULT '+json.dumps({'ok':False,'error':repr(exc),'productionUntouched':True},separators=(',',':')),flush=True)

threading.Thread(target=_auto_regression,name='revolutionary-fixed-suite-v2',daemon=True).start()

# Importing v3 starts the isolated V7 hard regression battery in its own daemon
# thread. Production services are not referenced or modified by this benchmark.
import revolutionary.benchmark_suite_v3  # noqa: E402,F401
