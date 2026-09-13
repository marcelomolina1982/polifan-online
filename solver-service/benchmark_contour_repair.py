import math
from shapely.affinity import rotate as shp_rotate, translate as shp_translate
import benchmark_local_repair as base


def _sample_points(geom, limit=10):
    polys=[geom] if geom.geom_type=='Polygon' else list(getattr(geom,'geoms',[]) or [])
    pts=[]
    for poly in polys:
        if getattr(poly,'geom_type','')!='Polygon':
            continue
        coords=list(poly.exterior.coords)
        if not coords:
            continue
        step=max(1,len(coords)//max(4,limit))
        pts.extend(coords[::step])
    if len(pts)>limit:
        step=max(1,len(pts)//limit)
        pts=pts[::step][:limit]
    return [(float(x),float(y)) for x,y in pts]


def _contour_candidates(part,placed,gap,width,height,original,max_keep=72):
    angles=[]
    original_angle=float(original.get('angle') or 0.0)
    for angle in [original_angle]+[float(x) for x in range(0,360,15)]:
        angle%=360.0
        if angle not in angles:
            angles.append(angle)

    out=[]; seen=set()
    ranked=sorted(placed,key=lambda g:(g.bounds[2],g.area),reverse=True)[:8]
    offsets=[(gap,0),(-gap,0),(0,gap),(0,-gap)]

    for angle in angles:
        rg=shp_rotate(part['geom'],angle,origin=(0,0),use_radians=False)
        rminx,rminy,rmaxx,rmaxy=rg.bounds
        rw=rmaxx-rminx; rh=rmaxy-rminy
        if rw>width+.35 or rh>height+.35:
            continue
        tx0=float(original.get('xCm') or 0.0)*10.0
        ty0=float(original.get('yCm') or 0.0)*10.0
        proposals=[(-rminx,-rminy),(width-rmaxx,-rminy),(-rminx,height-rmaxy),(width-rmaxx,height-rmaxy),(tx0,ty0)]

        mover_pts=_sample_points(rg,10)
        for obstacle in ranked:
            for mx,my in mover_pts:
                for ox,oy in _sample_points(obstacle,10):
                    for dx,dy in offsets:
                        proposals.append((ox+dx-mx,oy+dy-my))

        for tx,ty in proposals:
            if not (math.isfinite(tx) and math.isfinite(ty)):
                continue
            key=(round(angle,2),round(tx,2),round(ty,2))
            if key in seen:
                continue
            seen.add(key)
            geom=shp_translate(rg,xoff=tx,yoff=ty)
            if not base._inside(geom,width,height) or not base._clear(geom,placed,gap):
                continue
            minx,miny,maxx,maxy=geom.bounds
            score=(maxx,abs(tx-tx0)+abs(ty-ty0),miny,minx)
            out.append((score,{'angle':angle,'xCm':tx/10.0,'yCm':ty/10.0},geom))

    out.sort(key=lambda row:row[0])
    return out[:max_keep]


def local_repair_contour(kits,result,gap,width,height,seconds=70):
    original=base._candidate_positions
    try:
        base._candidate_positions=_contour_candidates
        return base._local_repair(kits,result,gap,width,height,seconds=seconds)
    finally:
        base._candidate_positions=original
