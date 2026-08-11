from flask import request, jsonify
import time, math, random
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
PLATE_AREA = PLATE_W * PLATE_H
MIN_GAP = 3.0
TARGET_DENSITY = 80.0
MAX_COMPETITOR_SECONDS = 62.0
POOL_SIZE = 30
BEAM_WIDTH = 9
GENERATIONS = 4
MAX_SOLVER_TRIALS = 10
ANGLES = [(float(a), float(a)) for a in range(0, 360, 15)]
RUNTIME_VERSION = 'hybrid-3.0-geometry-beam'


def _unwrap(value):
    status = 200
    resp = value
    if isinstance(value, tuple):
        resp = value[0]
        if len(value) > 1 and isinstance(value[1], int):
            status = value[1]
    try: data = resp.get_json()
    except Exception: data = None
    try: status = int(getattr(resp, 'status_code', status) or status)
    except Exception: pass
    return resp, status, data


def _prepare_all(data):
    width = max(1.0, ns._n(data.get('widthCm'), 122) * 10)
    height = max(1.0, ns._n(data.get('heightCm'), 58) * 10)
    raw = sorted(data.get('kits') or [], key=lambda k:(ns._priority(k), str(k.get('date') or ''), str(k.get('figure') or '')))[:180]
    out=[]
    for row in raw:
        try: out.append(ns._prep_kit(row,width,height))
        except Exception: pass
    return out


def _kit_metrics(k):
    area=max(1.0,float(k.get('area') or 1.0))
    env=max(area,float(k.get('envelope') or area))
    solidity=max(.01,min(1.0,float(k.get('solidity') or area/env)))
    parts=k.get('parts') or []
    dims=[]
    for p in parts:
        g=p.get('geom')
        if g is None or g.is_empty: continue
        x0,y0,x1,y1=g.bounds
        dims.append((max(1.0,x1-x0),max(1.0,y1-y0)))
    aspect=[]
    for w,h in dims:
        aspect.append(max(w,h)/max(1.0,min(w,h)))
    return {
        'area':area,'env':env,'solidity':solidity,
        'compactness':area/env,
        'aspect':sum(aspect)/len(aspect) if aspect else 1.0,
        'priority':float(k.get('priority') or 999999),
    }


def _group_key(group):
    return tuple(sorted(str(k.get('kitId') or '') for k in group))


def _group_proxy(group):
    ms=[_kit_metrics(k) for k in group]
    area=sum(m['area'] for m in ms)
    density=100.0*area/PLATE_AREA
    compact=sum(m['compactness'] for m in ms)/len(ms)
    sol=sum(m['solidity'] for m in ms)/len(ms)
    aspects=[m['aspect'] for m in ms]
    aspect_spread=(max(aspects)-min(aspects)) if aspects else 0.0
    # Complementariedad: mezcla de piezas alargadas y compactas; evita grupos demasiado homogéneos.
    long_count=sum(1 for a in aspects if a>=1.8)
    square_count=sum(1 for a in aspects if a<=1.35)
    complement=min(long_count,square_count)/max(1.0,len(group)/2.0)
    priorities=sorted(m['priority'] for m in ms)
    urgent_penalty=sum(priorities[:min(5,len(priorities))])/max(1,min(5,len(priorities)))
    # Favorece área suficiente para 80%, pero no castiga fuerte si queda por debajo: 11 puede ser válida igual.
    density_goal=1.0-abs(TARGET_DENSITY-density)/max(TARGET_DENSITY,1.0)
    score=(density_goal*4.0)+(compact*2.2)+(sol*1.8)+(complement*1.4)+(min(1.5,aspect_spread/2.5)*.7)-(urgent_penalty*.00005)
    return score,density


def _seed_groups(kits,target):
    if len(kits)<target:return []
    pool=sorted(kits,key=lambda k:(float(k.get('priority') or 999999),-_kit_metrics(k)['compactness']))[:POOL_SIZE]
    compact=sorted(pool,key=lambda k:(-_kit_metrics(k)['compactness'],-_kit_metrics(k)['solidity'],float(k.get('priority') or 999999)))
    dense=sorted(pool,key=lambda k:(-float(k.get('area') or 0),-_kit_metrics(k)['compactness']))
    mixed=sorted(pool,key=lambda k:(-abs(_kit_metrics(k)['aspect']-1.6),-_kit_metrics(k)['compactness']))
    urgent=list(pool)
    groups=[];seen=set()
    def add(rows):
        g=list(rows[:target])
        if len(g)!=target:return
        key=_group_key(g)
        if key in seen:return
        seen.add(key);groups.append(g)
    for seq in (compact,dense,mixed,urgent):
        add(seq)
        add(seq[2:]+seq[:2])
    rng=random.Random(73031)
    top=pool[:min(len(pool),24)]
    for _ in range(8):
        if len(top)>=target:add(rng.sample(top,target))
    return groups


