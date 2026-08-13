"""Experimental SOLO para pruebas internas.
Reacomoda como máximo 1-2 kits de una base certificada de 10 para intentar 11.
La base nunca se muta y la búsqueda tiene un límite duro de tiempo.
"""
import time
from itertools import combinations
from shapely.geometry import box, Polygon, MultiPolygon
from shapely.affinity import rotate, translate
from shapely.ops import unary_union

PLATE_W=1220.0
PLATE_H=580.0
PLATE=box(0,0,PLATE_W,PLATE_H)
ANGLES=[float(a) for a in range(0,360,15)]


def _placed_geometry(part, placement):
    g=rotate(part['geom'],float(placement.get('angle') or 0),origin=(0,0),use_radians=False)
    return translate(g,xoff=float(placement.get('xCm') or 0)*10.0,yoff=float(placement.get('yCm') or 0)*10.0)


def _polys(g):
    if g.is_empty:return []
    if isinstance(g,Polygon):return [g]
    if isinstance(g,MultiPolygon):return [x for x in g.geoms if not x.is_empty]
    return [x for x in getattr(g,'geoms',[]) if isinstance(x,Polygon) and not x.is_empty]


def _candidate_positions(part, occupied, gap, deadline, coarse=24.0, max_positions=36):
    if time.monotonic()>=deadline:return []
    buffered=occupied.buffer(gap/2.0,join_style=2) if not occupied.is_empty else occupied
    free=PLATE.difference(buffered)
    regions=sorted(_polys(free),key=lambda p:p.area,reverse=True)[:8]
    out=[]; seen=set()
    for angle in ANGLES:
        if time.monotonic()>=deadline:return out
        rg=rotate(part['geom'],angle,origin=(0,0),use_radians=False)
        minx,miny,maxx,maxy=rg.bounds; w=maxx-minx; h=maxy-miny
        if w>PLATE_W or h>PLATE_H:continue
        for region in regions:
            if time.monotonic()>=deadline:return out
            rx0,ry0,rx1,ry1=region.bounds
            if rx1-rx0+1e-6<w or ry1-ry0+1e-6<h:continue
            seeds=[(rx0,ry0),(rx1-w,ry0),(rx0,ry1-h),(rx1-w,ry1-h),((rx0+rx1-w)/2,(ry0+ry1-h)/2)]
            x=rx0
            while x<=rx1-w+1e-6 and len(seeds)<110:
                y=ry0
                while y<=ry1-h+1e-6 and len(seeds)<110:
                    seeds.append((x,y)); y+=coarse
                x+=coarse
            for gx,gy in seeds:
                if time.monotonic()>=deadline:return out
                tx=gx-minx; ty=gy-miny
                key=(round(tx,1),round(ty,1),angle)
                if key in seen:continue
                seen.add(key)
                pg=translate(rg,xoff=tx,yoff=ty)
                if not PLATE.covers(pg):continue
                if not occupied.is_empty and buffered.intersects(pg.buffer(gap/2.0,join_style=2)):
                    continue
                out.append((pg,tx,ty,angle))
                if len(out)>=max_positions:return out
    return out


def _pack_parts(parts, occupied, gap, deadline, depth=0, placements=None, node_budget=None):
    if placements is None:placements=[]
    if node_budget is None:node_budget=[700]
    if time.monotonic()>=deadline or node_budget[0]<=0:return None
    if not parts:return list(placements)

    ranked=[]
    for idx,p in enumerate(parts):
        cand=_candidate_positions(p,occupied,gap,deadline,max_positions=28 if depth<2 else 18)
        if time.monotonic()>=deadline:return None
        if not cand:return None
        ranked.append((len(cand),-float(p.get('envelope') or 0),idx,p,cand))
    ranked.sort(key=lambda x:(x[0],x[1]))
    _,_,idx,part,candidates=ranked[0]
    rest=parts[:idx]+parts[idx+1:]
    candidates=sorted(candidates,key=lambda c:(c[0].bounds[2],c[0].bounds[0]+c[0].bounds[1]))[:18]

    for geom,tx,ty,angle in candidates:
        if time.monotonic()>=deadline or node_budget[0]<=0:return None
        node_budget[0]-=1
        new_occ=unary_union([occupied,geom]) if not occupied.is_empty else geom
        pl={'instanceId':part['instanceId'],'kitId':part['kitId'],'figure':part['figure'],
            'name':part.get('name'),'role':part.get('role'),'xCm':tx/10.0,'yCm':ty/10.0,
            'angle':angle,'trimXCm':float(part.get('trimXmm') or 0)/10.0,
            'trimYCm':float(part.get('trimYmm') or 0)/10.0,'partialExtra':False}
        ans=_pack_parts(rest,new_occ,gap,deadline,depth+1,placements+[pl],node_budget)
        if ans is not None:return ans
    return None


def try_add_complete_local_repair(base_selected, base_result, all_kits, gap_mm, validator=None,
                                  max_new_candidates=4, max_removed_kits=2, max_seconds=12.0):
    started=time.monotonic(); deadline=started+max(1.0,float(max_seconds))
    by_inst={p['instanceId']:p for k in base_selected for p in k['parts']}
    base_pl=list(base_result.get('placements') or [])
    if len(base_pl)!=sum(len(k['parts']) for k in base_selected):return None

    used={k['kitId'] for k in base_selected}
    remaining=[k for k in all_kits if k['kitId'] not in used]
    remaining=sorted(remaining,key=lambda k:(k.get('envelope',1e18),-k.get('solidity',0),k.get('priority',999)))[:max_new_candidates]
    removable=sorted(base_selected,key=lambda k:(-k.get('envelope',0),k.get('solidity',1)))

    for newkit in remaining:
        if time.monotonic()>=deadline:break
        for remove_count in range(1,max_removed_kits+1):
            for removed in combinations(removable,remove_count):
                if time.monotonic()>=deadline:break
                removed_ids={k['kitId'] for k in removed}
                fixed_pl=[pl for pl in base_pl if pl.get('kitId') not in removed_ids]
                fixed_geoms=[]
                for pl in fixed_pl:
                    p=by_inst.get(pl.get('instanceId'))
                    if p is None:return None
                    fixed_geoms.append(_placed_geometry(p,pl))
                occupied=unary_union(fixed_geoms) if fixed_geoms else MultiPolygon([])
                moving=[]
                for k in removed:moving.extend(k['parts'])
                moving.extend(newkit['parts'])
                moving=sorted(moving,key=lambda p:(-p.get('envelope',0),-p.get('area',0)))
                local_pl=_pack_parts(moving,occupied,gap_mm,deadline,
                                     node_budget=[650 if remove_count==1 else 1100])
                if local_pl is None:continue

                selected=list(base_selected)+[newkit]
                placements=fixed_pl+local_pl
                selected_parts={p['instanceId']:p for k in selected for p in k['parts']}
                maxx=0.0
                for pl in placements:
                    p=selected_parts.get(pl.get('instanceId'))
                    if p is not None:maxx=max(maxx,_placed_geometry(p,pl).bounds[2])
                result=dict(base_result)
                result.update({'fits':True,'placements':placements,'placedParts':len(placements),
                               'expectedParts':len(placements),'stripWidthMm':maxx,
                               'localRepairGrowth':True,'localRepairRemoved':[k['figure'] for k in removed],
                               'localRepairAdded':newkit['figure'],'localRepairSeconds':time.monotonic()-started})
                if validator:
                    valid,cert=validator(selected,result)
                    if not valid:continue
                    result['productionCertificate']=cert
                return selected,result,newkit
    return None
