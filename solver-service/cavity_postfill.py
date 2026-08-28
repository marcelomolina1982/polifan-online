"""Deterministic frozen-placement cavity filler for the isolated motor lab.

Sparrow remains the primary global nester. When a complete selected set already fits,
this helper preserves every accepted placement and searches the true residual geometry
for one additional complete kit. It never relaxes gap or plate bounds.
"""
import time
from shapely.affinity import rotate, translate


def _placed_geom(part, placement):
    ang=float(placement.get('angle') or 0.0)
    tx=float(placement.get('xCm') or 0.0)*10.0
    ty=float(placement.get('yCm') or 0.0)*10.0
    return translate(rotate(part['geom'], ang, origin=(0,0), use_radians=False), xoff=tx, yoff=ty)


def _obstacles(selected, result):
    parts={p['instanceId']:p for k in selected for p in (k.get('parts') or [])}
    out=[]
    for pl in (result.get('placements') or []):
        p=parts.get(str(pl.get('instanceId') or ''))
        if p is not None:
            out.append(_placed_geom(p,pl))
    return out


def _anchors(obstacles, width, height, gap, edge):
    xs={edge}; ys={edge}
    for g in obstacles:
        minx,miny,maxx,maxy=g.bounds
        xs.add(max(edge,maxx+gap)); ys.add(max(edge,maxy+gap))
        xs.add(max(edge,minx-gap)); ys.add(max(edge,miny-gap))
    xs=[x for x in xs if edge-0.01<=x<=width-edge+0.01]
    ys=[y for y in ys if edge-0.01<=y<=height-edge+0.01]
    return sorted(xs),sorted(ys)


def _fits(g, obstacles, width, height, gap, edge):
    minx,miny,maxx,maxy=g.bounds
    if minx<edge-0.05 or miny<edge-0.05 or maxx>width-edge+0.05 or maxy>height-edge+0.05:
        return False
    for o in obstacles:
        if g.intersects(o) or g.distance(o)<gap-0.05:
            return False
    return True


def _part_options(part, obstacles, width, height, gap, edge, deadline):
    xs,ys=_anchors(obstacles,width,height,gap,edge)
    angles=list(range(0,360,15))
    # Compact parts benefit from a finer angular search, but keep it bounded.
    minx,miny,maxx,maxy=part['geom'].bounds
    if min(maxx-minx,maxy-miny)<=150:
        angles=list(range(0,360,10))
    for ang in angles:
        if time.time()>deadline:return
        r=rotate(part['geom'],ang,origin=(0,0),use_radians=False)
        rminx,rminy,rmaxx,rmaxy=r.bounds
        rw,rh=rmaxx-rminx,rmaxy-rminy
        # lower-left candidate anchors formed by residual obstacle edges
        for x in xs:
            if x+rw>width-edge+0.05:continue
            for y in ys:
                if time.time()>deadline:return
                if y+rh>height-edge+0.05:continue
                tx=x-rminx;ty=y-rminy
                g=translate(r,xoff=tx,yoff=ty)
                if _fits(g,obstacles,width,height,gap,edge):
                    yield g,{'angle':float(ang),'xCm':tx/10.0,'yCm':ty/10.0}


def _place_parts(parts, obstacles, width, height, gap, edge, deadline, idx=0, placements=None):
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


def try_add_one(selected,kits,result,width_mm,height_mm,gap_mm,edge_mm=3.0,max_seconds=10.0,max_candidates=14):
    """Return (candidate,new_result,diagnostic) or (None,result,diagnostic)."""
    if not result or not result.get('fits'):return None,result,{'attempted':0,'reason':'base-not-fit'}
    used={k.get('kitId') for k in selected}
    remain=[k for k in kits if k.get('kitId') not in used]
    # Cavity-friendly first: narrow envelope, then solidity/priority.
    remain=sorted(remain,key=lambda k:(min([min((p['geom'].bounds[2]-p['geom'].bounds[0]),(p['geom'].bounds[3]-p['geom'].bounds[1])) for p in (k.get('parts') or [])] or [1e18]),k.get('envelope',1e18),-k.get('solidity',0),k.get('priority',999999)))[:max_candidates]
    obstacles=_obstacles(selected,result)
    deadline=time.time()+max(1.0,float(max_seconds));attempted=0
    for cand in remain:
        if time.time()>deadline:break
        attempted+=1
        parts=sorted(list(cand.get('parts') or []),key=lambda p:float(p.get('envelope') or 0),reverse=True)
        got=_place_parts(parts,obstacles,width_mm,height_mm,gap_mm,edge_mm,deadline)
        if not got:continue
        placements=list(result.get('placements') or [])+got
        # Rebuild occupied geometry for exact final width and an independent collision check.
        all_parts={p['instanceId']:p for k in selected+[cand] for p in (k.get('parts') or [])}
        geoms=[];valid=True
        for pl in placements:
            p=all_parts.get(str(pl.get('instanceId') or ''))
            if p is None:valid=False;break
            g=_placed_geom(p,pl);geoms.append(g)
            minx,miny,maxx,maxy=g.bounds
            if minx<edge_mm-0.05 or miny<edge_mm-0.05 or maxx>width_mm-edge_mm+0.05 or maxy>height_mm-edge_mm+0.05:valid=False;break
        if valid:
            for i,g in enumerate(geoms):
                for h in geoms[i+1:]:
                    if g.intersects(h) or g.distance(h)<gap_mm-0.05:
                        valid=False;break
                if not valid:break
        if not valid:continue
        strip=max((g.bounds[2] for g in geoms),default=0.0)
        new=dict(result);new.update({'fits':True,'placements':placements,'placedParts':len(placements),'expectedParts':len(placements),'stripWidthMm':float(strip),'cavityPostfill':True})
        return cand,new,{'attempted':attempted,'added':cand.get('figure'),'certified':True}
    return None,result,{'attempted':attempted,'added':None,'certified':False}
