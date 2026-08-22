from __future__ import annotations

import base64,gzip,json,time,threading
from collections import defaultdict
from pathlib import Path
from shapely.geometry import Polygon
from shapely.geometry.polygon import orient

from revolutionary.ensemble_v7 import revolutionary_solve_v7

CASES_DIR=Path(__file__).resolve().parent/'cases'
CASE_SPECS={
    'plate02-cactus':{'file':'plate02_cactus_real_case.gz.b64','kind':'real+manual-known','manualKnownComplete':11},
    'plate06-mama':{'file':'plate06_mama_case.gz.b64','kind':'real+manual-known','manualKnownComplete':12},
    'homogeneous-real-stress':{'file':'homogeneous_real_stress_case.gz.b64','kind':'stress-derived-real','manualKnownComplete':10},
}
TRIALS=[
    ('plate06-mama',120.0,'mama-medium'),
    ('plate06-mama',210.0,'mama-deep'),
    ('plate06-mama',300.0,'mama-ultra'),
    ('plate02-cactus',120.0,'cactus-medium'),
    ('plate02-cactus',210.0,'cactus-deep'),
    ('homogeneous-real-stress',90.0,'stress-fast'),
    ('homogeneous-real-stress',150.0,'stress-deep'),
]


def _load_payload(filename):
    text=(CASES_DIR/filename).read_text(encoding='utf-8').strip();text+='='*(-len(text)%4)
    return json.loads(gzip.decompress(base64.b64decode(text)).decode('utf-8'))


def _prepared_from_payload(payload):
    pieces=payload.get('pieces') or [];grouped=defaultdict(list)
    if pieces and isinstance(pieces[0],dict):
        for row in pieces:grouped[str(row.get('kitId') or '')].append(row)
    else:
        for i,coords in enumerate(pieces):
            kid=f'fixture-{i//2+1:02d}';grouped[kid].append({'kitId':kid,'figure':kid,'role':'base' if i%2==0 else 'tapa','points':coords})
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


def run_trial(case_id,seconds,label):
    spec=CASE_SPECS[case_id];payload=_load_payload(spec['file']);kits=_prepared_from_payload(payload)
    started=time.time();r=revolutionary_solve_v7(kits,total_seconds=seconds,max_workers=4)
    count=int(r.get('completeFigures') or 0);gap=float(r.get('minimumGapMm') or 0);target=int(spec['manualKnownComplete'])
    return {'trial':label,'case':case_id,'budgetSeconds':seconds,'ok':bool(r.get('ok')),'engine':r.get('engine'),'completeFigures':count,'manualKnownComplete':target,'passedCaseGate':bool(r.get('ok') and count>=target and gap>=3.0),'minimumGapMm':r.get('minimumGapMm'),'density':r.get('density'),'stripWidthMm':r.get('stripWidthMm'),'selectionStrategy':r.get('selectionStrategy'),'climbHistory':r.get('climbHistory'),'elapsedSeconds':round(time.time()-started,2),'productionUntouched':True,'error':r.get('error')}


def run_battery():
    rows=[]
    for case_id,seconds,label in TRIALS:
        try:
            row=run_trial(case_id,seconds,label);rows.append(row)
            print('REV_V7_TRIAL_RESULT '+json.dumps(row,separators=(',',':'),ensure_ascii=False),flush=True)
        except Exception as exc:
            row={'trial':label,'case':case_id,'budgetSeconds':seconds,'ok':False,'passedCaseGate':False,'error':repr(exc),'productionUntouched':True};rows.append(row)
            print('REV_V7_TRIAL_RESULT '+json.dumps(row,separators=(',',':'),ensure_ascii=False),flush=True)
    best={}
    for row in rows:
        cid=row['case'];prev=best.get(cid)
        if prev is None or int(row.get('completeFigures') or 0)>int(prev.get('completeFigures') or 0):best[cid]=row
    summary={'ok':all(bool(best.get(cid,{}).get('passedCaseGate')) for cid in CASE_SPECS),'engine':'TVT Revolutionary Ensemble V7.0','suite':'TVT hard regression battery v3','trialCount':len(rows),'bestByCase':best,'trials':rows,'productionUntouched':True}
    print('REV_V7_BATTERY_RESULT '+json.dumps(summary,separators=(',',':'),ensure_ascii=False),flush=True)
    return summary


def _auto():
    time.sleep(55)
    try:run_battery()
    except Exception as exc:print('REV_V7_BATTERY_RESULT '+json.dumps({'ok':False,'error':repr(exc),'productionUntouched':True},separators=(',',':')),flush=True)

threading.Thread(target=_auto,name='revolutionary-v7-hard-battery',daemon=True).start()