def _mutate_group(group,pool,target,rng):
    used={str(k.get('kitId') or '') for k in group}
    outsiders=[k for k in pool if str(k.get('kitId') or '') not in used]
    if not outsiders:return []
    children=[]
    ranked_out=sorted(outsiders,key=lambda k:(-_kit_metrics(k)['compactness'],-_kit_metrics(k)['solidity'],-float(k.get('area') or 0)))[:12]
    removable=sorted(range(len(group)),key=lambda i:(_kit_metrics(group[i])['compactness'],_kit_metrics(group[i])['solidity']))[:5]
    for i in removable:
        for new in ranked_out[:4]:
            child=list(group);child[i]=new
            if len(_group_key(child))==target:children.append(child)
    # Algunos swaps dobles permiten escapar de mínimos locales.
    if len(removable)>=2 and len(ranked_out)>=2:
        for _ in range(3):
            i,j=rng.sample(removable,2);a,b=rng.sample(ranked_out,2)
            child=list(group);child[i]=a;child[j]=b
            if len(_group_key(child))==target:children.append(child)
    return children


def _beam_groups(kits,target):
    seeds=_seed_groups(kits,target)
    if not seeds:return []
    pool=sorted(kits,key=lambda k:(float(k.get('priority') or 999999),-_kit_metrics(k)['compactness']))[:POOL_SIZE]
    seen=set();beam=[]
    for g in seeds:
        key=_group_key(g)
        if key not in seen:
            seen.add(key);beam.append(g)
    beam=sorted(beam,key=lambda g:_group_proxy(g)[0],reverse=True)[:BEAM_WIDTH]
    rng=random.Random(9137+target)
    all_ranked=list(beam)
    for _ in range(GENERATIONS):
        children=[]
        for g in beam:
            for c in _mutate_group(g,pool,target,rng):
                key=_group_key(c)
                if key in seen:continue
                seen.add(key);children.append(c)
        if not children:break
        beam=sorted(children,key=lambda g:_group_proxy(g)[0],reverse=True)[:BEAM_WIDTH]
        all_ranked.extend(beam)
    # Diversidad: no sólo top proxy, también grupos con densidades diferentes.
    ranked=sorted(all_ranked,key=lambda g:_group_proxy(g)[0],reverse=True)
    out=[];used=set();buckets=set()
    for g in ranked:
        key=_group_key(g);density=_group_proxy(g)[1];bucket=int(density//4)
        if key in used:continue
        if len(out)<6 or bucket not in buckets:
            out.append(g);used.add(key);buckets.add(bucket)
        if len(out)>=MAX_SOLVER_TRIALS:break
    return out


def _run_packingsolver(selected,gap_mm,seconds):
    if not PYCKING_AVAILABLE or InstanceBuilder is None or Solver is None:
        return None,'pyckingsolver no disponible'+(f': {PYCKING_IMPORT_ERROR}' if PYCKING_IMPORT_ERROR else '')
    try:
        builder=InstanceBuilder(Objective.OPEN_DIMENSION_X)
        builder.set_item_item_minimum_spacing(float(gap_mm))
        builder.add_bin_type_rectangle(PLATE_W,PLATE_H,copies=1,item_bin_minimum_spacing=0.0)
        part_map={};item_type_id=0
        for kit in selected:
            for part in kit.get('parts') or []:
                returned=builder.add_item_type(part['geom'],copies=1,allowed_rotations=ANGLES)
                type_id=item_type_id if returned is None else int(returned)
                part_map[type_id]=part;item_type_id+=1
        solution=Solver().solve(builder.build(),time_limit=max(4,int(seconds)),verbosity_level=0,
            optimization_mode='Anytime',use_tree_search=True,use_sequential_single_knapsack=True,
            use_sequential_value_correction=True,use_column_generation=False,anchor=True,
            anchor_x_weight=1.0,anchor_y_weight=1.0)
        items=solution.all_items();expected=sum(len(k.get('parts') or []) for k in selected)
        if len(items)!=expected or solution.total_bins_used()!=1:
            return None,f'PackingSolver colocó {len(items)}/{expected} piezas'
        placements=[];xmax=0.0
        for item in items:
            part=part_map.get(int(item.item_type_id))
            if part is None:return None,'PackingSolver devolvió item desconocido'
            x=float(item.x);y=float(item.y);angle=float(item.angle)
            placements.append({'instanceId':part['instanceId'],'kitId':part['kitId'],'figure':part['figure'],'name':part['name'],
                'role':part['role'],'xCm':x/10.0,'yCm':y/10.0,'angle':angle,'trimXCm':part['trimXmm']/10.0,
                'trimYCm':part['trimYmm']/10.0,'partialExtra':False})
            try:xmax=max(xmax,float(item.shapes[0].bounds[2]))
            except Exception:pass
        density=100.0*sum(float(k.get('area') or 0) for k in selected)/PLATE_AREA
        return {'ok':True,'fits':xmax<=PLATE_W+0.5,'placements':placements,'density':density,'stripWidthMm':xmax,
                'continuousRotation':False,'source':'packingsolver-geometry-beam'},None
    except Exception as exc:return None,str(exc)[:220]


def _search_target(kits,validator,gap,target,started,diagnostics):
    groups=_beam_groups(kits,target)
    for idx,group in enumerate(groups):
        remaining=MAX_COMPETITOR_SECONDS-(time.time()-started)
        if remaining<5:break
        remaining_groups=max(1,min(len(groups)-idx,MAX_SOLVER_TRIALS-idx))
        per=max(4,min(8,int(remaining/remaining_groups)))
        proxy,density=_group_proxy(group)
        result,error=_run_packingsolver(group,gap,per)
        row={'target':target,'trial':idx+1,'proxy':round(proxy,3),'densityCandidate':round(density,1),
             'figures':[str(k.get('figure') or '') for k in group],'ok':bool(result and result.get('ok')),
             'fits':bool(result and result.get('fits')),'error':error}
        if result and result.get('fits'):
            valid,certificate=validator(group,result);row['certified']=bool(valid);row['gapMm']=(certificate or {}).get('minimumGapMmCertified')
            diagnostics.append(row)
            if valid:return group,result,certificate
        else:diagnostics.append(row)
    return None


def hybrid_competition():
    original=_base_nest();resp,status,payload=_unwrap(original)
    if status>=400 or not isinstance(payload,dict) or not payload.get('ok'):return original
    if int(payload.get('completeFigures') or 0)<10:return original
    started=time.time();diagnostics=[]
    try:
        validator=getattr(ns,'_validate_final_geometry',None)
        if not callable(validator):return original
        data=request.get_json(silent=True) or {};gap=max(MIN_GAP,ns._n(data.get('gapCm'),.3)*10);kits=_prepare_all(data)
        best=_search_target(kits,validator,gap,11,started,diagnostics)
        if best:
            best12=_search_target(kits,validator,gap,12,started,diagnostics)
            if best12:best=best12
        if not best:
            out=dict(payload);tried=len(diagnostics);first=next((str(d.get('error')) for d in diagnostics if d.get('error')),'')
            suffix=f'V3 BEAM: {tried} combinaciones 11 probadas, ninguna certificó; fallback Sparrow 10'
            if first:suffix+=f' · {first[:70]}'
            out.update({'hybridCompetition':True,'hybridWinner':'Sparrow','hybridRuntimeVersion':RUNTIME_VERSION,
                'hybridStatus':suffix,'hybridDiagnostics':diagnostics,'selectionStrategy':'HÍBRIDO V3 · '+suffix})
            return jsonify(out)
        selected,result,certificate=best;target=len(selected)
        out=dict(payload)
        out.update({'engine':'Híbrido V3 beam geométrico + PackingSolver + Certificador V1.7','completeFigures':target,
            'placements':result.get('placements') or [],'density':float(result.get('density') or 0),'stripWidthMm':float(result.get('stripWidthMm') or 0),
            'selectionStrategy':f'HÍBRIDO V3 · GANÓ beam geométrico: {target} completas certificadas',
            'targetDensityReached':float(result.get('density') or 0)>=80.0,'minimumGapMm':certificate.get('minimumGapMmCertified'),
            'requiredGapMm':MIN_GAP,'productionCertificate':certificate,'hybridCompetition':True,'hybridWinner':'PackingSolver-beam',
            'hybridRuntimeVersion':RUNTIME_VERSION,'hybridStatus':f'Beam geométrico encontró {target} completas sin quedar atado a la base Sparrow',
            'hybridDiagnostics':diagnostics,'bestSolutionPreserved':True})
        return jsonify(out)
    except Exception as exc:
        out=dict(payload);out.update({'hybridCompetition':True,'hybridWinner':'Sparrow','hybridRuntimeVersion':RUNTIME_VERSION,
            'hybridStatus':'V3 falló; fallback Sparrow','hybridDiagnosticError':str(exc)[:220],
            'selectionStrategy':'HÍBRIDO V3 · ERROR · fallback Sparrow 10'})
        return jsonify(out)


if 'nest_sparrow' in ns.app.view_functions:
    ns.app.view_functions['nest_sparrow']=hybrid_competition
