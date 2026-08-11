from flask import request, jsonify
import time
import nest_sparrow as ns
import fixed_hole_fill as fh

# -----------------------------------------------------------------------------
# BASE ESTABLE: primero conseguir 10 completas sin recorrer combinaciones masivas.
# -----------------------------------------------------------------------------
MAX_BASE_SEARCH_SECONDS=150
MAX_BASE_POOL=24
MAX_BASE_VARIANTS=4
HOLE_EXACT_CANDIDATES=6


def _base_plan(variant_count):
    if variant_count <= 0:return []
    plan=[
        (0,429,34,False,'base estable preferida'),
        (0,41,28,False,'segunda semilla estable'),
    ]
    if variant_count>1:plan.append((1,235,24,False,'alternativa compacta'))
    if variant_count>2:plan.append((2,941,24,False,'alternativa balanceada'))
    plan.append((0,1901,26,True,'rescate continuo final'))
    return plan


def _base_only_nest_sparrow():
    started=time.time(); data=request.get_json(silent=True) or {}
    if not ns.os.path.exists(ns.SPARROW_BIN):
        return jsonify(ok=False,error='El binario Sparrow no está instalado en Render'),503

    width_mm=max(1.0,ns._n(data.get('widthCm'),122)*10)
    height_mm=max(1.0,ns._n(data.get('heightCm'),58)*10)
    if abs(width_mm-ns.PLATE_WIDTH_MM)>1 or abs(height_mm-ns.PLATE_HEIGHT_MM)>1:
        return jsonify(ok=False,error='Sparrow producción está fijado a placa 1220×580 mm'),400

    gap=max(3.0,ns._n(data.get('gapCm'),.3)*10)
    raw=sorted(data.get('kits') or [],key=lambda k:(ns._priority(k),str(k.get('date') or ''),str(k.get('figure') or '')))[:MAX_BASE_POOL]
    if not raw:return jsonify(ok=False,error='No llegaron figuras a Sparrow'),400

    kits=[]; rejected=[]
    for k in raw:
        try:kits.append(ns._prep_kit(k,width_mm,height_mm))
        except Exception as exc:rejected.append({'kitId':str(k.get('kitId') or ''),'figure':str(k.get('figure') or ''),'reason':str(exc)})
    if len(kits)<10:return jsonify(ok=False,error=f'Sólo hay {len(kits)} kits geométricos utilizables',rejected=rejected[:8]),422

    variants=ns._candidate_selections(kits,10)
    variants=sorted(variants,key=lambda row:0 if row[0]=='prioridad flexible + compactas' else 1)[:MAX_BASE_VARIANTS]
    attempts=[]

    for variant_idx,seed,seconds,continuous,tag in _base_plan(len(variants)):
        remaining=MAX_BASE_SEARCH_SECONDS-(time.time()-started)
        if remaining<12:break
        if variant_idx>=len(variants):continue
        run_seconds=max(12,min(seconds,int(remaining-5)))
        label,selected=variants[variant_idx]
        result=ns._run_sparrow(selected,gap,run_seconds,seed,continuous=continuous)
        attempts.append({
            'label':f'{tag} · {label}','seed':seed,'seconds':run_seconds,
            'ok':result.get('ok'),'fits':result.get('fits'),'stripWidthMm':result.get('stripWidthMm'),
            'density':round(float(result.get('density') or 0),1),
            'solverDensity':round(float(result.get('solverDensity') or 0),1),
            'rotation':('continua' if continuous else '15°'),'error':result.get('error')
        })
        if result.get('ok') and result.get('fits'):
            response=ns._result_payload(selected,f'base 10 estable · {tag} · {label}',result,kits,rejected,attempts,started,None)
            payload=response.get_json()
            payload.update({
                'engine':'Sparrow · base 10 estable + selector de huecos + V1.7',
                'baseOnly':True,'baseSeed':seed,'baseProtected':True,
                'baseSearchSeconds':round(time.time()-started,2),'baseAttempts':len(attempts),
                'minimumGapMm':gap,'baseCandidatePool':len(kits),'holeCandidateLimit':HOLE_EXACT_CANDIDATES,
            })
            return jsonify(payload)

    return jsonify(
        ok=False,
        error='Sparrow no encontró la base de 10 dentro del presupuesto estable. Se detuvo sin recorrer combinaciones masivas.',
        engine='Sparrow · base 10 estable + selector de huecos + V1.7',
        attempts=attempts,candidatePool=len(kits),rejectedCount=len(rejected),rejected=rejected[:8],
        elapsedSeconds=round(time.time()-started,2),minimumGapMm=gap
    ),422


