"""Certified frozen-placement cavity filler for the isolated Polifan motor lab.

Sparrow remains the primary global nester.  This helper freezes every accepted real
polygon, builds the exact residual free-space geometry with Shapely, then searches a
complete pending BASE/TAPA kit inside that free space.  It uses edge-complementary
rotations plus vertex-to-boundary alignments (an NFP-like contact search) and never
relaxes gap or plate-edge constraints.
"""
import math
import time
from shapely.affinity import rotate, translate
from shapely.geometry import box, Polygon, MultiPolygon
from shapely.ops import unary_union


def _placed_geom(part, placement):
    ang=float(placement.get('angle') or 0.0)
    tx=float(placement.get('xCm') or 0.0)*10.0
    ty=float(placement.get('yCm') or 0.0)*10.0
    return translate(rotate(part['geom'], ang, origin=(0,0), use_radians=False), xoff=tx, yoff=ty)


def _obstacles(selected, result):
    parts={str(p.get('instanceId') or ''):p for k in selected for p in (k.get('parts') or [])}
    out=[]
    for pl in (result.get('placements') or []):
        p=parts.get(str(pl.get('instanceId') or ''))
        if p is not None:out.append(_placed_geom(p,pl))
    return out


def _free_space(obstacles,width,height,gap,edge):
    usable=box(edge,edge,width-edge,height-edge)
    if not obstacles:return usable
    # Round joins preserve curved/irregular geometry better than AABB inflation.
    blocked=unary_union([g.buffer(gap,join_style=1,resolution=4) for g in obstacles])
    free=usable.difference(blocked)
    if not free.is_valid:free=free.buffer(0)
    return free


def _polygons(geom):
    if geom is None or geom.is_empty:return []
    if isinstance(geom,Polygon):return [geom]
    if isinstance(geom,MultiPolygon):return [g for g in geom.geoms if not g.is_empty]
    return [g for g in getattr(geom,'geoms',[]) if isinstance(g,Polygon) and not g.is_empty]


def _coords_limited(poly,limit=80):
    pts=list(poly.exterior.coords)[:-1]
    if len(pts)<=limit:return pts
    step=max(1,int(math.ceil(len(pts)/float(limit))))
    return pts[::step][:limit]


def _edge_angles(geom,max_angles=18):
    rows=[]
    for poly in _polygons(geom):
        pts=list(poly.exterior.coords)
        for a,b in zip(pts,pts[1:]):
            dx=b[0]-a[0];dy=b[1]-a[1];length=math.hypot(dx,dy)
            if length<2.0:continue
            ang=math.degrees(math.atan2(dy,dx))%180.0
            rows.append((length,ang))
    rows.sort(reverse=True)
    out=[]
    for _,ang in rows:
        if all(abs(((ang-x+90)%180)-90)>2.0 for x in out):out.append(ang)
        if len(out)>=max_angles:break
    return out


def _angle_candidates(part,free_geom):
    # Fixed coarse search + complementary edge alignments.  The latter discovers
    # non-obvious angles (e.g. 37°) without requiring a full 1° brute-force sweep.
    vals={float(a) for a in range(0,360,15)}
    p_angles=_edge_angles(part['geom'],12);f_angles=_edge_angles(free_geom,18)
    for pa in p_angles:
        for fa in f_angles:
            base=(fa-pa)%180.0
            vals.add(round(base,3));vals.add(round((base+180.0)%360.0,3))
    minx,miny,maxx,maxy=part['geom'].bounds
    if min(maxx-minx,maxy-miny)<=150:
        vals.update(float(a) for a in range(0,360,10))
    return sorted(vals)


def _candidate_translations(rotated,free_poly,max_contacts=180):
    """Generate contact placements by aligning part vertices/bounds to free-space boundary.

    This is a bounded NFP-style contact search: final acceptance still uses exact polygon
    containment, so generated contacts are only hypotheses, never geometric shortcuts.
    """
    rpts=[]
    for p in _polygons(rotated):rpts.extend(_coords_limited(p,36))
    fpts=_coords_limited(free_poly,72)
    if not rpts or not fpts:return
    rminx,rminy,rmaxx,rmaxy=rotated.bounds
    fminx,fminy,fmaxx,fmaxy=free_poly.bounds
    seen=set();count=0
    seeds=[(fminx-rminx,fminy-rminy),(fmaxx-rmaxx,fminy-rminy),(fminx-rminx,fmaxy-rmaxy),(fmaxx-rmaxx,fmaxy-rmaxy)]
    for tx,ty in seeds:
        key=(round(tx,2),round(ty,2))
        if key not in seen:seen.add(key);yield tx,ty;count+=1
    # Bottom-left preference first, then other boundary contacts.
    fpts=sorted(fpts,key=lambda q:(q[1],q[0]))
    rpts=sorted(rpts,key=lambda q:(q[1],q[0]))
    for fx,fy in fpts:
        for rx,ry in rpts[:24]:
            tx,ty=fx-rx,fy-ry;key=(round(tx,2),round(ty,2))
            if key in seen:continue
            seen.add(key);yield tx,ty;count+=1
            if count>=max_contacts:return


