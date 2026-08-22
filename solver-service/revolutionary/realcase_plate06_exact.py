from __future__ import annotations

import base64
import gzip
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time

from shapely.affinity import scale as shp_scale, translate
from shapely.geometry import Polygon
from shapely.geometry.polygon import orient

from revolutionary.ensemble_v4 import revolutionary_solve
from revolutionary.independent_certifier import certify_layout

CASE_PATH = Path(__file__).resolve().parent / 'cases' / 'plate06_mama_case.gz.b64'
SPARROW_BIN = os.environ.get('SPARROW_BIN','/usr/local/bin/sparrow')
PLATE_AREA = 1220.0 * 580.0

SOURCE_IDS = [f'pieza_{i:03d}' for i in range(1,21)] + [
    'path4-2-1-0-9-08-0-1',
    'path4-3-0-0-5-3-3-3',
]

PLACEMENTS_MM = [
    (106.141, 21.961), (414.957, 47.502), (207.397, 123.145), (536.020, 7.905),
    (668.022, 9.001), (859.343, 4.585), (4.821, 96.454), (981.743, 2.443),
    (709.295, 121.543), (348.180, 197.434), (4.721, 224.322), (894.495, 209.312),
    (1092.789, 188.221), (1000.443, 359.279), (507.771, 349.756), (80.774, 409.826),
    (287.348, 430.691), (751.076, 408.695), (421.685, 409.907), (624.196, 410.806),
    (950.679, 373.323), (1005.654, 472.922),
]


def _load_case_payload():
    raw = base64.b64decode(CASE_PATH.read_text(encoding='utf-8').strip())
    payload = json.loads(gzip.decompress(raw).decode('utf-8'))
    if not isinstance(payload, dict):
        raise TypeError('snapshot payload is not an object')
    if 'pieces' not in payload and 'shapes' not in payload:
        raise KeyError('no pieces/shapes; payload keys=' + ','.join(sorted(str(k) for k in payload.keys())))
    return payload


def _numeric_pair(v):
    return isinstance(v, (list, tuple)) and len(v) >= 2 and isinstance(v[0], (int, float)) and isinstance(v[1], (int, float))


def _points_from_piece(value, depth=0):
    """Accept old shapes and the newer pieces/pieceMeta snapshot variants."""
    if depth > 8 or value is None:
        return None
    if isinstance(value, (list, tuple)):
        if len(value) >= 3 and all(_numeric_pair(p) for p in value):
            return [[float(p[0]), float(p[1])] for p in value]
        if len(value) >= 6 and all(isinstance(x, (int, float)) for x in value) and len(value) % 2 == 0:
            return [[float(value[i]), float(value[i+1])] for i in range(0, len(value), 2)]
        for child in value:
            pts = _points_from_piece(child, depth + 1)
            if pts and len(pts) >= 3:
                return pts
        return None
    if isinstance(value, dict):
        # Known/common geometry containers first.
        for key in ('points','polygon','coords','coordinates','data','outer','exterior','shape','geometry','vertices','contour'):
            if key in value:
                pts = _points_from_piece(value.get(key), depth + 1)
                if pts and len(pts) >= 3:
                    return pts
        # Last resort: recursively inspect values, ignoring metadata scalars.
        for child in value.values():
            if isinstance(child, (dict, list, tuple)):
                pts = _points_from_piece(child, depth + 1)
                if pts and len(pts) >= 3:
                    return pts
    return None


def _meta_for(payload, idx):
    meta = payload.get('pieceMeta') or []
    if isinstance(meta, list):
        return meta[idx] if idx < len(meta) and isinstance(meta[idx], dict) else {}
    if isinstance(meta, dict):
        for key in (str(idx), SOURCE_IDS[idx] if idx < len(SOURCE_IDS) else ''):
            if key and isinstance(meta.get(key), dict):
                return meta[key]
    return {}


def _piece_name(payload, idx, kit_idx):
    meta = _meta_for(payload, idx)
    for key in ('figure','kitName','figureName','name','label','sourceName'):
        v = meta.get(key)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return f'Plate06 kit {kit_idx + 1:02d}'


