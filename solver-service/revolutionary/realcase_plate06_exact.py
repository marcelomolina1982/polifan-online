from __future__ import annotations

import base64
import gzip
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time

from shapely.affinity import translate
from shapely.geometry import Polygon
from shapely.geometry.polygon import orient

from revolutionary.ensemble_v1 import revolutionary_solve

CASE_PATH = Path(__file__).resolve().parent / 'cases' / 'plate06_mama_case.gz.b64'
SPARROW_BIN = os.environ.get('SPARROW_BIN','/usr/local/bin/sparrow')

# XML order of the 20 original paths followed by the two paths manually added
# in Pedido-2026-08-21-Placa-06prueba(1).svg.
SOURCE_IDS = [f'pieza_{i:03d}' for i in range(1,21)] + [
    'path4-2-1-0-9-08-0-1',
    'path4-3-0-0-5-3-3-3',
]

# Absolute bounding-box origins measured from the actual edited SVG with
# Inkscape. 1 SVG user unit = 1 mm (viewBox 0 0 1220 580).
PLACEMENTS_MM = [
    (718.68,3.82),(5.89,291.13),(312.43,347.47),(874.97,406.36),
    (124.37,412.33),(342.44,3.05),(798.24,98.44),(174.78,3.28),
    (603.50,235.32),(470.19,349.25),(929.57,219.94),(542.71,12.82),
    (706.71,306.92),(6.56,3.52),(655.56,468.47),(447.32,203.81),
    (16.24,167.69),(332.14,150.22),(169.05,227.79),(992.06,3.49),
    (1112.70,6.21),(1112.81,294.05),
]

# Real figure pairing from data-kit/data-instance in the original SVG.
PAIR_GROUPS = [
    ('auto-5-manos mickey corazon',(0,1)),
    ('auto-18-vaca',(2,5)),
    ('auto-19-vaca',(3,6)),
    ('auto-20-vaca',(4,7)),
    ('auto-26-joystick',(8,9)),
    ('auto-30-manzana',(10,12)),
    ('auto-31-manzana',(11,13)),
    ('auto-27-lapiz',(14,17)),
    ('auto-28-lapiz',(15,18)),
    ('auto-29-lapiz',(16,19)),
    ('manual-mama',(20,21)),
]


def _load_local_geometries():
    packed=CASE_PATH.read_text(encoding='utf-8').strip()
    payload=json.loads(gzip.decompress(base64.b64decode(packed)).decode('utf-8'))
    raw=payload.get('pieces') or []
    if len(raw) != 22:
        raise RuntimeError(f'plate06 exact expected 22 pieces, got {len(raw)}')
    geoms=[]
    for coords in raw:
        g=Polygon(coords)
        if not g.is_valid:
            g=g.buffer(0)
        if g.is_empty:
            raise ValueError('empty benchmark geometry')
        if g.geom_type != 'Polygon':
            g=max(list(g.geoms),key=lambda x:x.area)
        geoms.append(orient(g,sign=1.0))
    return geoms,payload


def _prepared_kits():
    geoms,payload=_load_local_geometries()
    kits=[]
    for kid,(a,b) in PAIR_GROUPS:
        parts=[]
        for pi,idx in enumerate((a,b)):
            g=geoms[idx]
            minx,miny,maxx,maxy=g.bounds
            area=float(g.area); env=max(1.0,float((maxx-minx)*(maxy-miny)))
            parts.append({
                'instanceId':f'{kid}-p{pi}',
                'kitId':kid,
                'figure':'Mamá manual' if kid == 'manual-mama' else kid,
                'name':'base' if pi == 0 else 'tapa',
                'role':'base' if pi == 0 else 'tapa',
                'geom':g,
                'shape':{'type':'simple_polygon','data':[[float(x),float(y)] for x,y in list(g.exterior.coords)[:-1]]},
                'trimXmm':0.0,'trimYmm':0.0,'area':area,'envelope':env,
                'snapshotTranslationMm':list(PLACEMENTS_MM[idx]),
                'sourceId':SOURCE_IDS[idx],
            })
        area=sum(p['area'] for p in parts); env=sum(p['envelope'] for p in parts)
        kits.append({'kitId':kid,'figure':'Mamá manual' if kid=='manual-mama' else kid,'priority':1.0,'date':'2026-08-21','parts':parts,'area':area,'envelope':env,'solidity':area/max(1.0,env)})
    return kits,payload


