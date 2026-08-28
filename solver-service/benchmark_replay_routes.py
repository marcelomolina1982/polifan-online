from flask import jsonify, request
from clean_lab_app import app, core, PLATE_WIDTH_MM, PLATE_HEIGHT_MM, GAP_MM
from clean_lab_v4 import solve_v4
from benchmark_routes import _validate_layout
import time


def _payload_from_capture(data):
    if not isinstance(data, dict):
        return {}
    payload = data.get('payload') if isinstance(data.get('payload'), dict) else data
    payload = dict(payload or {})
    payload['widthCm'] = PLATE_WIDTH_MM / 10.0
    payload['heightCm'] = PLATE_HEIGHT_MM / 10.0
    if not payload.get('gapCm'):
        payload['gapCm'] = GAP_MM / 10.0
    return payload


def _prepare_kits(payload):
    prepared=[]; rejected=[]
    raw=payload.get('kits') or []
    for kit in raw:
        try:
            prepared.append(core._prep_kit(kit,PLATE_WIDTH_MM,PLATE_HEIGHT_MM))
        except Exception as exc:
            rejected.append({'kitId':str(kit.get('kitId') or ''),'figure':str(kit.get('figure') or ''),'reason':str(exc)})
    return prepared,rejected


@app.route('/replay-benchmark',methods=['GET','POST'])
def replay_benchmark():
    if request.method=='GET':
        return jsonify(ok=True,route='/replay-benchmark',method='POST',schema='polifan-nesting-benchmark-v1',workspaceMm=[PLATE_WIDTH_MM,PLATE_HEIGHT_MM],gapMm=GAP_MM,description='Reproduce el payload JSON exacto capturado por MotorDefinitivo y certifica la geometría resultante.')

    capture=request.get_json(silent=True) or {}
    payload=_payload_from_capture(capture)
    if not payload.get('kits'):
        return jsonify(ok=False,error='El benchmark no contiene kits'),422

    prepared,rejected=_prepare_kits(payload)
    if not prepared:
        return jsonify(ok=False,error='Ningún kit pudo convertirse a geometría',rejected=rejected[:20]),422

    started=time.time()
    with app.test_request_context('/solve-v4',method='POST',json=payload):
        response=solve_v4()
    status=200;body=response
    if isinstance(response,tuple):
        body,status=response[0],int(response[1])
    result=body.get_json(silent=True) if hasattr(body,'get_json') else body
    if not isinstance(result,dict):
        return jsonify(ok=False,error='Respuesta inválida de V4'),500
    if not result.get('ok'):
        return jsonify(ok=False,solverResult=result,rejected=rejected[:20],elapsedSeconds=round(time.time()-started,2)),status

    placements=result.get('placements') or []
    validation,_rows=_validate_layout(prepared,placements)
    selected_ids={str(p.get('kitId') or '') for p in placements if p.get('kitId') and not p.get('partialExtra')}
    complete=int(result.get('completeFigures') or len(selected_ids))

    return jsonify(
        ok=bool(validation.get('ok')),
        benchmarkSchema=str(capture.get('schema') or 'raw-payload'),
        engine=result.get('engine'),
        build=result.get('build'),
        workspaceMm=[PLATE_WIDTH_MM,PLATE_HEIGHT_MM],
        requestedGapMm=float(payload.get('gapCm') or 0)*10.0,
        inputKitCount=len(payload.get('kits') or []),
        preparedKitCount=len(prepared),
        rejected=rejected[:20],
        completeFigures=complete,
        placements=placements,
        geometricOccupancyPct=result.get('geometricOccupancyPct'),
        stripWidthMm=result.get('stripWidthMm'),
        solverElapsedSeconds=result.get('elapsedSeconds'),
        replayElapsedSeconds=round(time.time()-started,2),
        attempts=result.get('attempts') or [],
        layoutValidation=validation,
        solverResult=result,
    ), (200 if validation.get('ok') else 422)


# Importado al final para registrar la búsqueda profunda sin crear un ciclo durante
# la inicialización de Flask. Sólo existe en la rama aislada del motor.
import benchmark_deep_routes  # noqa: E402,F401