def _raw_polygons(payload):
    source = payload.get('shapes') if isinstance(payload.get('shapes'), list) else payload.get('pieces')
    if not isinstance(source, list) or len(source) < 22:
        raise ValueError(f'expected >=22 pieces; got {len(source) if isinstance(source,list) else type(source).__name__}')
    geoms = []
    for idx, piece in enumerate(source[:22]):
        pts = _points_from_piece(piece)
        if not pts or len(pts) < 3:
            meta = _meta_for(payload, idx)
            raise ValueError(f'cannot decode piece {idx}; pieceType={type(piece).__name__}; metaKeys={sorted(meta.keys())[:12]}')
        g = Polygon(pts)
        if not g.is_valid:
            g = g.buffer(0)
        if g.is_empty:
            raise ValueError(f'empty piece geometry at {idx}')
        # In this benchmark every source path is one polygon; use largest polygon if buffer(0) split it.
        if g.geom_type == 'MultiPolygon':
            g = max(g.geoms, key=lambda x: x.area)
        geoms.append(orient(g, sign=1.0))
    return geoms


def _choose_coordinate_scale(payload, geoms):
    """The current snapshot stores raster/grid coordinates plus resolutionMm.

    Old snapshots stored millimetres directly. Evaluate both interpretations and
    choose the physically plausible one using the known 1220x580 Plate06 case.
    """
    resolution = float(payload.get('resolutionMm') or 1.0)
    candidates = [1.0]
    if 0.01 < resolution < 10.0 and abs(resolution - 1.0) > 1e-9:
        candidates.append(resolution)
    best = None
    for factor in candidates:
        total_area = sum(float(g.area) * factor * factor for g in geoms)
        density = total_area / PLATE_AREA
        max_w = max((g.bounds[2]-g.bounds[0]) * factor for g in geoms)
        max_h = max((g.bounds[3]-g.bounds[1]) * factor for g in geoms)
        # Historical 11-piece edited Plate06 is about 68-70% area. Penalize impossible sizes heavily.
        penalty = abs(density - 0.69)
        if density <= 0.15 or density >= 1.10:
            penalty += 10.0
        if max_w > 1220.0 or max_h > 580.0:
            penalty += 10.0
        row = (penalty, factor, density, max_w, max_h)
        if best is None or row[0] < best[0]:
            best = row
    return float(best[1]), {'factor':best[1], 'density':best[2], 'maxPieceWidthMm':best[3], 'maxPieceHeightMm':best[4], 'resolutionMm':resolution}


