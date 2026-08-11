from flask import request, jsonify
import time, random
import nest_sparrow as ns

try:
    from pyckingsolver import InstanceBuilder, Objective, Solver
    PYCKING_AVAILABLE = True
except Exception as exc:
    InstanceBuilder = Objective = Solver = None
    PYCKING_AVAILABLE = False
    PYCKING_IMPORT_ERROR = str(exc)[:180]
else:
    PYCKING_IMPORT_ERROR = ''

_base_nest = ns.nest_sparrow
PLATE_W = 1220.0
PLATE_H = 580.0
MIN_GAP = 3.0
# La búsqueda híbrida corre dentro del job asíncrono de Render: puede explorar más sin perder la base segura de 10.
MAX_COMPETITOR_SECONDS = 118.0
POOL_SIZE = 32
BEAM_WIDTH = 16
GENERATIONS = 7
MAX_SOLVER_TRIALS = 18
# Más libertad angular que V3: 36 orientaciones en vez de 24.
ANGLES = [(float(a), float(a)) for a in range(0, 360, 10)]
RUNTIME_VERSION = 'hybrid-3.1-deep-beam-11plus'


def _unwrap(value):
    status=200; resp=value
    if isinstance(value,tuple):
        resp=value[0]
        if len(value)>1 and isinstance(value[1],int): status=value[1]
    try:data=resp.get_json()
    except Exception:data=None
    try:status=int(getattr(resp,'status_code',status) or status)
    except Exception:pass
    return resp,status,data


def _prepare_all(data):
    width=max(1.0,ns._n(data.get('widthCm'),122)*10); height=max(1.0,ns._n(data.get('heightCm'),58)*10)
    raw=sorted(data.get('kits') or [],key=lambda k:(ns._priority(k),str(k.get('date') or ''),str(k.get('figure') or '')))[:180]
    out=[]
    for row in raw:
        try:out.append(ns._prep_kit(row,width,height))
        except Exception:pass
    return out


def _metrics(k):
    area=max(1.0,float(k.get('area') or 1)); env=max(area,float(k.get('envelope') or area)); sol=float(k.get('solidity') or 0)
    parts=k.get('parts') or []
    ratios=[]
    for p in parts:
        try:
            minx,miny,maxx,maxy=p['geom'].bounds; w=maxx-minx; h=maxy-miny
            ratios.append(max(w,h)/max(1.0,min(w,h)))
        except Exception: pass
    elong=sum(ratios)/len(ratios) if ratios else 1.0
    return area,env,sol,elong


def _group_score(group):
    areas=[]; solids=[]; elongs=[]; compact=[]
    for k in group:
        a,e,s,l=_metrics(k); areas.append(a); solids.append(s); elongs.append(l); compact.append(a/max(1.0,e))
    density=100.0*sum(areas)/(PLATE_W*PLATE_H)
    avg_comp=sum(compact)/len(compact); avg_sol=sum(solids)/len(solids)
    spread=(max(elongs)-min(elongs)) if elongs else 0
    priority_pen=sum(float(k.get('priority') or 999999) for k in group)/len(group)
    # Ya no castigamos grupos por superar 82%: para 11+ queremos toda la densidad físicamente posible.
    density_bonus=min(density, 92.0)
    return (density_bonus, avg_comp, avg_sol, spread, -priority_pen)


def _seed_groups(pool,target,rng):
    by_compact=sorted(pool,key=lambda k:(_metrics(k)[1]/_metrics(k)[0],-float(k.get('solidity') or 0)))
    by_area=sorted(pool,key=lambda k:-_metrics(k)[0])
    by_small=sorted(pool,key=lambda k:_metrics(k)[0])
    by_priority=sorted(pool,key=lambda k:float(k.get('priority') or 999999))
    by_elong=sorted(pool,key=lambda k:_metrics(k)[3],reverse=True)
    seeds=[by_compact[:target],by_area[:target],by_small[:target],by_priority[:target],by_elong[:target]]
    top=pool[:min(len(pool),30)]
    # Más diversidad inicial que V3 para escapar de las mismas 10 figuras recurrentes.
    for _ in range(14):
        if len(top)>=target: seeds.append(rng.sample(top,target))
    out=[];seen=set()
    for g in seeds:
        sig=tuple(sorted(str(k.get('kitId') or '') for k in g))
        if len(g)==target and sig not in seen:seen.add(sig);out.append(g)
    return out


