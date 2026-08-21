from shapely.geometry import box, Polygon, MultiPolygon
from shapely.affinity import rotate, translate
from shapely.ops import unary_union
from shapely.prepared import prep
import time

PLATE_W=1220.0
PLATE_H=580.0
PLATE_AREA=PLATE_W*PLATE_H
ANGLES=[float(a) for a in range(0,360,15)]
FINE_ANGLES=[float(a) for a in range(0,360,5)]


def _placed_geometry(part, placement):
    g=rotate(part['geom'], float(placement.get('angle') or 0), origin=(0,0), use_radians=False)
    return translate(g, xoff=float(placement.get('xCm') or 0)*10.0, yoff=float(placement.get('yCm') or 0)*10.0)


def _all_polygons(g):
    if g.is_empty:return []
    if isinstance(g,Polygon):return [g]
    if isinstance(g,MultiPolygon):return [x for x in g.geoms if not x.is_empty]
    return [x for x in getattr(g,'geoms',[]) if isinstance(x,Polygon) and not x.is_empty]


def _candidate_positions(part, occupied, gap_mm, step=8.0, angles=None, region_limit=18, deadline=None, max_positions=8, prefer_right_strip=False):
    plate=box(0,0,PLATE_W,PLATE_H)
    forbidden=occupied.buffer(max(0.0,gap_mm/2.0),join_style=2) if not occupied.is_empty else occupied
    prepared=prep(forbidden) if not forbidden.is_empty else None
    free=plate.difference(forbidden)
    regions=sorted(_all_polygons(free),key=lambda p:p.area,reverse=True)[:region_limit]
    if not regions:return []
    scan_angles=angles or ANGLES
    out=[];seen_global=set()
    occupied_maxx=max([p.bounds[2] for p in _all_polygons(occupied)] or [0.0])

    for angle in scan_angles:
        if deadline and time.monotonic()>=deadline:break
        rg=rotate(part['geom'],angle,origin=(0,0),use_radians=False)
        minx,miny,maxx,maxy=rg.bounds; w=maxx-minx; h=maxy-miny
        if w>PLATE_W or h>PLATE_H:continue
        for region in regions:
            if deadline and time.monotonic()>=deadline:break
            rx0,ry0,rx1,ry1=region.bounds
            if rx1-rx0+1e-6<w or ry1-ry0+1e-6<h:continue
            seeds=[]
            if prefer_right_strip and rx1>=occupied_maxx-1e-6:
                start=max(rx0,occupied_maxx+gap_mm)
                seeds.extend([(start,ry0),(start,ry1-h),(rx1-w,ry0),(rx1-w,ry1-h)])
            seeds.extend([(rx0,ry0),(rx1-w,ry0),(rx0,ry1-h),(rx1-w,ry1-h)])
            x=rx0
            while x<=rx1-w+1e-6:
                y=ry0
                while y<=ry1-h+1e-6:
                    seeds.append((x,y));y+=step
                x+=step
            for gx,gy in seeds:
                if deadline and time.monotonic()>=deadline:break
                key=(round(gx,2),round(gy,2),round(angle,2))
                if key in seen_global:continue
                seen_global.add(key)
                tx=gx-minx;ty=gy-miny
                placed=translate(rg,xoff=tx,yoff=ty)
                if not plate.covers(placed):continue
                test=placed.buffer(max(0.0,gap_mm/2.0),join_style=2)
                if prepared is not None and prepared.intersects(test):continue
                out.append({'geom':placed,'xMm':tx,'yMm':ty,'angle':angle})
                if len(out)>=max_positions:return out
    return out


def _try_place_part(part, occupied, gap_mm, step=10.0, angles=None, region_limit=16, deadline=None):
    rows=_candidate_positions(part,occupied,gap_mm,step=step,angles=angles,region_limit=region_limit,deadline=deadline,max_positions=1)
    return rows[0] if rows else None


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
    placement={'instanceId':part['instanceId'],'kitId':part['kitId'],'figure':part['figure'],'name':part['name'],'role':part['role'],'xCm':found['xMm']/10.0,'yCm':found['yMm']/10.0,'angle':found['angle'],'trimXCm':part['trimXmm']/10.0,'trimYCm':part['trimYmm']/10.0,'partialExtra':True}
    result=dict(base_result)
    placements=list(base_result.get('placements') or [])+[placement]
    density=float(base_result.get('density') or 0)+100.0*float(part.get('area') or 0)/PLATE_AREA
    maxx=max(float(base_result.get('stripWidthMm') or 0),float(found['geom'].bounds[2]))
    result.update({'fits':True,'density':density,'stripWidthMm':maxx,'placements':placements,'placedParts':len(placements),'expectedParts':len(placements),'partialExtra':True,'partialExtraPart':part,'partialExtraKit':kit,'fixedHoleFill':True})
    counterpart='base' if str(part.get('role')).lower()=='tapa' else 'tapa'
    meta={'kitId':kit['kitId'],'figure':kit['figure'],'component':part['role'],'missingCounterpart':counterpart,'instanceId':part['instanceId'],'name':part['name'],'areaMm2':float(part.get('area') or 0)}
    return result,meta


