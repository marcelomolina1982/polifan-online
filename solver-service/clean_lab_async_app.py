from clean_lab_app import app, solve
from clean_lab_selftest import register_selftest
from flask import jsonify, request
import threading, time, uuid

_jobs = {}
_lock = threading.Lock()


def _run_job(job_id, payload):
    started = time.time()
    try:
        with app.test_request_context('/solve', method='POST', json=payload):
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
    return jsonify(ok=True, asyncSolve=True)


register_selftest(app, solve)
