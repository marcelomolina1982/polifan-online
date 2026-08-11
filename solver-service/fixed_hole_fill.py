from shapely.geometry import box, Polygon, MultiPolygon
from shapely.affinity import rotate, translate
from shapely.ops import unary_union
from shapely.prepared import prep

PLATE_W=1220.0
PLATE_H=580.0
PLATE_AREA=PLATE_W*PLATE_H
EDGE_MARGIN_MM=1.0
ANGLES=[float(a) for a in range(0,360,15)]


def _safe_plate():
    return box(EDGE_MARGIN_MM,EDGE_MARGIN_MM,PLATE_W-EDGE_MARGIN_MM,PLATE_H-EDGE_MARGIN_MM)


def _placed_geometry(part, placement):
    g=rotate(part['geom'], float(placement.get('angle') or 0), origin=(0,0), use_radians=False)
    return translate(g, xoff=float(placement.get('xCm') or 0)*10.0, yoff=float(placement.get('yCm') or 0)*10.0)


def _all_polygons(g):
    if g.is_empty:return []
    if isinstance(g,Polygon):return [g]
    if isinstance(g,MultiPolygon):return [x for x in g.geoms if not x.is_empty]
    return [x for x in getattr(g,'geoms',[]) if isinstance(x,Polygon) and not x.is_empty]


def _candidate_positions(part, occupied, gap_mm, step=10.0, max_positions=24):
    """Return several safe placements instead of accepting the first one.

    This is the key difference from the old greedy filler.  Candidates are
    ordered compactly (top/left) so the recursive caller can backtrack if a
    placement blocks the companion base/tapa.
    """
    plate=_safe_plate()
    half_gap=max(0.0,float(gap_mm)/2.0)
    forbidden=occupied.buffer(half_gap,join_style=2) if not occupied.is_empty else occupied
    prepared=prep(forbidden) if not forbidden.is_empty else None
    free=plate.difference(forbidden)
    regions=sorted(_all_polygons(free),key=lambda p:p.area,reverse=True)[:16]
    if not regions:return []

    candidates=[]; seen_global=set()
    for angle in ANGLES:
        rg=rotate(part['geom'],angle,origin=(0,0),use_radians=False)
        minx,miny,maxx,maxy=rg.bounds; w=maxx-minx; h=maxy-miny
        if w>plate.bounds[2]-plate.bounds[0] or h>plate.bounds[3]-plate.bounds[1]:continue
        for region in regions:
            rx0,ry0,rx1,ry1=region.bounds
            if rx1-rx0+1e-6<w or ry1-ry0+1e-6<h:continue
            seeds=[(rx0,ry0),(rx1-w,ry0),(rx0,ry1-h),(rx1-w,ry1-h)]
            x=rx0
            while x<=rx1-w+1e-6:
                y=ry0
                while y<=ry1-h+1e-6:
                    seeds.append((x,y)); y+=step
                x+=step
            for gx,gy in seeds:
                tx=gx-minx; ty=gy-miny
                for dx in (0,-4,4,-2,2,-6,6,-8,8):
                    for dy in (0,-4,4,-2,2,-6,6,-8,8):
                        ntx=tx+dx; nty=ty+dy
                        key=(round(ntx,2),round(nty,2),angle)
                        if key in seen_global:continue
                        seen_global.add(key)
                        pg=translate(rg,xoff=ntx,yoff=nty)
                        if not plate.covers(pg):continue
                        test=pg.buffer(half_gap,join_style=2)
                        if prepared is not None and prepared.intersects(test):continue
                        score=(pg.bounds[0]+pg.bounds[1],pg.bounds[2],pg.bounds[3],angle)
                        candidates.append((score,{'geom':pg,'xMm':ntx,'yMm':nty,'angle':angle}))
    candidates.sort(key=lambda x:x[0])
    out=[]; seen=[]
    for _,candidate in candidates:
        # Deduplicate near-identical solutions while preserving different rotations.
        sig=(round(candidate['xMm'],1),round(candidate['yMm'],1),candidate['angle'])
        if sig in seen:continue
        seen.append(sig); out.append(candidate)
        if len(out)>=max_positions:break
    return out