def try_add_complete_fixed(base_selected, base_result, all_kits, gap_mm, max_candidates=10):
    """V1.14 pair-backtracking: agrega una figura completa sin mover la placa base.

    Primero explota la franja derecha libre. Para cada kit prueba varias posiciones
    de la primera pieza y, para cada una, intenta ubicar la contraparte. Así evita
    descartar una figura sólo porque la primera colocación voraz bloqueó la segunda.
    Cada candidato tiene un presupuesto corto para que un kit difícil no consuma
    toda la búsqueda residual.
    """
    occupied=_occupied_from_result(base_selected,base_result)
    used={k['kitId'] for k in base_selected}
    remaining=[k for k in all_kits if k['kitId'] not in used]
    remaining=sorted(remaining,key=lambda k:(k['envelope']/(max(0.05,k.get('solidity') or 0.05)),-k['area'],k['priority']))[:max_candidates]
    overall_deadline=time.monotonic()+11.0
    best=None

    for kit in remaining:
        if time.monotonic()>=overall_deadline:break
        candidate_deadline=min(overall_deadline,time.monotonic()+1.4)
        parts=sorted(kit.get('parts') or [],key=lambda p:(-p['envelope'],-p['area']))
        if not parts:continue
        solutions=[]

        if len(parts)==1:
            firsts=_candidate_positions(parts[0],occupied,gap_mm,step=6.0,angles=FINE_ANGLES,region_limit=24,deadline=candidate_deadline,max_positions=6,prefer_right_strip=True)
            for a in firsts:
                solutions.append(([a],unary_union([occupied,a['geom']])))
        else:
            first=parts[0];second=parts[1]
            # Más alternativas para la primera pieza = pequeño backtracking real.
            firsts=_candidate_positions(first,occupied,gap_mm,step=6.0,angles=FINE_ANGLES,region_limit=28,deadline=candidate_deadline,max_positions=8,prefer_right_strip=True)
            for a in firsts:
                if time.monotonic()>=candidate_deadline:break
                occ1=unary_union([occupied,a['geom']])
                seconds=_candidate_positions(second,occ1,gap_mm,step=6.0,angles=FINE_ANGLES,region_limit=28,deadline=candidate_deadline,max_positions=4,prefer_right_strip=True)
                for b in seconds:
                    solutions.append(([a,b],unary_union([occ1,b['geom']])))
                    if len(solutions)>=8:break
                if len(solutions)>=8:break

        for founds,current in solutions:
            if len(founds)!=len(parts):continue
            new_placements=[]
            for part,found in zip(parts,founds):
                new_placements.append({'instanceId':part['instanceId'],'kitId':part['kitId'],'figure':part['figure'],'name':part['name'],'role':part['role'],'xCm':found['xMm']/10.0,'yCm':found['yMm']/10.0,'angle':found['angle'],'trimXCm':part['trimXmm']/10.0,'trimYCm':part['trimYmm']/10.0,'partialExtra':False})
            selected=list(base_selected)+[kit]
            density=100.0*sum(k['area'] for k in selected)/PLATE_AREA
            maxx=max([g.bounds[2] for g in _all_polygons(current)] or [0.0])
            score=(float(kit.get('area') or 0),density,-maxx,-float(kit.get('priority') or 999999))
            result=dict(base_result)
            base_placements=list(base_result.get('placements') or [])
            result.update({'fits':True,'density':density,'stripWidthMm':maxx,'placements':base_placements+new_placements,'placedParts':len(base_placements)+len(new_placements),'expectedParts':len(base_placements)+len(new_placements),'continuousRotation':False,'fixedHoleFill':True,'completeResidualFineSearch':True,'completeResidualPairBacktracking':True})
            if best is None or score>best[0]:best=(score,selected,result,kit)

    if best is None:return None
    return best[1],best[2],best[3]
