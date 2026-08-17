from shapely.geometry import box, Polygon, MultiPolygon
from shapely.affinity import rotate, translate
from shapely.ops import unary_union
from shapely.prepared import prep

PLATE_W=1220.0
PLATE_H=580.0
PLATE_AREA=PLATE_W*PLATE_H
ANGLES=[float(a) for a in range(0,360,15)]


def _placed_geometry(part, placement):
    g=rotate(part['geom'], float(placement.get('angle') or 0), origin=(0,0), use_radians=False)
    return translate(g, xoff=float(placement.get('xCm') or 0)*10.0, yoff=float(placement.get('yCm') or 0)*10.0)


def _all_polygons(g):
    if g.is_empty:return []
    if isinstance(g,Polygon):return [g]
    if isinstance(g,MultiPolygon):return [x for x in g.geoms if not x.is_empty]
    return [x for x in getattr(g,'geoms',[]) if isinstance(x,Polygon) and not x.is_empty]


def _try_place_part(part, occupied, gap_mm, step=10.0):
    plate=box(0,0,PLATE_W,PLATE_H)
    forbidden=occupied.buffer(max(0.0,gap_mm/2.0),join_style=2) if not occupied.is_empty else occupied
    prepared=prep(forbidden) if not forbidden.is_empty else None
    free=plate.difference(forbidden)
    regions=sorted(_all_polygons(free),key=lambda p:p.area,reverse=True)[:16]
    if not regions:return None

    for angle in ANGLES:
        rg=rotate(part['geom'],angle,origin=(0,0),use_radians=False)
        minx,miny,maxx,maxy=rg.bounds; w=maxx-minx; h=maxy-miny
        if w>PLATE_W or h>PLATE_H:continue
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
            seen=set()
            for gx,gy in seeds:
                key=(round(gx,2),round(gy,2))
                if key in seen:continue
                seen.add(key)
                tx=gx-minx; ty=gy-miny
                placed=translate(rg,xoff=tx,yoff=ty)
                if not plate.covers(placed):continue
                test=placed.buffer(max(0.0,gap_mm/2.0),join_style=2)
                if prepared is not None and prepared.intersects(test):continue
                best=(placed,tx,ty)
                for dx in (-8,-6,-4,-2,0,2,4,6,8):
                    for dy in (-8,-6,-4,-2,0,2,4,6,8):
                        ntx=tx+dx; nty=ty+dy
                        pg=translate(rg,xoff=ntx,yoff=nty)
                        if not plate.covers(pg):continue
                        pt=pg.buffer(max(0.0,gap_mm/2.0),join_style=2)
                        if prepared is not None and prepared.intersects(pt):continue
                        if pg.bounds[0]+pg.bounds[1] < best[0].bounds[0]+best[0].bounds[1]:best=(pg,ntx,nty)
                return {'geom':best[0],'xMm':best[1],'yMm':best[2],'angle':angle}
    return None


def _occupied_from_result(base_selected, base_result):
    part_by_instance={}
    for k in base_selected:
        for p in k['parts']:part_by_instance[p['instanceId']]=p
    occupied_geoms=[]
    for pl in base_result.get('placements') or []:
        p=part_by_instance.get(pl.get('instanceId'))
        if p is None:continue
        occupied_geoms.append(_placed_geometry(p,pl))
    return unary_union(occupied_geoms) if occupied_geoms else MultiPolygon([])


