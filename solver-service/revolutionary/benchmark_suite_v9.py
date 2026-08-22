"""V9 truth benchmark.

The old case called plate06-mama is a mixed historical plate, so it cannot test the
workshop fact that twelve identical Mamá kits fit.  This suite extracts the real
Mamá geometry already present in that historical fixture, clones the complete kit,
and builds an isolated homogeneous candidate pool.  No live inventory is read.
"""
from __future__ import annotations

import base64
import copy
import gzip
import json
import threading
import time
from collections import defaultdict
from pathlib import Path

from shapely.geometry import Polygon
from shapely.geometry.polygon import orient

import nest_sparrow as ns
from revolutionary.ensemble_v8 import revolutionary_solve_v8
from revolutionary.topology_v8 import workshop_seeds

CASES_DIR=Path(__file__).resolve().parent/'cases'
ENGINE='TVT Revolutionary V9 truth-suite'


def _load_payload(filename):
    text=(CASES_DIR/filename).read_text(encoding='utf-8').strip()
    text+='='*(-len(text)%4)
    return json.loads(gzip.decompress(base64.b64decode(text)).decode('utf-8'))


def _prepared_from_payload(payload):
    pieces=payload.get('pieces') or []
    grouped=defaultdict(list)
    if pieces and isinstance(pieces[0],dict):
        for row in pieces:
            grouped[str(row.get('kitId') or '')].append(row)
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
            minx,miny,maxx,maxy=g.bounds
            area=float(g.area);env=max(1.0,float((maxx-minx)*(maxy-miny)))
            role=str(row.get('role') or ('base' if idx==0 else 'tapa'))
            parts.append({'instanceId':str(row.get('instanceId') or f'{kid}-p{idx}'),'kitId':kid,'figure':str(row.get('figure') or kid),'name':role,'role':role,'geom':g,'shape':{'type':'simple_polygon','data':[[float(x),float(y)] for x,y in list(g.exterior.coords)[:-1]]},'trimXmm':0.0,'trimYmm':0.0,'area':area,'envelope':env})
        if len(parts)!=2:continue
        area=sum(p['area'] for p in parts);env=sum(p['envelope'] for p in parts)
        kits.append({'kitId':kid,'figure':str(rows[0].get('figure') or kid),'priority':1.0,'date':'2026-08-22','parts':parts,'area':area,'envelope':env,'solidity':area/max(1.0,env),'_order':order})
    return kits


def _dims(part):
    minx,miny,maxx,maxy=part['geom'].bounds
    return maxx-minx,maxy-miny


def _mama_distance(kit):
    parts=list(kit.get('parts') or [])
    if len(parts)!=2:return 1e9
    dims=[_dims(p) for p in parts]
    if not all(260<=w<=300 and 78<=h<=112 for w,h in dims):return 1e9
    expected=[(280.212,95.189),(280.001,94.472)]
    direct=sum(abs(dims[i][0]-expected[i][0])+abs(dims[i][1]-expected[i][1]) for i in range(2))
    swapped=sum(abs(dims[1-i][0]-expected[i][0])+abs(dims[1-i][1]-expected[i][1]) for i in range(2))
    return min(direct,swapped)


def _clone_complete_kit(source,index):
    k=copy.deepcopy(source)
    kid=f'pure-mama-{index:02d}'
    k['kitId']=kid;k['figure']='Palabra Mama Imprenta';k['priority']=1.0;k['date']='2026-08-22'
    for pidx,p in enumerate(k['parts']):
        p['kitId']=kid;p['figure']='Palabra Mama Imprenta';p['instanceId']=f'{kid}-p{pidx}'
    return k


def pure_mama_prepared(total=16):
    historical=_prepared_from_payload(_load_payload('plate06_mama_case.gz.b64'))
    ranked=sorted(historical,key=_mama_distance)
    if not ranked or _mama_distance(ranked[0])>=1e8:
        dims=[[(round(_dims(p)[0],2),round(_dims(p)[1],2)) for p in k.get('parts') or []] for k in historical]
        raise RuntimeError(f'No Mamá-like complete kit found in historical fixture. dims={dims[:20]}')
    source=ranked[0]
    return [_clone_complete_kit(source,i+1) for i in range(int(total))],source


def topology_probe():
    kits,source=pure_mama_prepared(16)
    seeds=workshop_seeds(kits)
    rows=[]
    for seed in seeds:
        r=seed.get('result') or {};cert=seed.get('certificate') or {}
        rows.append({'label':seed['candidate'].label,'complete':len(seed['candidate'].kits),'certified':bool(seed.get('certified')),'gapMm':cert.get('minimumGapMmCertified'),'conflicts':cert.get('collisionCount'),'border':cert.get('outsidePlateCount'),'density':r.get('density')})
    return {'ok':any(x['certified'] and x['complete']>=12 and float(x.get('gapMm') or 0)>=3.0 for x in rows),'engine':ENGINE,'sourceKit':str(source.get('kitId') or ''),'sourceDimsMm':[[round(v,3) for v in _dims(p)] for p in source['parts']],'candidatePool':len(kits),'topologySeeds':rows,'productionUntouched':True}


def run_pure_mama(seconds=95.0):
    kits,source=pure_mama_prepared(16)
    started=time.time();r=revolutionary_solve_v8(kits,total_seconds=float(seconds),max_workers=4)
    count=int(r.get('completeFigures') or 0);gap=float(r.get('minimumGapMm') or 0)
    return {'ok':bool(r.get('ok')),'passedCaseGate':bool(r.get('ok') and count>=12 and gap>=3.0),'engine':r.get('engine'),'case':'pure-mama-12','completeFigures':count,'manualKnownComplete':12,'minimumGapMm':r.get('minimumGapMm'),'density':r.get('density'),'selectionStrategy':r.get('selectionStrategy'),'incumbentSource':r.get('incumbentSource'),'workshopTopologyTried':r.get('workshopTopologyTried'),'workshopTopologyCertified':r.get('workshopTopologyCertified'),'climbHistory':r.get('climbHistory'),'sourceKit':str(source.get('kitId') or ''),'elapsedSeconds':round(time.time()-started,2),'productionUntouched':True}


def _auto():
    time.sleep(20)
    try:print('REV_V9_TOPOLOGY_PROBE '+json.dumps(topology_probe(),separators=(',',':'),ensure_ascii=False),flush=True)
    except Exception as exc:print('REV_V9_TOPOLOGY_PROBE '+json.dumps({'ok':False,'error':repr(exc),'productionUntouched':True},separators=(',',':')),flush=True)
    time.sleep(3)
    try:print('REV_V9_PURE_MAMA_RESULT '+json.dumps(run_pure_mama(),separators=(',',':'),ensure_ascii=False),flush=True)
    except Exception as exc:print('REV_V9_PURE_MAMA_RESULT '+json.dumps({'ok':False,'error':repr(exc),'productionUntouched':True},separators=(',',':')),flush=True)

threading.Thread(target=_auto,name='revolutionary-v9-truth-suite',daemon=True).start()