def _mutations(group,pool,rng):
    used={str(k.get('kitId') or '') for k in group}; remain=[k for k in pool if str(k.get('kitId') or '') not in used]
    out=[]
    if not remain:return out
    # Más swaps simples por generación.
    for idx in rng.sample(range(len(group)),min(7,len(group))):
        for new in rng.sample(remain,min(5,len(remain))):
            g=list(group);g[idx]=new;out.append(g)
    # Swaps dobles para cambiar de familia geométrica.
    if len(group)>=2 and len(remain)>=2:
        for _ in range(10):
            i,j=rng.sample(range(len(group)),2); a,b=rng.sample(remain,2)
            g=list(group);g[i]=a;g[j]=b;out.append(g)
    # Algunos swaps triples: caros pero útiles cuando 11 requiere una composición muy distinta de la base 10.
    if len(group)>=3 and len(remain)>=3:
        for _ in range(4):
            ids=rng.sample(range(len(group)),3); news=rng.sample(remain,3)
            g=list(group)
            for pos,new in zip(ids,news): g[pos]=new
            out.append(g)
    return out


def _beam_groups(kits,target=11):
    pool=sorted(kits,key=lambda k:(float(k.get('priority') or 999999),-_metrics(k)[0]))[:POOL_SIZE]
    rng=random.Random(11711+target)
    beam=_seed_groups(pool,target,rng)
    seen={tuple(sorted(str(k.get('kitId') or '') for k in g)) for g in beam}
    for _ in range(GENERATIONS):
        candidates=list(beam)
        for g in beam:
            for m in _mutations(g,pool,rng):
                sig=tuple(sorted(str(k.get('kitId') or '') for k in m))
                if sig not in seen:seen.add(sig);candidates.append(m)
        candidates.sort(key=_group_score,reverse=True)
        beam=candidates[:BEAM_WIDTH]
    return sorted(beam,key=_group_score,reverse=True)


def _run_packingsolver(selected,gap_mm,seconds):
    if not PYCKING_AVAILABLE or InstanceBuilder is None or Solver is None:
        return None,'pyckingsolver no disponible'+(f': {PYCKING_IMPORT_ERROR}' if PYCKING_IMPORT_ERROR else '')
    try:
        builder=InstanceBuilder(Objective.OPEN_DIMENSION_X); builder.set_item_item_minimum_spacing(float(gap_mm))
        builder.add_bin_type_rectangle(PLATE_W,PLATE_H,copies=1,item_bin_minimum_spacing=0.0)
        part_map={}; item_type_id=0
        for kit in selected:
            for part in kit.get('parts') or []:
                returned=builder.add_item_type(part['geom'],copies=1,allowed_rotations=ANGLES)
                tid=item_type_id if returned is None else int(returned);part_map[tid]=part;item_type_id+=1
        solution=Solver().solve(builder.build(),time_limit=max(5,int(seconds)),verbosity_level=0,optimization_mode='Anytime',
            use_tree_search=True,use_sequential_single_knapsack=True,use_sequential_value_correction=True,
            use_column_generation=False,anchor=True,anchor_x_weight=1.0,anchor_y_weight=1.0)
        items=solution.all_items();expected=sum(len(k.get('parts') or []) for k in selected)
        if len(items)!=expected or solution.total_bins_used()!=1:return None,f'PackingSolver colocó {len(items)}/{expected} piezas'
        placements=[];xmax=0.0
        for item in items:
            part=part_map.get(int(item.item_type_id))
            if part is None:return None,'PackingSolver devolvió item desconocido'
            x=float(item.x);y=float(item.y);angle=float(item.angle)
            placements.append({'instanceId':part['instanceId'],'kitId':part['kitId'],'figure':part['figure'],'name':part['name'],'role':part['role'],
                'xCm':x/10.0,'yCm':y/10.0,'angle':angle,'trimXCm':part['trimXmm']/10.0,'trimYCm':part['trimYmm']/10.0,'partialExtra':False})
            try:xmax=max(xmax,float(item.shapes[0].bounds[2]))
            except Exception:pass
        density=100.0*sum(float(k.get('area') or 0) for k in selected)/(PLATE_W*PLATE_H)
        return {'ok':True,'fits':xmax<=PLATE_W+0.5,'placements':placements,'density':density,'stripWidthMm':xmax,
                'continuousRotation':False,'source':'packingsolver-deep-beam'},None
    except Exception as exc:return None,str(exc)[:220]