def _placement_payload(part, found):
    return {
        'instanceId':part['instanceId'],'kitId':part['kitId'],'figure':part['figure'],'name':part['name'],'role':part['role'],
        'xCm':found['xMm']/10.0,'yCm':found['yMm']/10.0,'angle':found['angle'],
        'trimXCm':part['trimXmm']/10.0,'trimYCm':part['trimYmm']/10.0,'partialExtra':False
    }


def _place_parts_backtracking(parts, occupied, gap_mm, depth=0):
    """Place every component of one kit, backtracking between positions.

    Typical Polifan kits have base+tapa.  The search is intentionally bounded:
    up to 24 placements for the first part and 16 for the next one, enough to
    escape the greedy dead-end without turning this phase into a global solver.
    """
    if depth>=len(parts):return occupied,[]
    part=parts[depth]
    limit=24 if depth==0 else 16
    for found in _candidate_positions(part,occupied,gap_mm,max_positions=limit):
        next_occupied=unary_union([occupied,found['geom']])
        solved=_place_parts_backtracking(parts,next_occupied,gap_mm,depth+1)
        if solved is None:continue
        final_occupied,rest=solved
        return final_occupied,[_placement_payload(part,found)]+rest
    return None


def try_add_complete_fixed(base_selected, base_result, all_kits, gap_mm, max_candidates=10):
    """Add one complete figure without moving any placement of the protected base.

    Safety rules:
    - production gap is never below 3 mm;
    - all geometry, including the protected base, must respect a 1 mm inner edge;
    - the original base placements are copied byte-for-byte into the result;
    - candidate kit parts are solved with bounded positional backtracking.
    """
    gap_mm=max(3.0,float(gap_mm or 0.0))
    plate=_safe_plate()
    part_by_instance={}
    for k in base_selected:
        for p in k['parts']:part_by_instance[p['instanceId']]=p
    occupied_geoms=[]
    for pl in base_result.get('placements') or []:
        p=part_by_instance.get(pl.get('instanceId'))
        if p is None:return None
        g=_placed_geometry(p,pl)
        # We do not "repair" the protected 10 by moving it.  An unsafe base is
        # rejected for fixed-hole growth and must be regenerated upstream.
        if not plate.covers(g):return None
        occupied_geoms.append(g)
    occupied=unary_union(occupied_geoms) if occupied_geoms else MultiPolygon([])

    used={k['kitId'] for k in base_selected}
    remaining=[k for k in all_kits if k['kitId'] not in used]
    remaining=sorted(remaining,key=lambda k:(k['envelope'],-k['solidity'],k['priority']))[:max_candidates]

    for kit in remaining:
        parts=sorted(kit['parts'],key=lambda p:(-p['envelope'],-p['area']))
        solved=_place_parts_backtracking(parts,occupied,gap_mm)
        if solved is None:continue
        current,new_placements=solved
        selected=list(base_selected)+[kit]
        density=100.0*sum(k['area'] for k in selected)/PLATE_AREA
        maxx=max([g.bounds[2] for g in _all_polygons(current)] or [0.0])
        result=dict(base_result)
        result.update({
            'fits':True,'density':density,'stripWidthMm':maxx,'placements':list(base_result.get('placements') or [])+new_placements,
            'placedParts':len(list(base_result.get('placements') or []))+len(new_placements),
            'expectedParts':len(list(base_result.get('placements') or []))+len(new_placements),
            'continuousRotation':False,'fixedHoleFill':True,'fixedHoleBacktracking':True,
            'edgeMarginMm':EDGE_MARGIN_MM,'minimumGapMm':gap_mm
        })
        return selected,result,kit
    return None