# -----------------------------------------------------------------------------
# SELECTOR DE HUECOS: se ejecuta DESPUÉS de tener 10 y no mueve la base.
# Monkey-patch deliberado: fixed_hole_runtime importa esta función después de este
# módulo, así evitamos otro archivo/commit y, por tanto, otro build de Vercel.
# -----------------------------------------------------------------------------
def _free_geometry(occupied,gap_mm):
    plate=fh.box(0,0,fh.PLATE_W,fh.PLATE_H)
    forbidden=occupied.buffer(max(0.0,gap_mm/2.0),join_style=2) if not occupied.is_empty else occupied
    free=plate.difference(forbidden)
    if not free.is_valid:free=free.buffer(0)
    return free


def _part_region_fit(part,regions):
    best=None
    for angle in fh.ANGLES:
        rg=fh.rotate(part['geom'],angle,origin=(0,0),use_radians=False)
        minx,miny,maxx,maxy=rg.bounds; w=maxx-minx; h=maxy-miny
        for region in regions:
            rx0,ry0,rx1,ry1=region.bounds; rw=rx1-rx0; rh=ry1-ry0
            if w<=rw+1e-6 and h<=rh+1e-6:
                slack=(rw-w)+(rh-h)
                ratio=float(part.get('area') or rg.area)/max(region.area,1.0)
                score=1000.0-slack-250.0*abs(0.45-ratio)
                if best is None or score>best:best=score
    return best


def _kit_hole_score(kit,free):
    regions=sorted(fh._all_polygons(free),key=lambda p:p.area,reverse=True)[:10]
    if not regions:return None
    parts=sorted(kit['parts'],key=lambda p:(-p['envelope'],-p['area']))
    if sum(float(p.get('area') or 0) for p in parts)>free.area+1e-6:return None
    scores=[]
    for part in parts:
        score=_part_region_fit(part,regions)
        if score is None:return None
        scores.append(score)
    return sum(scores)+120.0*float(kit.get('solidity') or 0)-0.02*float(kit.get('priority') or 0)


def _hole_aware_add_complete_fixed(base_selected,base_result,all_kits,gap_mm,max_candidates=16):
    part_by_instance={}
    for k in base_selected:
        for p in k['parts']:part_by_instance[p['instanceId']]=p
    occupied_geoms=[]
    for pl in base_result.get('placements') or []:
        p=part_by_instance.get(pl.get('instanceId'))
        if p is None:return None
        occupied_geoms.append(fh._placed_geometry(p,pl))
    occupied=fh.unary_union(occupied_geoms) if occupied_geoms else fh.MultiPolygon([])
    free=_free_geometry(occupied,gap_mm)

    used={k['kitId'] for k in base_selected}
    ranked=[]
    for kit in all_kits:
        if kit['kitId'] in used:continue
        score=_kit_hole_score(kit,free)
        if score is not None:ranked.append((score,kit))
    ranked.sort(key=lambda row:row[0],reverse=True)
    # Aunque el runtime viejo pida 16, el backtracking exacto recibe como máximo 6.
    candidates=[kit for _,kit in ranked[:min(HOLE_EXACT_CANDIDATES,max_candidates)]]

    for kit in candidates:
        current=occupied; new_placements=[]; ok=True
        for part in sorted(kit['parts'],key=lambda p:(-p['envelope'],-p['area'])):
            found=fh._try_place_part(part,current,gap_mm)
            if not found:ok=False;break
            current=fh.unary_union([current,found['geom']])
            new_placements.append({
                'instanceId':part['instanceId'],'kitId':part['kitId'],'figure':part['figure'],'name':part['name'],'role':part['role'],
                'xCm':found['xMm']/10.0,'yCm':found['yMm']/10.0,'angle':found['angle'],
                'trimXCm':part['trimXmm']/10.0,'trimYCm':part['trimYmm']/10.0,'partialExtra':False
            })
        if not ok:continue
        selected=list(base_selected)+[kit]
        density=100.0*sum(k['area'] for k in selected)/fh.PLATE_AREA
        maxx=max([g.bounds[2] for g in fh._all_polygons(current)] or [0.0])
        result=dict(base_result)
        result.update({
            'fits':True,'density':density,'stripWidthMm':maxx,
            'placements':list(base_result.get('placements') or [])+new_placements,
            'placedParts':len(list(base_result.get('placements') or []))+len(new_placements),
            'expectedParts':len(list(base_result.get('placements') or []))+len(new_placements),
            'continuousRotation':False,'fixedHoleFill':True,
            'holeCandidateCount':len(candidates),'holeCompatibleCount':len(ranked),
        })
        return selected,result,kit
    return None


fh.try_add_complete_fixed=_hole_aware_add_complete_fixed
ns.nest_sparrow=_base_only_nest_sparrow
if 'nest_sparrow' in ns.app.view_functions:
    ns.app.view_functions['nest_sparrow']=_base_only_nest_sparrow
