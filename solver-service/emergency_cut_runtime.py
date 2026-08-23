from flask import jsonify
import nest_sparrow as ns

# PRODUCCION V1.16 — SPARROW REAL, AREA-FIRST, SIN MINIMO ARTIFICIAL
# Se mantiene Sparrow/jagua-rs como unico nesting. Este adaptador elimina la
# compuerta historica de "10 completas o error" sin volver al shelf-packing.

_original_candidate_selections = ns._candidate_selections
_original_production_ready = ns._production_ready
_original_solver = ns.nest_sparrow

# Una solucion fisicamente valida puede tener 8, 9, 10... kits. La cantidad no
# decide validez: manda que Sparrow logre colocar todo dentro de 1220x580.
def _area_first_candidate_selections(kits, _requested_target):
    variants=[]
    seen=set()
    # Primero 10/9 por productividad; 8 y 7 son rescate valido cuando la mezcla
    # real de formas no permite mas. Cada cantidad conserva las estrategias de
    # seleccion existentes del motor.
    for target in (10, 9, 8, 7):
        if len(kits) < target:
            continue
        for label, rows in _original_candidate_selections(kits, target):
            sig=tuple(k.get('kitId') for k in rows)
            if sig in seen:
                continue
            seen.add(sig)
            variants.append((f'{target} kits · {label}', rows))
    return variants


def _area_first_production_ready(target, result):
    return bool(result.get('ok')) and bool(result.get('fits')) and target >= 1

# El score ya existente prioriza densidad real y luego cantidad/ancho. Al quitar
# la barrera de 10, compara solamente soluciones que Sparrow pudo encajar.
ns._candidate_selections = _area_first_candidate_selections
ns._production_ready = _area_first_production_ready
ns.MIN_COMPLETE = 1
ns.HIGH_DENSITY_COMPLETE = 0
ns.HIGH_DENSITY_MIN = 0.0


def emergency_cut_solver():
    response=_original_solver()
    status=200; obj=response
    if isinstance(response,tuple):
        obj=response[0]
        if len(response)>1: status=int(response[1])
    try: payload=obj.get_json() or {}
    except Exception: payload={}
    if payload:
        payload.update({
            'areaFirst':True,
            'noArtificialMinimum':True,
            'shelfPackingDisabled':True,
            'optimizationPriority':'sparrow-real-nesting-area-first',
            'motorPolicy':'mejor placa certificada; cantidad flexible',
        })
        if payload.get('ok'):
            payload['message']='Placa generada por Sparrow real; sin mínimo artificial de 10.'
        return jsonify(payload),status
    return obj,status

ns.nest_sparrow=emergency_cut_solver
if 'nest_sparrow' in ns.app.view_functions:
    ns.app.view_functions['nest_sparrow']=emergency_cut_solver
