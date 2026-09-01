"""Sparrow V1.13 residual fill.

Conserva intacta la placa certificada y usa huecos residuales para agregar hasta
3 bases/tapas sueltas. Prioriza área útil real, usa rotación fina y nunca modifica
completeFigures. Cada extra informa la contraparte que deberá cortarse después.
"""
from shapely.ops import unary_union
from shapely.affinity import rotate, translate
from shapely.geometry import box

PLATE_W=1230.0
PLATE_H=580.0
PLATE_AREA=PLATE_W*PLATE_H
FINE_ANGLES=[float(a) for a in range(0,360,5)]


def _placed(part, placement):
    g=rotate(part['geom'],float(placement.get('angle') or 0),origin=(0,0),use_radians=False)
    return translate(g,xoff=float(placement.get('xCm') or 0)*10.0,yoff=float(placement.get('yCm') or 0)*10.0)


def _occupied(selected, result):
    by_id={}
    for kit in selected:
        for part in kit.get('parts') or []:
            by_id[str(part.get('instanceId'))]=part
    geoms=[]
    for pl in result.get('placements') or []:
        part=by_id.get(str(pl.get('instanceId')))
        if part is not None:
            geoms.append(_placed(part,pl))
    return unary_union(geoms) if geoms else None


def _try_part(part, occupied, gap_mm, step=4.0):
    plate=box(0,0,PLATE_W,PLATE_H)
    base_forbidden=occupied.buffer(max(0.0,gap_mm/2.0),join_style=2) if occupied is not None and not occupied.is_empty else None
    free=plate.difference(base_forbidden) if base_forbidden is not None else plate
    regions=[g for g in getattr(free,'geoms',[free]) if not g.is_empty]
    regions=sorted(regions,key=lambda g:g.area,reverse=True)[:24]
    for angle in FINE_ANGLES:
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
                    seeds.append((x,y));y+=step
                x+=step
            seen=set()
            for gx,gy in seeds:
                key=(round(gx,2),round(gy,2))
                if key in seen:continue
                seen.add(key)
                tx=gx-minx;ty=gy-miny
                pg=translate(rg,xoff=tx,yoff=ty)
                if not plate.covers(pg):continue
                if base_forbidden is not None and base_forbidden.intersects(pg.buffer(max(0.0,gap_mm/2.0),join_style=2)):continue
                return {'geom':pg,'xMm':tx,'yMm':ty,'angle':angle}
    return None


def try_iterative_residual_fill(base_selected,base_result,all_kits,gap_mm,max_extras=3,target_density=70.0,max_candidates=48):
    if len(base_selected)<10:return None
    result=dict(base_result)
    result['placements']=list(base_result.get('placements') or [])
    current=_occupied(base_selected,result)
    if current is None:return None
    used_kits={str(k.get('kitId')) for k in base_selected}
    extras=[]

    for _ in range(max_extras):
        if float(result.get('density') or 0)>=target_density:break
        candidates=[]
        for kit in all_kits:
            kid=str(kit.get('kitId'))
            if kid in used_kits:continue
            for part in kit.get('parts') or []:
                role=str(part.get('role') or '').lower()
                if role not in ('base','tapa'):continue
                candidates.append((kit,part))
        candidates=sorted(candidates,key=lambda kp:(-float(kp[1].get('area') or 0),float(kp[1].get('envelope') or 1e18),kp[0].get('priority',999999)))[:max_candidates]
        best=None
        for kit,part in candidates:
            found=_try_part(part,current,gap_mm)
            if not found:continue
            score=(float(part.get('area') or 0),-float(found['xMm']),-float(found['yMm']))
            if best is None or score>best[0]:best=(score,kit,part,found)
        if best is None:break
        _,kit,part,found=best
        placement={'instanceId':part['instanceId'],'kitId':part['kitId'],'figure':part['figure'],'name':part['name'],'role':part['role'],'xCm':found['xMm']/10.0,'yCm':found['yMm']/10.0,'angle':found['angle'],'trimXCm':part['trimXmm']/10.0,'trimYCm':part['trimYmm']/10.0,'partialExtra':True}
        result['placements'].append(placement)
        current=unary_union([current,found['geom']])
        used_kits.add(str(kit.get('kitId')))
        area=float(part.get('area') or 0)
        result['density']=float(result.get('density') or 0)+100.0*area/PLATE_AREA
        result['stripWidthMm']=max(float(result.get('stripWidthMm') or 0),float(found['geom'].bounds[2]))
        counterpart='base' if str(part.get('role')).lower()=='tapa' else 'tapa'
        extras.append({'kitId':kit['kitId'],'figure':kit['figure'],'component':str(part['role']).lower(),'missingCounterpart':counterpart,'instanceId':part['instanceId'],'name':part['name'],'areaMm2':area})

    if not extras:return None
    result.update({'fits':True,'placedParts':len(result['placements']),'expectedParts':len(result['placements']),'partialExtra':True,'partialExtras':extras,'fixedHoleFill':True,'residualFillV13':True})
    return result,extras