def _search_target(kits,validator,gap,target,started,diagnostics,deadline_seconds):
    groups=_beam_groups(kits,target)[:MAX_SOLVER_TRIALS]
    for idx,g in enumerate(groups):
        elapsed=time.time()-started
        remaining=deadline_seconds-elapsed
        if remaining<5:break
        trials_left=max(1,len(groups)-idx)
        # Darle más tiempo a cada grupo fuerte que en V3, sin dejar que uno solo monopolice el job.
        per=max(5,min(9,int(remaining/trials_left)+1))
        result,error=_run_packingsolver(g,gap,per)
        row={'target':target,'trial':idx+1,'score':_group_score(g),'figures':[str(k.get('figure') or '') for k in g],
             'ok':bool(result and result.get('ok')),'fits':bool(result and result.get('fits')),'error':error,'solverSeconds':per}
        if result and result.get('fits'):
            valid,certificate=validator(g,result);row['certified']=bool(valid);row['gapMm']=(certificate or {}).get('minimumGapMmCertified');diagnostics.append(row)
            if valid:return g,result,certificate
        else:diagnostics.append(row)
    return None


def hybrid_competition():
    # Sparrow produce primero una base 10 certificable y queda preservada como fallback.
    original=_base_nest();resp,status,payload=_unwrap(original)
    if status>=400 or not isinstance(payload,dict) or not payload.get('ok') or int(payload.get('completeFigures') or 0)<10:return original
    started=time.time();diagnostics=[]
    try:
        validator=getattr(ns,'_validate_final_geometry',None)
        if not callable(validator):return original
        data=request.get_json(silent=True) or {};gap=max(MIN_GAP,ns._n(data.get('gapCm'),.3)*10);kits=_prepare_all(data)

        # Fase principal: hasta ~88 s dedicados a demostrar que existe una placa de 11.
        best=_search_target(kits,validator,gap,11,started,diagnostics,88.0)
        if best:
            # Sólo si 11 ya está asegurada usamos el resto del presupuesto para intentar 12.
            maybe12=_search_target(kits,validator,gap,12,started,diagnostics,MAX_COMPETITOR_SECONDS)
            if maybe12:best=maybe12

        if not best:
            out=dict(payload);out.update({'hybridCompetition':True,'hybridWinner':'Sparrow','hybridRuntimeVersion':RUNTIME_VERSION,
                'hybridStatus':f'V3.1 profunda probó {len(diagnostics)} combinaciones 11+; fallback Sparrow 10','hybridDiagnostics':diagnostics,
                'selectionStrategy':f'HÍBRIDO V3.1 · búsqueda profunda 11+ · {len(diagnostics)} intentos · fallback Sparrow 10'})
            return jsonify(out)

        selected,result,certificate=best;target=len(selected);out=dict(payload)
        out.update({'engine':'Híbrido V3.1 deep beam + PackingSolver + Certificador V1.7','completeFigures':target,
            'placements':result.get('placements') or [],'density':float(result.get('density') or 0),'stripWidthMm':float(result.get('stripWidthMm') or 0),
            'selectionStrategy':f'HÍBRIDO V3.1 · GANÓ búsqueda profunda: {target} completas certificadas','targetDensityReached':float(result.get('density') or 0)>=80.0,
            'minimumGapMm':certificate.get('minimumGapMmCertified'),'requiredGapMm':MIN_GAP,'productionCertificate':certificate,
            'hybridCompetition':True,'hybridWinner':'PackingSolver-deep-beam','hybridRuntimeVersion':RUNTIME_VERSION,
            'hybridStatus':f'V3.1 encontró {target} completas tras búsqueda combinatoria profunda','hybridDiagnostics':diagnostics,
            'bestSolutionPreserved':True})
        return jsonify(out)
    except Exception as exc:
        out=dict(payload);out.update({'hybridCompetition':True,'hybridWinner':'Sparrow','hybridRuntimeVersion':RUNTIME_VERSION,
            'hybridStatus':'V3.1 falló; fallback Sparrow','hybridDiagnosticError':str(exc)[:220],
            'selectionStrategy':'HÍBRIDO V3.1 · ERROR · fallback Sparrow 10'})
        return jsonify(out)


if 'nest_sparrow' in ns.app.view_functions:ns.app.view_functions['nest_sparrow']=hybrid_competition
