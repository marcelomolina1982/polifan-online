import threading, time, uuid, traceback
from flask import request, jsonify
from nest_sparrow import app

_jobs = {}
_lock = threading.RLock()
_active_job_id = None
MAX_ACTIVE_SECONDS = 120


def _active_solver_view():
    view = app.view_functions.get('nest_sparrow')
    if view is None:
        raise RuntimeError('No hay solver nest_sparrow registrado')
    return view


def _solver_identity(view=None):
    view = view or _active_solver_view()
    return {
        'module': str(getattr(view, '__module__', '') or ''),
        'name': str(getattr(view, '__name__', '') or ''),
        'qualname': str(getattr(view, '__qualname__', '') or ''),
    }


def _response_payload(value):
    status = 200
    resp = value
    if isinstance(value, tuple):
        resp = value[0]
        if len(value) > 1 and isinstance(value[1], int):
            status = value[1]
    try:
        payload = resp.get_json()
    except Exception:
        payload = None
    try:
        status = int(getattr(resp, 'status_code', status) or status)
    except Exception:
        pass
    return status, payload


def _expire_stuck_active_locked():
    global _active_job_id
    if not _active_job_id:
        return False
    job = _jobs.get(_active_job_id)
    if not job:
        _active_job_id = None
        return True
    if job.get('status') not in ('queued', 'running'):
        _active_job_id = None
        return True
    now = time.time()
    started = job.get('startedAt') or job.get('createdAt') or now
    if now - started <= MAX_ACTIVE_SECONDS:
        return False
    job.update(
        status='error',
        stage='Tiempo máximo agotado',
        finishedAt=now,
        httpStatus=504,
        result={
            'ok': False,
            'error': f'El cálculo superó {MAX_ACTIVE_SECONDS}s y fue liberado para permitir una nueva placa.',
            'timeout': True,
        },
    )
    _active_job_id = None
    return True


def _run(job_id, payload):
    global _active_job_id
    solver_view = _active_solver_view()
    runtime_solver = _solver_identity(solver_view)
    with _lock:
        job = _jobs[job_id]
        job.update(status='running', stage='Sparrow V1.8 calculando placa base + crecimiento', startedAt=time.time(), runtimeSolver=runtime_solver)
    try:
        with app.test_request_context('/nest-sparrow', method='POST', json=payload):
            solver_view = _active_solver_view()
            runtime_solver = _solver_identity(solver_view)
            value = solver_view()
            http_status, result = _response_payload(value)
        with _lock:
            job = _jobs.get(job_id)
            if not job or job.get('status') == 'error' and job.get('result', {}).get('timeout'):
                return
            if isinstance(result, dict):
                result.setdefault('runtimeSolver', runtime_solver)
                result.setdefault('asyncRuntimeVersion', 'v25.0.20-dynamic-solver')
            job['runtimeSolver'] = runtime_solver
            job['httpStatus'] = http_status
            job['result'] = result if isinstance(result, dict) else {'ok': False, 'error': 'Respuesta inválida del solver'}
            job['status'] = 'done' if http_status < 400 and job['result'].get('ok') else 'error'
            job['stage'] = 'Finalizado' if job['status'] == 'done' else 'El solver terminó sin placa válida'
            job['finishedAt'] = time.time()
    except Exception as exc:
        with _lock:
            job = _jobs.get(job_id)
            if job:
                job.update(status='error', stage='Error interno', finishedAt=time.time(), httpStatus=500,
                           result={'ok': False, 'error': str(exc), 'trace': traceback.format_exc()[-1800:], 'runtimeSolver': runtime_solver})
    finally:
        with _lock:
            if _active_job_id == job_id:
                _active_job_id = None


def _clean_old_jobs():
    cutoff = time.time() - 3600
    dead = [jid for jid, j in _jobs.items() if j.get('finishedAt', j.get('createdAt', 0)) < cutoff and j.get('status') in ('done', 'error')]
    for jid in dead:
        _jobs.pop(jid, None)


@app.post('/nest-jobs')
def start_nest_job():
    global _active_job_id
    payload = request.get_json(silent=True) or {}
    with _lock:
        _clean_old_jobs()
        _expire_stuck_active_locked()
        if _active_job_id:
            running = _jobs.get(_active_job_id)
            if running and running.get('status') in ('queued', 'running'):
                return jsonify(ok=True, accepted=False, busy=True, jobId=_active_job_id,
                               status=running.get('status'), stage=running.get('stage'),
                               runtimeSolver=running.get('runtimeSolver'),
                               message='Ya hay una placa calculándose. Se continúa ese trabajo; no se inicia otro.'), 202
            _active_job_id = None
        job_id = uuid.uuid4().hex
        _jobs[job_id] = {
            'jobId': job_id, 'status': 'queued', 'stage': 'En cola',
            'createdAt': time.time(), 'result': None, 'httpStatus': None,
            'runtimeSolver': _solver_identity(),
        }
        _active_job_id = job_id
        thread = threading.Thread(target=_run, args=(job_id, payload), daemon=True, name=f'sparrow-{job_id[:8]}')
        thread.start()
        return jsonify(ok=True, accepted=True, busy=False, jobId=job_id, status='queued', stage='En cola', runtimeSolver=_jobs[job_id]['runtimeSolver']), 202


@app.get('/nest-jobs/<job_id>')
def get_nest_job(job_id):
    with _lock:
        _expire_stuck_active_locked()
        job = _jobs.get(job_id)
        if not job:
            return jsonify(ok=False, error='Trabajo no encontrado o Render se reinició.'), 404
        now = time.time()
        started = job.get('startedAt') or job.get('createdAt') or now
        out = dict(job)
        out['elapsedSeconds'] = round(max(0, (job.get('finishedAt') or now) - started), 1)
        return jsonify(ok=True, **out)


@app.get('/nest-jobs-active')
def get_active_nest_job():
    with _lock:
        _expire_stuck_active_locked()
        if not _active_job_id or _active_job_id not in _jobs:
            return jsonify(ok=True, active=False, runtimeSolver=_solver_identity(), maxActiveSeconds=MAX_ACTIVE_SECONDS)
        job = _jobs[_active_job_id]
        return jsonify(ok=True, active=True, jobId=_active_job_id, status=job.get('status'), stage=job.get('stage'), runtimeSolver=job.get('runtimeSolver'), maxActiveSeconds=MAX_ACTIVE_SECONDS)


@app.post('/nest-jobs-reset')
def reset_active_nest_job():
    global _active_job_id
    with _lock:
        old_id = _active_job_id
        if old_id and old_id in _jobs:
            job = _jobs[old_id]
            job.update(status='error', stage='Cancelado manualmente', finishedAt=time.time(), httpStatus=499,
                       result={'ok': False, 'error': 'Trabajo cancelado manualmente.', 'cancelled': True})
        _active_job_id = None
    return jsonify(ok=True, reset=True, previousJobId=old_id)


@app.get('/engine-info')
def engine_info():
    return jsonify(ok=True, asyncRuntimeVersion='v25.0.20-dynamic-solver-timeout120', runtimeSolver=_solver_identity(), maxActiveSeconds=MAX_ACTIVE_SECONDS)