def _prepared_kits():
    payload = _load_case_payload()
    raw_geoms = _raw_polygons(payload)
    factor, scale_info = _choose_coordinate_scale(payload, raw_geoms)
    geoms = [shp_scale(g, xfact=factor, yfact=factor, origin=(0,0)) if abs(factor-1.0)>1e-12 else g for g in raw_geoms]
    kits=[]
    for kit_idx in range(11):
        idx0 = kit_idx * 2
        display_name = 'Mamá manual' if kit_idx == 10 else _piece_name(payload, idx0, kit_idx)
        kid = 'manual-mama' if kit_idx == 10 else f'auto-{kit_idx+1}-{display_name}'
        parts=[]
        for part_idx in range(2):
            idx=kit_idx*2+part_idx
            g=geoms[idx]
            minx,miny,maxx,maxy=g.bounds
            area=float(g.area); env=float((maxx-minx)*(maxy-miny))
            parts.append({
                'instanceId':SOURCE_IDS[idx],
                'kitId':kid,
                'figure':display_name,
                'name':'base' if part_idx==0 else 'tapa',
                'role':'base' if part_idx==0 else 'tapa',
                'geom':g,
                'shape':{'type':'simple_polygon','data':[[float(x),float(y)] for x,y in list(g.exterior.coords)[:-1]]},
                'trimXmm':0.0,'trimYmm':0.0,'area':area,'envelope':env,
                'snapshotTranslationMm':list(PLACEMENTS_MM[idx]),
                'sourceId':SOURCE_IDS[idx],
            })
        area=sum(p['area'] for p in parts); env=sum(p['envelope'] for p in parts)
        kits.append({'kitId':kid,'figure':display_name,'priority':1.0,'date':'2026-08-21','parts':parts,'area':area,'envelope':env,'solidity':area/max(1.0,env)})
    payload['_decodedScaleInfo'] = scale_info
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
    items=[]; placed=[]; total_area=0.0; maxx=0.0; item_id=0
    for k in kits:
        for p in k['parts']:
            tx,ty=p['snapshotTranslationMm']
            items.append({'id':item_id,'demand':1,'shape':p['shape']})
            placed.append({'item_id':item_id,'transformation':{'rotation':0.0,'translation':[float(tx),float(ty)]}})
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
    certificate=certify_layout(kits,rows,required_gap_mm=3.0)
    all_placed=len(rows)==22
    fits=float(sol.get('strip_width') or 1e18)<=1220.5
    certified=bool(certificate.get('ok'))
    return {
        'ok':bool(all_placed and fits and certified),
        'completeFigures':11 if all_placed else len(rows)//2,
        'stripWidthMm':float(sol.get('strip_width') or 0.0),
        'density':float(sol.get('density') or 0.0)*100.0,
        'elapsedSeconds':round(time.time()-started,2),
        'placedItems':len(rows),
        'independentCertificate':certificate,
        'sparrowFeasible':bool(all_placed and fits),
        'logTail':(proc.stdout or '')[-1200:]
    }


def run_plate06_mama(seconds=105.0):
    stage='prepare'
    try:
        kits,payload=_prepared_kits()
        stage='snapshot'
        snapshot=_snapshot_check(kits,3.0)
        stage='warm-start'
        warm=_warm_start(kits,seconds=min(45,max(18,int(seconds*0.38))))
        stage='v4-solve'
        result=revolutionary_solve(kits,total_seconds=seconds,max_workers=4)
    except Exception as exc:
        return {
            'ok':False,
            'engine':'TVT Revolutionary Ensemble V4.0',
            'benchmark':'plate06_mama_exact_svg_geometry_v6_pieces_adapter',
            'failureStage':stage,
            'error':repr(exc),
            'productionUntouched':True,
        }
    result['benchmark']='plate06_mama_exact_svg_geometry_v6_pieces_adapter'
    result['snapshotFormat']='pieces/pieceMeta' if 'pieces' in payload else 'legacy-shapes'
    result['decodedScaleInfo']=payload.get('_decodedScaleInfo')
    result['historicalEngineComplete']=10
    result['manualKnownComplete']=11
    result['snapshotCheck']=snapshot
    result['warmStart']=warm
    result['sourceOriginal']='Pedido-2026-08-21-Placa-06(1).svg'
    result['sourceEdited']='Pedido-2026-08-21-Placa-06prueba(1).svg'
    fresh_ok=bool(result.get('ok') and int(result.get('completeFigures') or 0)>=11 and float(result.get('minimumGapMm') or 0.0)>=3.0 and int((result.get('productionCertificate') or {}).get('collisionCount') or 0)==0 and int((result.get('productionCertificate') or {}).get('outsidePlateCount') or 0)==0)
    warm_cert=warm.get('independentCertificate') or {}
    warm_ok=bool(warm.get('ok') and int(warm.get('completeFigures') or 0)>=11 and warm_cert.get('ok') and float(warm_cert.get('minimumGapMmCertified') or 0.0)>=3.0 and int(warm_cert.get('collisionCount') or 0)==0 and int(warm_cert.get('outsidePlateCount') or 0)==0)
    result['passedHistoricalGate']=bool(fresh_ok or warm_ok)
    result['gatePath']='fresh-v4-engine' if fresh_ok else ('warm-start-independent-certified' if warm_ok else 'failed')
    result['productionUntouched']=True
    return result