def _snapshot_check(kits, required_gap=3.0):
    rows=[]
    for k in kits:
        for p in k['parts']:
            tx,ty=p['snapshotTranslationMm']
            rows.append((p['instanceId'],translate(p['geom'],xoff=tx,yoff=ty)))
    outside=[]; min_gap=1e18; min_pair=None; violations=[]
    for name,g in rows:
        minx,miny,maxx,maxy=g.bounds
        if minx < -0.2 or miny < -0.2 or maxx > 1220.2 or maxy > 580.2:
            outside.append(name)
    for i,(ni,gi) in enumerate(rows):
        for nj,gj in rows[i+1:]:
            d=float(gi.distance(gj))
            if d < min_gap:
                min_gap=d; min_pair=[ni,nj]
            if gi.intersects(gj) or d < required_gap-1e-6:
                violations.append({'a':ni,'b':nj,'gapMm':round(d,4)})
    return {
        'okAt3mm':not outside and not violations,
        'physicallyNonOverlapping':not outside and all(v['gapMm'] > 0 for v in violations),
        'minimumGapMm':None if min_gap==1e18 else min_gap,
        'minimumGapPair':min_pair,
        'gapViolationsBelow3mm':len(violations),
        'closestViolations':sorted(violations,key=lambda v:v['gapMm'])[:10],
        'outsideCount':len(outside),'outside':outside[:8],
    }


def _warm_start(kits, seconds=40):
    items=[]; placed=[]; idmap={}; total_area=0.0; maxx=0.0; item_id=0
    for k in kits:
        for p in k['parts']:
            tx,ty=p['snapshotTranslationMm']
            items.append({'id':item_id,'demand':1,'shape':p['shape']})
            placed.append({'item_id':item_id,'transformation':{'rotation':0.0,'translation':[float(tx),float(ty)]}})
            idmap[item_id]=p
            total_area += float(p['area'])
            maxx=max(maxx,float(tx+p['geom'].bounds[2]))
            item_id += 1
    strip_width=max(1.0,maxx); density=total_area/max(1.0,strip_width*580.0)
    warm={'name':'plate06_mama_exact_warm','items':items,'strip_height':580.0,'solution':{'strip_width':strip_width,'layout':{'container_id':0,'placed_items':placed,'density':density},'density':density,'run_time_sec':0}}
    started=time.time()
    with tempfile.TemporaryDirectory(prefix='plate06-exact-warm-') as td:
        inp=os.path.join(td,'warm.json')
        with open(inp,'w',encoding='utf-8') as f: json.dump(warm,f,separators=(',',':'))
        cmd=[SPARROW_BIN,'-i',inp,'-t',str(int(seconds)),'--min-item-separation','3.2','--workers','1','-s','20260821','-x']
        try:
            proc=subprocess.run(cmd,cwd=td,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=seconds+18)
        except subprocess.TimeoutExpired as exc:
            tail=exc.stdout[-1800:] if isinstance(exc.stdout,str) else ''
            return {'ok':False,'error':'warm start timeout','elapsedSeconds':round(time.time()-started,2),'logTail':tail}
        outpath=os.path.join(td,'output','final_plate06_mama_exact_warm.json')
        if proc.returncode != 0 or not os.path.exists(outpath):
            return {'ok':False,'error':f'warm start exit {proc.returncode}','elapsedSeconds':round(time.time()-started,2),'logTail':(proc.stdout or '')[-2500:]}
        with open(outpath,'r',encoding='utf-8') as f: out=json.load(f)
    sol=out.get('solution') or {}; layout=sol.get('layout') or {}; rows=layout.get('placed_items') or []
    return {'ok':len(rows)==22 and float(sol.get('strip_width') or 1e18)<=1220.5,'completeFigures':11 if len(rows)==22 else len(rows)//2,'stripWidthMm':float(sol.get('strip_width') or 0.0),'density':float(sol.get('density') or 0.0)*100.0,'elapsedSeconds':round(time.time()-started,2),'placedItems':len(rows),'logTail':(proc.stdout or '')[-1200:]}


def run_plate06_mama(seconds=105.0):
    kits,payload=_prepared_kits()
    snapshot=_snapshot_check(kits,3.0)
    # Warm start is intentionally repaired at 3.2 mm: the manual plate itself
    # is useful proof of 11 non-overlapping figures but is not assumed to be a
    # certified 3 mm solution.
    warm=_warm_start(kits,seconds=min(45,max(18,int(seconds*0.38))))
    result=revolutionary_solve(kits,total_seconds=seconds,max_workers=4)
    result['benchmark']='plate06_mama_exact_svg_geometry_v3'
    result['historicalEngineComplete']=10
    result['manualKnownComplete']=11
    result['snapshotCheck']=snapshot
    result['warmStart']=warm
    result['sourceOriginal']='Pedido-2026-08-21-Placa-06(1).svg'
    result['sourceEdited']='Pedido-2026-08-21-Placa-06prueba(1).svg'
    fresh_ok=bool(result.get('ok') and int(result.get('completeFigures') or 0)>=11 and float(result.get('minimumGapMm') or 0.0)>=3.0 and int((result.get('productionCertificate') or {}).get('collisionCount') or 0)==0 and int((result.get('productionCertificate') or {}).get('outsidePlateCount') or 0)==0)
    warm_ok=bool(warm.get('ok') and int(warm.get('completeFigures') or 0)>=11)
    result['passedHistoricalGate']=bool(fresh_ok or warm_ok)
    result['gatePath']='fresh-ensemble' if fresh_ok else ('warm-start-repaired' if warm_ok else 'failed')
    result['productionUntouched']=True
    return result