def _fits_exact(g,free_geom,obstacles,width,height,gap,edge):
    minx,miny,maxx,maxy=g.bounds
    if minx<edge-0.05 or miny<edge-0.05 or maxx>width-edge+0.05 or maxy>height-edge+0.05:return False
    # Covers allows boundary contact with the already gap-inflated free-space boundary.
    if not free_geom.buffer(0.03).covers(g):return False
    for o in obstacles:
        if g.intersects(o) or g.distance(o)<gap-0.05:return False
    return True


def _part_options(part,obstacles,width,height,gap,edge,deadline):
    free=_free_space(obstacles,width,height,gap,edge)
    regions=sorted(_polygons(free),key=lambda g:g.area,reverse=True)
    if not regions:return
    angles=_angle_candidates(part,free)
    for ang in angles:
        if time.time()>deadline:return
        rotated=rotate(part['geom'],ang,origin=(0,0),use_radians=False)
        rarea=float(rotated.area or 0)
        for region in regions:
            if time.time()>deadline:return
            if region.area+0.1<rarea:continue
            rminx,rminy,rmaxx,rmaxy=rotated.bounds;fminx,fminy,fmaxx,fmaxy=region.bounds
            if min(rmaxx-rminx,rmaxy-rminy)>max(fmaxx-fminx,fmaxy-fminy)+0.2:continue
            for tx,ty in _candidate_translations(rotated,region):
                if time.time()>deadline:return
                g=translate(rotated,xoff=tx,yoff=ty)
                if _fits_exact(g,free,obstacles,width,height,gap,edge):
                    yield g,{'angle':float(ang),'xCm':tx/10.0,'yCm':ty/10.0}


def _place_parts(parts,obstacles,width,height,gap,edge,deadline,idx=0,placements=None):
    placements=[] if placements is None else placements
    if idx>=len(parts):return list(placements)
    part=parts[idx]
    for geom,tr in _part_options(part,obstacles,width,height,gap,edge,deadline):
        pl={'instanceId':part['instanceId'],'kitId':part['kitId'],'figure':part['figure'],'name':part['name'],'role':part['role'],'trimXCm':part['trimXmm']/10.0,'trimYCm':part['trimYmm']/10.0,'partialExtra':False,**tr}
        placements.append(pl)
        got=_place_parts(parts,obstacles+[geom],width,height,gap,edge,deadline,idx+1,placements)
        if got:return got
        placements.pop()
        if time.time()>deadline:return None
    return None


def _certify(selected,cand,placements,width,height,gap,edge):
    all_parts={str(p.get('instanceId') or ''):p for k in selected+[cand] for p in (k.get('parts') or [])}
    geoms=[]
    for pl in placements:
        p=all_parts.get(str(pl.get('instanceId') or ''))
        if p is None:return False,[]
        g=_placed_geom(p,pl);minx,miny,maxx,maxy=g.bounds
        if minx<edge-0.05 or miny<edge-0.05 or maxx>width-edge+0.05 or maxy>height-edge+0.05:return False,[]
        geoms.append(g)
    for i,g in enumerate(geoms):
        for h in geoms[i+1:]:
            if g.intersects(h) or g.distance(h)<gap-0.05:return False,[]
    return True,geoms


def try_add_one(selected,kits,result,width_mm,height_mm,gap_mm,edge_mm=3.0,max_seconds=14.0,max_candidates=18):
    """Return (candidate,new_result,diagnostic) or (None,result,diagnostic)."""
    if not result or not result.get('fits'):return None,result,{'attempted':0,'reason':'base-not-fit'}
    used={str(k.get('kitId') or '') for k in selected};remain=[k for k in kits if str(k.get('kitId') or '') not in used]
    remain=sorted(remain,key=lambda k:(min([min((p['geom'].bounds[2]-p['geom'].bounds[0]),(p['geom'].bounds[3]-p['geom'].bounds[1])) for p in (k.get('parts') or [])] or [1e18]),float(k.get('envelope') or 1e18),-float(k.get('solidity') or 0),int(k.get('priority') or 999999)))[:max_candidates]
    obstacles=_obstacles(selected,result);deadline=time.time()+max(1.0,float(max_seconds));attempted=0
    initial_free=_free_space(obstacles,width_mm,height_mm,gap_mm,edge_mm)
    free_regions=_polygons(initial_free);dead_regions=sum(1 for g in free_regions if g.area<2500.0)
    for cand in remain:
        if time.time()>deadline:break
        attempted+=1
        parts=sorted(list(cand.get('parts') or []),key=lambda p:float(p.get('envelope') or 0),reverse=True)
        got=_place_parts(parts,obstacles,width_mm,height_mm,gap_mm,edge_mm,deadline)
        if not got:continue
        placements=list(result.get('placements') or [])+got
        valid,geoms=_certify(selected,cand,placements,width_mm,height_mm,gap_mm,edge_mm)
        if not valid:continue
        strip=max((g.bounds[2] for g in geoms),default=0.0)
        new=dict(result);new.update({'fits':True,'placements':placements,'placedParts':len(placements),'expectedParts':len(placements),'stripWidthMm':float(strip),'cavityPostfill':True})
        return cand,new,{'attempted':attempted,'added':cand.get('figure'),'certified':True,'freeRegionsBefore':len(free_regions),'deadRegionsBefore':dead_regions,'search':'true-free-space+edge-complementary'}
    return None,result,{'attempted':attempted,'added':None,'certified':False,'freeRegionsBefore':len(free_regions),'deadRegionsBefore':dead_regions,'search':'true-free-space+edge-complementary'}
