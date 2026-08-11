from flask import request, jsonify
import time
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
MAX_COMPETITOR_SECONDS = 48.0
POOL_SIZE = 24
MAX_GROUPS = 8
ANGLES = [(float(a), float(a)) for a in range(0, 360, 15)]
RUNTIME_VERSION = 'hybrid-2.0-direct-11'


def _unwrap(value):
    status = 200
    resp = value
    if isinstance(value, tuple):
        resp = value[0]
        if len(value) > 1 and isinstance(value[1], int): status = value[1]
    try: data = resp.get_json()
    except Exception: data = None
    try: status = int(getattr(resp, 'status_code', status) or status)
    except Exception: pass
    return resp, status, data


def _prepare_all(data):
    width = max(1.0, ns._n(data.get('widthCm'), 122) * 10)
    height = max(1.0, ns._n(data.get('heightCm'), 58) * 10)
    raw = sorted(data.get('kits') or [], key=lambda k: (ns._priority(k), str(k.get('date') or ''), str(k.get('figure') or '')))[:180]
    out = []
    for row in raw:
        try: out.append(ns._prep_kit(row, width, height))
        except Exception: pass
    return out


def _score(k):
    area = max(1.0, float(k.get('area') or 1))
    env = max(area, float(k.get('envelope') or area))
    solidity = float(k.get('solidity') or 0)
    priority = float(k.get('priority') or 999999)
    return (env / area, -solidity, priority, -area)


def _groups_for_target(kits, target=11):
    if len(kits) < target: return []
    urgent = sorted(kits, key=lambda k: (float(k.get('priority') or 999999), str(k.get('date') or ''), _score(k)))[:POOL_SIZE]
    compact = sorted(urgent, key=_score)
    area_small = sorted(urgent, key=lambda k: float(k.get('area') or 0))
    solid = sorted(urgent, key=lambda k: -float(k.get('solidity') or 0))
    seeds = [compact, urgent, area_small, solid]
    groups, seen = [], set()
    for offset in range(2):
        for seq in seeds:
            if len(groups) >= MAX_GROUPS: break
            rotated = seq[offset:] + seq[:offset]
            group = rotated[:target]
            ids = tuple(sorted(str(k.get('kitId') or '') for k in group))
            if len(group) == target and ids not in seen:
                seen.add(ids); groups.append(group)
    return groups


def _run_packingsolver(selected, gap_mm, seconds):
    if not PYCKING_AVAILABLE or InstanceBuilder is None or Solver is None:
        return None, 'pyckingsolver no disponible' + (f': {PYCKING_IMPORT_ERROR}' if PYCKING_IMPORT_ERROR else '')
    try:
        builder = InstanceBuilder(Objective.OPEN_DIMENSION_X)
        builder.set_item_item_minimum_spacing(float(gap_mm))
        builder.add_bin_type_rectangle(PLATE_W, PLATE_H, copies=1, item_bin_minimum_spacing=0.0)
        part_map = {}; item_type_id = 0
        for kit in selected:
            for part in kit.get('parts') or []:
                returned = builder.add_item_type(part['geom'], copies=1, allowed_rotations=ANGLES)
                type_id = item_type_id if returned is None else int(returned)
                part_map[type_id] = part; item_type_id += 1
        solution = Solver().solve(builder.build(), time_limit=max(4, int(seconds)), verbosity_level=0,
            optimization_mode='Anytime', use_tree_search=True, use_sequential_single_knapsack=True,
            use_sequential_value_correction=True, use_column_generation=False, anchor=True,
            anchor_x_weight=1.0, anchor_y_weight=1.0)
        items = solution.all_items(); expected = sum(len(k.get('parts') or []) for k in selected)
        if len(items) != expected or solution.total_bins_used() != 1:
            return None, f'PackingSolver colocó {len(items)}/{expected} piezas'
        placements = []; xmax = 0.0
        for item in items:
            part = part_map.get(int(item.item_type_id))
            if part is None: return None, 'PackingSolver devolvió item desconocido'
            x=float(item.x); y=float(item.y); angle=float(item.angle)
            placements.append({'instanceId':part['instanceId'],'kitId':part['kitId'],'figure':part['figure'],'name':part['name'],
                'role':part['role'],'xCm':x/10.0,'yCm':y/10.0,'angle':angle,'trimXCm':part['trimXmm']/10.0,
                'trimYCm':part['trimYmm']/10.0,'partialExtra':False})
            try: xmax=max(xmax,float(item.shapes[0].bounds[2]))
            except Exception: pass
        density=100.0*sum(float(k.get('area') or 0) for k in selected)/(PLATE_W*PLATE_H)
        return {'ok':True,'fits':xmax<=PLATE_W+0.5,'placements':placements,'density':density,'stripWidthMm':xmax,
                'continuousRotation':False,'source':'packingsolver-direct-target'}, None
    except Exception as exc: return None, str(exc)[:220]


