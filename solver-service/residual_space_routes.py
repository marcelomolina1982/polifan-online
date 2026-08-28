from flask import jsonify, request
from shapely.geometry import box
from shapely.ops import unary_union
from clean_lab_app import app, core, PLATE_WIDTH_MM, PLATE_HEIGHT_MM, GAP_MM
from benchmark_routes import _placed_geometries


def _prepare(payload):
    rows=[];rejected=[]
    for kit in payload.get('kits') or []:
        try: rows.append(core._prep_kit(kit,PLATE_WIDTH_MM,PLATE_HEIGHT_MM))
        except Exception as exc: rejected.append({'kitId':str(kit.get('kitId') or ''),'figure':str(kit.get('figure') or ''),'reason':str(exc)})
    return rows,rejected


def _components(geom):
    if geom.is_empty:return []
    if geom.geom_type=='Polygon':return [geom]
    if geom.geom_type=='MultiPolygon':return list(geom.geoms)
    return [g for g in getattr(geom,'geoms',[]) if g.geom_type=='Polygon']


@app.post('/residual-space')
def residual_space():
    data=request.get_json(silent=True) or {}
    payload=data.get('payload') if isinstance(data.get('payload'),dict) else data
    placements=data.get('placements') or payload.get('placements') or []
    prepared,rejected=_prepare(payload)
    if not prepared:return jsonify(ok=False,error='No hay kits geométricos utilizables',rejected=rejected[:20]),422
    rows=_placed_geometries(prepared,placements)
    plate=box(0,0,PLATE_WIDTH_MM,PLATE_HEIGHT_MM)
    occupied=unary_union([g.buffer(GAP_MM/2.0) for _p,g in rows]) if rows else None
    free=plate.difference(occupied) if occupied is not None else plate
    comps=sorted(_components(free),key=lambda g:g.area,reverse=True)
    cavities=[]
    for idx,g in enumerate(comps[:40]):
        minx,miny,maxx,maxy=g.bounds
        cavities.append({'index':idx+1,'areaMm2':round(float(g.area),2),'boundsMm':[round(minx,2),round(miny,2),round(maxx,2),round(maxy,2)],'widthMm':round(maxx-minx,2),'heightMm':round(maxy-miny,2)})
    selected={str(p.get('kitId') or '') for p in placements}
    candidates=[]
    for kit in prepared:
        if str(kit.get('kitId') or '') in selected:continue
        candidates.append({'kitId':kit.get('kitId'),'figure':kit.get('figure'),'areaMm2':round(float(kit.get('area') or 0),2),'envelopeMm2':round(float(kit.get('envelope') or 0),2),'solidity':round(float(kit.get('solidity') or 0),4)})
    candidates=sorted(candidates,key=lambda k:(k['envelopeMm2'],-k['solidity'],k['areaMm2']))[:30]
    return jsonify(ok=True,workspaceMm=[PLATE_WIDTH_MM,PLATE_HEIGHT_MM],gapMm=GAP_MM,placedPieces=len(rows),freeAreaMm2=round(float(free.area),2),freeAreaPct=round(100*float(free.area)/(PLATE_WIDTH_MM*PLATE_HEIGHT_MM),3),largestCavities=cavities,candidateKits=candidates,rejected=rejected[:20])
