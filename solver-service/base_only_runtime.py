from flask import request, jsonify
import time, unicodedata
from collections import Counter
import nest_sparrow as ns
import fixed_hole_fill as fh

# -----------------------------------------------------------------------------
# RECUPERACION ESTABLE: primero conseguir 10 con la estrategia que ya funciono.
# Despues se protege esa base y recien ahi se intenta rellenar huecos.
# -----------------------------------------------------------------------------
MAX_BASE_SEARCH_SECONDS=168
MAX_BASE_POOL=32
MAX_INPUT_POOL=64
MAX_BASE_VARIANTS=6
HOLE_EXACT_CANDIDATES=6

PROVEN_COUNTS=Counter({
    'abejita':1,
    'chase paw patrol':1,
    'escudo river plate':1,
    'flor simple':1,
    'jessie toy story':1,
    'stitch cara':1,
    'unicornio':1,
    'woody toy story':1,
    'botin':2,
})

PROVEN_ALIASES={
    'abejita':('abejita','abeja'),
    'chase paw patrol':('chase paw patrol','chase'),
    'escudo river plate':('escudo river plate','river plate','escudo river'),
    'flor simple':('flor simple',),
    'jessie toy story':('jessie toy story','jessie'),
    'stitch cara':('stitch cara','stitch'),
    'unicornio':('unicornio',),
    'woody toy story':('woody toy story','woody'),
    'botin':('botin','botines'),
}


def _norm(value):
    text=unicodedata.normalize('NFD',str(value or '').strip().lower())
    text=''.join(c for c in text if unicodedata.category(c)!='Mn')
    return ' '.join(text.replace('_',' ').replace('-',' ').split())


def _proven_key(value):
    name=_norm(value)
    for key,aliases in PROVEN_ALIASES.items():
        for alias in aliases:
            a=_norm(alias)
            if name==a or (len(a)>=5 and (name.startswith(a+' ') or name.endswith(' '+a))):
                return key
    return None


def _proven_selection(rows):
    remaining=Counter(PROVEN_COUNTS)
    selected=[]
    for row in rows:
        key=_proven_key(row.get('figure'))
        if key and remaining.get(key,0)>0:
            selected.append(row)
            remaining[key]-=1
    return selected if len(selected)==10 and not any(remaining.values()) else []


def _unique_raw(rows):
    out=[];seen=set()
    for row in rows:
        kid=str(row.get('kitId') or '')
        marker=kid or f"{_norm(row.get('figure'))}:{len(out)}"
        if marker in seen:continue
        seen.add(marker);out.append(row)
    return out


def _variant_index(variants,label):
    for i,(name,_) in enumerate(variants):
        if name==label:return i
    return None


def _base_plan(variants,has_proven):
    plan=[]
    # Esta fue la seleccion historicamente exitosa antes de la regresion.
    preferred=_variant_index(variants,'prioridad flexible + compactas')
    if preferred is not None:
        plan.extend([
            (preferred,429,70,False,'BASE HISTORICA · semilla 429'),
            (preferred,41,55,False,'BASE HISTORICA · semilla 41'),
            (preferred,701,28,True,'BASE HISTORICA · rescate continuo'),
        ])

    # La combinacion extraida de la placa certificada queda como respaldo.
    proven_idx=_variant_index(variants,'COMBINACION REAL CERTIFICADA 10/08') if has_proven else None
    if proven_idx is not None and proven_idx!=preferred:
        plan.extend([
            (proven_idx,429,24,False,'BASE CERTIFICADA · semilla 429'),
            (proven_idx,41,20,False,'BASE CERTIFICADA · semilla 41'),
        ])

    # Si todavia queda presupuesto, probar alternativas sin volver al barrido masivo.
    for i,(label,_) in enumerate(variants[:MAX_BASE_VARIANTS]):
        if i in {preferred,proven_idx}:continue
        plan.append((i,235+i*353,18,False,f'RESCATE · {label}'))
    return plan


