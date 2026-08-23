"""U-Nesting 0.7.x bridge for TVT Revolutionary V9 lab.

Converts complete TVT kits into per-instance U-Nesting geometries, then reconstructs
returned x/y/rotation placements with kitId+instanceId so the independent TVT gate
can certify them. This module never approves geometry itself.
"""
from __future__ import annotations
import json, math, os, subprocess
from typing import Any

STRATEGIES=('ga','brkga','alns','gdrr')
ROTATIONS=[float(x) for x in range(0,360,15)]


def build_request(prepared_kits:list[dict[str,Any]],strategy:str,time_limit_ms:int=45000)->dict[str,Any]:
    if strategy not in STRATEGIES:raise ValueError(f'unsupported strategy: {strategy}')
    geometries=[]
    for kit in prepared_kits:
        kid=str(kit.get('kitId') or '')
        for part in kit.get('parts') or []:
            iid=str(part.get('instanceId') or '')
            geom=part.get('geom')
            if not kid or not iid or geom is None:continue
            pts=[[float(x),float(y)] for x,y in list(geom.exterior.coords)[:-1]]
            if len(pts)<3:continue
            geometries.append({'id':iid,'polygon':pts,'quantity':1,'rotations':ROTATIONS,'_kitId':kid})
    return {'mode':'2d','geometries':[{k:v for k,v in g.items() if not k.startswith('_')} for g in geometries],
            'boundary':{'width':1220.0,'height':580.0},
            'config':{'spacing':3.0,'margin':0.0,'strategy':strategy,'time_limit_ms':int(time_limit_ms),'multi_sheet':False}}


def reconstruct(response:dict[str,Any],prepared_kits:list[dict[str,Any]],strategy:str)->dict[str,Any]:
    part_index={}
    for kit in prepared_kits:
        kid=str(kit.get('kitId') or '')
        for part in kit.get('parts') or []:
            iid=str(part.get('instanceId') or '')
            if iid:part_index[iid]=(kid,part)
    rows=[]
    for p in response.get('placements') or []:
        iid=str(p.get('id') or '')
        hit=part_index.get(iid)
        if not hit:continue
        kid,part=hit
        rows.append({'instanceId':iid,'kitId':kid,'figure':part.get('figure'),'role':part.get('role'),
                     'x':float(p.get('x') or 0.0),'y':float(p.get('y') or 0.0),
                     'rotation':float(p.get('rotation') or 0.0),'flipped':bool(p.get('flipped',False)),
                     'sheetIndex':int(p.get('sheet_index') or 0)})
    total=int(response.get('total_requested') or len(part_index))
    return {'source':'u-nesting-0.7.x','strategy':strategy,'placements':rows,
            'totalRequested':total,'placedInstances':len(rows),'unplacedCount':int(response.get('unplaced_count') or max(0,total-len(rows))),
            'allPlaced':bool(response.get('all_placed',len(rows)==total)),'density':float(response.get('utilization') or 0.0),
            'elapsedMs':int(response.get('elapsed_ms') or response.get('computation_time_ms') or 0),'rawSuccess':bool(response.get('success',True))}


def run(binary:str,prepared_kits:list[dict[str,Any]],strategy:str,time_limit_ms:int=45000)->dict[str,Any]:
    request=build_request(prepared_kits,strategy,time_limit_ms)
    cp=subprocess.run([binary],input=json.dumps(request),text=True,capture_output=True,timeout=max(15,time_limit_ms/1000+20),check=False)
    if cp.returncode!=0:raise RuntimeError(f'U-Nesting {strategy} failed rc={cp.returncode}: {cp.stderr[-1000:]}')
    data=json.loads(cp.stdout or '{}')
    if not data.get('success',True):raise RuntimeError(str(data.get('error') or f'U-Nesting {strategy} solve failed'))
    return reconstruct(data,prepared_kits,strategy)


def run_portfolio(prepared_kits:list[dict[str,Any]],time_limit_ms:int=45000)->list[dict[str,Any]]:
    binary=os.environ.get('TVT_UNESTING_BIN','')
    if not binary or not os.path.exists(binary):return []
    out=[]
    for strategy in STRATEGIES:
        try:out.append(run(binary,prepared_kits,strategy,time_limit_ms))
        except Exception as exc:out.append({'source':'u-nesting-0.7.x','strategy':strategy,'placements':[],'error':repr(exc)})
    return out
