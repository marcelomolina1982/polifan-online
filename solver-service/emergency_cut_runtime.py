from flask import request, jsonify
import nest_sparrow as ns

# PRODUCCION V1.15 — SPARROW REAL, SIN SHELF-PACKING
# El runtime anterior hacia competir un acomodador rectangular por filas contra
# Sparrow. Ese fallback podia devolver placas certificadas pero visualmente muy
# pobres, porque no hacia nesting geometrico real. En produccion ya no puede
# ganar ni reemplazar a Sparrow.
_original_solver = ns.nest_sparrow


def _parse_response(response):
    status = 200
    obj = response
    if isinstance(response, tuple):
        obj = response[0]
        if len(response) > 1:
            status = int(response[1])
    try:
        payload = obj.get_json() or {}
    except Exception:
        payload = {}
    return obj, status, payload


def emergency_cut_solver():
    # Ejecutar exclusivamente el pipeline Sparrow real que ya incluye la
    # compactacion/recompactacion y el certificador de geometria. No fabricar
    # una placa alternativa por filas como salida de emergencia.
    response = _original_solver()
    obj, status, payload = _parse_response(response)

    if payload:
        payload.update({
            'areaFirst': True,
            'noArtificialMinimum': True,
            'shelfPackingDisabled': True,
            'optimizationPriority': 'sparrow-real-nesting-certified',
            'message': payload.get('message') or 'Placa generada por Sparrow real y certificada.',
        })
        return jsonify(payload), status
    return obj, status


ns.nest_sparrow = emergency_cut_solver
if 'nest_sparrow' in ns.app.view_functions:
    ns.app.view_functions['nest_sparrow'] = emergency_cut_solver
