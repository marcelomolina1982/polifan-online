from clean_lab_app import app
from clean_lab_v4 import solve_v4 as solve
from flask import jsonify, request
import json, threading, time, uuid

# Registra la ruta /upload-benchmark dentro de la misma app Flask.
import benchmark_routes  # noqa: F401

_jobs = {}
_lock = threading.Lock()


def _run_job(job_id, payload):
    started = time.time()
    try:
        with app.test_request_context('/solve-v4', method='POST', json=payload):
            response = solve()
            status = 200
            body = response
            if isinstance(response, tuple):
                body, status = response[0], int(response[1])
            data = body.get_json(silent=True) if hasattr(body, 'get_json') else body
            if not isinstance(data, dict):
                data = {'ok': False, 'error': 'Respuesta inválida del solver'}
            with _lock:
                _jobs[job_id] = {
                    'status': 'done' if data.get('ok') else 'error',
                    'result': data,
                    'httpStatus': status,
                    'elapsedSeconds': round(time.time() - started, 2),
                }
    except Exception as exc:
        with _lock:
            _jobs[job_id] = {
                'status': 'error',
                'result': {'ok': False, 'error': str(exc)},
                'elapsedSeconds': round(time.time() - started, 2),
            }


@app.post('/solve-start')
def solve_start():
    payload = request.get_json(silent=True) or {}
    job_id = uuid.uuid4().hex
    with _lock:
        _jobs[job_id] = {'status': 'running', 'startedAt': time.time()}
    threading.Thread(target=_run_job, args=(job_id, payload), daemon=True).start()
    return jsonify(ok=True, jobId=job_id, status='running')


@app.get('/solve-status')
def solve_status():
    job_id = str(request.args.get('id') or '').strip()
    if not job_id:
        return jsonify(ok=False, error='Falta id'), 400
    with _lock:
        job = dict(_jobs.get(job_id) or {})
    if not job:
        return jsonify(ok=False, error='Trabajo no encontrado'), 404
    if job.get('status') == 'running':
        elapsed = round(time.time() - float(job.get('startedAt') or time.time()), 2)
        return jsonify(ok=True, jobId=job_id, status='running', elapsedSeconds=elapsed)
    return jsonify(ok=True, jobId=job_id, **job)


@app.get('/async-health')
def async_health():
    return jsonify(ok=True, asyncSolve=True, solver='best-effort-v4-batch-fill', directSvgBenchmark=True, maxCandidatePool=120)


def _smoke_kits():
    shapes = [
        '0,0 180,0 180,55 95,55 95,150 0,150',
        '0,0 150,0 150,150 95,150 95,70 0,70',
        '0,0 170,0 170,60 110,60 110,125 55,125 55,60 0,60',
        '0,35 65,35 65,0 145,70 65,140 65,105 0,105',
        '0,0 140,0 140,45 80,45 80,120 0,120',
        '0,0 120,0 120,120 65,120 65,65 0,65',
        '0,0 155,0 155,50 100,50 100,145 45,145 45,50 0,50',
        '0,0 135,0 135,135 90,135 90,85 45,85 45,135 0,135',
        '0,0 110,0 110,85 60,85 60,150 0,150',
        '0,0 145,0 145,110 85,110 85,60 0,60',
    ]
    kits = []
    for i in range(24):
        pts = shapes[i % len(shapes)]
        svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="20cm" height="20cm" viewBox="0 0 200 200"><polygon points="{pts}" fill="none" stroke="black"/></svg>'
        kits.append({'kitId':f'smoke-{i+1}','figure':f'smoke-{i+1}','date':'2026-08-24' if i < 4 else '2026-08-25','priority':i+1,'parts':[{'instanceId':f'smoke-{i+1}','name':f'smoke-{i+1}','role':'simple','sourceWidthCm':20,'sourceHeightCm':20,'svgText':svg}]})
    return kits


def _startup_selftest():
    time.sleep(3)
    started = time.time()
    try:
        kits = _smoke_kits()
        payload = {'kits': kits, 'budgetSeconds': 120, 'urgentAnchorCount': 4}
        with app.test_request_context('/solve-v4', method='POST', json=payload):
            response = solve()
        status = 200
        body = response
        if isinstance(response, tuple):
            body, status = response[0], int(response[1])
        data = body.get_json(silent=True) if hasattr(body, 'get_json') else body
        summary = {
            'marker': 'POLIFAN_SELFTEST_RESULT',
            'httpStatus': status,
            'ok': bool(isinstance(data, dict) and data.get('ok')),
            'build': data.get('build') if isinstance(data, dict) else None,
            'candidatePool': data.get('candidatePool') if isinstance(data, dict) else None,
            'urgentAnchorsKept': data.get('urgentAnchorsKept') if isinstance(data, dict) else None,
            'completeFigures': data.get('completeFigures') if isinstance(data, dict) else None,
            'batchAccepts': data.get('batchAccepts') if isinstance(data, dict) else None,
            'batchAdded': data.get('batchAdded') if isinstance(data, dict) else None,
            'rescueRounds': data.get('rescueRounds') if isinstance(data, dict) else None,
            'geometricOccupancyPct': data.get('geometricOccupancyPct') if isinstance(data, dict) else None,
            'stripWidthMm': data.get('stripWidthMm') if isinstance(data, dict) else None,
            'placements': len(data.get('placements') or []) if isinstance(data, dict) else 0,
            'attemptCount': len(data.get('attempts') or []) if isinstance(data, dict) else 0,
            'error': data.get('error') if isinstance(data, dict) else 'invalid response',
            'elapsedSeconds': round(time.time() - started, 2),
        }
        print(json.dumps(summary, ensure_ascii=False), flush=True)
    except Exception as exc:
        print(json.dumps({'marker':'POLIFAN_SELFTEST_RESULT','ok':False,'error':str(exc),'elapsedSeconds':round(time.time()-started,2)}, ensure_ascii=False), flush=True)


threading.Thread(target=_startup_selftest, daemon=True).start()