def _base_only_nest_sparrow():
    started=time.time(); data=request.get_json(silent=True) or {}
    if not ns.os.path.exists(ns.SPARROW_BIN):
        return jsonify(ok=False,error='El binario Sparrow no esta instalado en Render'),503

    width_mm=max(1.0,ns._n(data.get('widthCm'),122)*10)
    height_mm=max(1.0,ns._n(data.get('heightCm'),58)*10)
    if abs(width_mm-ns.PLATE_WIDTH_MM)>1 or abs(height_mm-ns.PLATE_HEIGHT_MM)>1:
        return jsonify(ok=False,error='Sparrow produccion esta fijado a placa 1220x580 mm'),400

    gap=max(3.0,ns._n(data.get('gapCm'),.3)*10)
    incoming=sorted(data.get('kits') or [],key=lambda k:(ns._priority(k),str(k.get('date') or ''),str(k.get('figure') or '')))[:MAX_INPUT_POOL]
    if not incoming:return jsonify(ok=False,error='No llegaron figuras a Sparrow'),400

    # Mantener los primeros 32 exactamente como lo hacia el motor que dio la placa valida.
    # Si la combinacion certificada esta disponible dentro de lo recibido, agregarla sin
    # desplazar esos 32 candidatos historicos.
    proven_raw=_proven_selection(incoming)
    raw=_unique_raw(incoming[:MAX_BASE_POOL]+proven_raw)

    kits=[]; rejected=[]
    for k in raw:
        try:kits.append(ns._prep_kit(k,width_mm,height_mm))
        except Exception as exc:rejected.append({'kitId':str(k.get('kitId') or ''),'figure':str(k.get('figure') or ''),'reason':str(exc)})
    if len(kits)<10:return jsonify(ok=False,error=f'Solo hay {len(kits)} kits geometricos utilizables',rejected=rejected[:8]),422

    variants=[]
    # Primero reconstruimos las variantes originales de Sparrow.
    for label,rows in ns._candidate_selections(kits,10):
        sig=tuple(k['kitId'] for k in rows)
        if any(tuple(k['kitId'] for k in old)==sig for _,old in variants):continue
        variants.append((label,rows))
        if len(variants)>=MAX_BASE_VARIANTS:break

    proven=_proven_selection(kits)
    if proven:
        psig=tuple(k['kitId'] for k in proven)
        if not any(tuple(k['kitId'] for k in old)==psig for _,old in variants):
            variants.append(('COMBINACION REAL CERTIFICADA 10/08',proven))

    attempts=[]
    for variant_idx,seed,seconds,continuous,tag in _base_plan(variants,bool(proven)):
        remaining=MAX_BASE_SEARCH_SECONDS-(time.time()-started)
        if remaining<12:break
        if variant_idx is None or variant_idx>=len(variants):continue
        run_seconds=max(10,min(seconds,int(remaining-5)))
        label,selected=variants[variant_idx]
        result=ns._run_sparrow(selected,gap,run_seconds,seed,continuous=continuous)
        attempts.append({
            'label':f'{tag} · {label}','seed':seed,'seconds':run_seconds,
            'ok':result.get('ok'),'fits':result.get('fits'),'stripWidthMm':result.get('stripWidthMm'),
            'placedParts':result.get('placedParts'),'expectedParts':result.get('expectedParts'),
            'runTimeSec':result.get('runTimeSec'),
            'density':round(float(result.get('density') or 0),1),
            'solverDensity':round(float(result.get('solverDensity') or 0),1),
            'rotation':('continua' if continuous else '15°'),'error':result.get('error')
        })
        if result.get('ok') and result.get('fits'):
            response=ns._result_payload(selected,f'base 10 protegida · {tag} · {label}',result,kits,rejected,attempts,started,None)
            payload=response.get_json()
            payload.update({
                'engine':'Sparrow · base historica recuperada + crecimiento por huecos + V1.7',
                'baseOnly':True,'baseSeed':seed,'baseProtected':True,
                'baseSearchSeconds':round(time.time()-started,2),'baseAttempts':len(attempts),
                'minimumGapMm':gap,'baseCandidatePool':len(kits),'holeCandidateLimit':HOLE_EXACT_CANDIDATES,
                'provenCombinationAvailable':bool(proven),
                'provenCombinationUsed':label.startswith('COMBINACION REAL CERTIFICADA'),
                'historicalPreferredUsed':label=='prioridad flexible + compactas',
            })
            return jsonify(payload)

    # El error ahora deja visible el mejor diagnostico de Sparrow para no volver a adivinar.
    best_attempt=None
    if attempts:
        best_attempt=max(attempts,key=lambda a:(int(a.get('placedParts') or 0),-float(a.get('stripWidthMm') or 1e18)))
    proven_received=[]
    for row in incoming:
        key=_proven_key(row.get('figure'))
        if key:proven_received.append(key)
    return jsonify(
        ok=False,
        error='Sparrow no pudo recuperar la base de 10. Se restauro la estrategia historicamente exitosa (compactas, semilla 429/41) antes de cualquier rescate.',
        engine='Sparrow · base historica recuperada + crecimiento por huecos + V1.7',
        attempts=attempts,bestAttempt=best_attempt,candidatePool=len(kits),
        rejectedCount=len(rejected),rejected=rejected[:8],
        elapsedSeconds=round(time.time()-started,2),minimumGapMm=gap,
        provenCombinationAvailable=bool(proven),provenRawAvailable=bool(proven_raw),
        provenReceived=proven_received,
        inputKitsReceived=len(data.get('kits') or []),inputKitsInspected=len(incoming),
        historicalPreferredAvailable=_variant_index(variants,'prioridad flexible + compactas') is not None
    ),422


# -----------------------------------------------------------------------------
# SELECTOR DE HUECOS: se ejecuta DESPUES de tener 10 y no mueve la base.
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