def _direct_search(kits, validator, gap, target, started, diagnostics):
    groups = _groups_for_target(kits, target)
    for idx, group in enumerate(groups):
        remaining = MAX_COMPETITOR_SECONDS-(time.time()-started)
        if remaining < 5: break
        per=max(4,min(7,int(remaining/max(1,len(groups)-idx))))
        result,error=_run_packingsolver(group,gap,per)
        row={'target':target,'group':idx+1,'figures':[str(k.get('figure') or '') for k in group],
             'ok':bool(result and result.get('ok')),'fits':bool(result and result.get('fits')),'error':error}
        if result and result.get('fits'):
            valid,certificate=validator(group,result); row['certified']=bool(valid); row['gapMm']=(certificate or {}).get('minimumGapMmCertified')
            diagnostics.append(row)
            if valid: return group,result,certificate
        else: diagnostics.append(row)
    return None


def hybrid_competition():
    # Sparrow se calcula primero como red de seguridad; el competidor ya NO queda atado a sus 10 elegidas.
    original=_base_nest(); resp,status,payload=_unwrap(original)
    if status>=400 or not isinstance(payload,dict) or not payload.get('ok'): return original
    if int(payload.get('completeFigures') or 0)<10: return original
    started=time.time(); diagnostics=[]
    try:
        validator=getattr(ns,'_validate_final_geometry',None)
        if not callable(validator): return original
        data=request.get_json(silent=True) or {}; gap=max(MIN_GAP,ns._n(data.get('gapCm'),.3)*10); kits=_prepare_all(data)
        best=_direct_search(kits,validator,gap,11,started,diagnostics)
        if best:
            # Si 11 existe, usamos el tiempo restante para intentar 12 directamente.
            best12=_direct_search(kits,validator,gap,12,started,diagnostics)
            if best12: best=best12
        if not best:
            out=dict(payload); tried=len(diagnostics); first=next((str(d.get('error')) for d in diagnostics if d.get('error')),'')
            suffix=f'DIRECTO 11: {tried} grupos probados, no certificó; fallback Sparrow 10'
            if first: suffix+=f' · {first[:80]}'
            out.update({'hybridCompetition':True,'hybridWinner':'Sparrow','hybridRuntimeVersion':RUNTIME_VERSION,
                        'hybridStatus':suffix,'hybridDiagnostics':diagnostics,
                        'selectionStrategy':'HÍBRIDO V2 · '+suffix})
            return jsonify(out)
        selected,result,certificate=best; target=len(selected)
        out=dict(payload)
        out.update({'engine':'Híbrido V2 búsqueda directa + PackingSolver + Certificador V1.7','completeFigures':target,
            'placements':result.get('placements') or [],'density':float(result.get('density') or 0),'stripWidthMm':float(result.get('stripWidthMm') or 0),
            'selectionStrategy':f'HÍBRIDO V2 · GANÓ búsqueda directa: {target} completas certificadas',
            'targetDensityReached':float(result.get('density') or 0)>=80.0,'minimumGapMm':certificate.get('minimumGapMmCertified'),
            'requiredGapMm':MIN_GAP,'productionCertificate':certificate,'hybridCompetition':True,'hybridWinner':'PackingSolver-direct',
            'hybridRuntimeVersion':RUNTIME_VERSION,'hybridStatus':f'Búsqueda directa encontró {target} completas sin conservar la base Sparrow',
            'hybridDiagnostics':diagnostics,'bestSolutionPreserved':True})
        return jsonify(out)
    except Exception as exc:
        out=dict(payload); out.update({'hybridCompetition':True,'hybridWinner':'Sparrow','hybridRuntimeVersion':RUNTIME_VERSION,
            'hybridStatus':'Directo falló; fallback Sparrow','hybridDiagnosticError':str(exc)[:220],
            'selectionStrategy':'HÍBRIDO V2 · ERROR directo · fallback Sparrow 10'})
        return jsonify(out)


if 'nest_sparrow' in ns.app.view_functions:
    ns.app.view_functions['nest_sparrow']=hybrid_competition