def try_add_partial_fixed(base_selected, base_result, all_kits, gap_mm, max_candidates=24):
    """Intenta agregar UNA sola tapa/base en el espacio residual sin mover la placa base.
    La pieza queda marcada partialExtra=True y no aumenta completeFigures. Se prioriza
    el mayor área real que quepa, porque el objetivo es aprovechar material sobrante.
    """
    if len(base_selected)<10:return None
    occupied=_occupied_from_result(base_selected,base_result)
    used={k['kitId'] for k in base_selected}
    candidates=[]
    for kit in all_kits:
        if kit['kitId'] in used:continue
        for part in kit.get('parts') or []:
            role=str(part.get('role') or '').lower()
            if role not in ('base','tapa'):continue
            candidates.append((kit,part))
    candidates=sorted(candidates,key=lambda kp:(-float(kp[1].get('area') or 0),float(kp[1].get('envelope') or 1e18),kp[0].get('priority',999999)))[:max_candidates]
    best=None
    for kit,part in candidates:
        found=_try_place_part(part,occupied,gap_mm,step=6.0)
        if not found:continue
        score=(float(part.get('area') or 0),-float(found['xMm']),-float(found['yMm']))
        if best is None or score>best[0]:best=(score,kit,part,found)
    if best is None:return None
    _,kit,part,found=best
    placement={
        'instanceId':part['instanceId'],'kitId':part['kitId'],'figure':part['figure'],'name':part['name'],'role':part['role'],
        'xCm':found['xMm']/10.0,'yCm':found['yMm']/10.0,'angle':found['angle'],
        'trimXCm':part['trimXmm']/10.0,'trimYCm':part['trimYmm']/10.0,'partialExtra':True
    }
    result=dict(base_result)
    placements=list(base_result.get('placements') or [])+[placement]
    density=float(base_result.get('density') or 0)+100.0*float(part.get('area') or 0)/PLATE_AREA
    maxx=max(float(base_result.get('stripWidthMm') or 0),float(found['geom'].bounds[2]))
    result.update({'fits':True,'density':density,'stripWidthMm':maxx,'placements':placements,'placedParts':len(placements),'expectedParts':len(placements),'partialExtra':True,'partialExtraPart':part,'partialExtraKit':kit,'fixedHoleFill':True})
    counterpart='base' if str(part.get('role')).lower()=='tapa' else 'tapa'
    meta={'kitId':kit['kitId'],'figure':kit['figure'],'component':part['role'],'missingCounterpart':counterpart,'instanceId':part['instanceId'],'name':part['name'],'areaMm2':float(part.get('area') or 0)}
    return result,meta


def try_add_complete_fixed(base_selected, base_result, all_kits, gap_mm, max_candidates=10):
    """Agrega una figura completa SIN mover ninguna pieza de la placa base.
    Devuelve None si ningún kit cabe. Las posiciones existentes se copian exactamente.
    """
    occupied=_occupied_from_result(base_selected,base_result)
    used={k['kitId'] for k in base_selected}
    remaining=[k for k in all_kits if k['kitId'] not in used]
    remaining=sorted(remaining,key=lambda k:(k['envelope'],-k['solidity'],k['priority']))[:max_candidates]

    for kit in remaining:
        current=occupied
        new_placements=[]
        parts=sorted(kit['parts'],key=lambda p:(-p['envelope'],-p['area']))
        ok=True
        for part in parts:
            found=_try_place_part(part,current,gap_mm)
            if not found:
                ok=False;break
            current=unary_union([current,found['geom']])
            new_placements.append({
                'instanceId':part['instanceId'],'kitId':part['kitId'],'figure':part['figure'],'name':part['name'],'role':part['role'],
                'xCm':found['xMm']/10.0,'yCm':found['yMm']/10.0,'angle':found['angle'],
                'trimXCm':part['trimXmm']/10.0,'trimYCm':part['trimYmm']/10.0,'partialExtra':False
            })
        if not ok:continue
        selected=list(base_selected)+[kit]
        density=100.0*sum(k['area'] for k in selected)/PLATE_AREA
        maxx=max([g.bounds[2] for g in _all_polygons(current)] or [0.0])
        result=dict(base_result)
        result.update({
            'fits':True,'density':density,'stripWidthMm':maxx,'placements':list(base_result.get('placements') or [])+new_placements,
            'placedParts':len(list(base_result.get('placements') or []))+len(new_placements),
            'expectedParts':len(list(base_result.get('placements') or []))+len(new_placements),
            'continuousRotation':False,'fixedHoleFill':True
        })
        return selected,result,kit
    return None
