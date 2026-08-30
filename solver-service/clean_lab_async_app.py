from clean_lab_app import app
from sa_runtime_wrapper import solve_v4_sa as solve
from flask import jsonify, request
import json, os, threading, time, uuid
import nest_sparrow as core

# Runtime productivo del motor 1230.
# Importante: este servicio NO ejecuta benchmarks/self-tests al arrancar. Esas pruebas
# consumían varios minutos de CPU en el mismo worker que atiende los cálculos reales.
core.SPARROW_BIN = os.path.abspath(os.environ.get('SPARROW_BIN', './sparrow'))

JOBS_DIR = os.environ.get('POLIFAN_JOBS_DIR', '/tmp/polifan-sparrow-jobs')
os.makedirs(JOBS_DIR, exist_ok=True)

_jobs = {}
_running = set()
_lock = threading.Lock()


def _job_path(job_id):
    safe = ''.join(c for c in str(job_id) if c.isalnum() or c in ('-', '_'))
    return os.path.join(JOBS_DIR, safe + '.json')


def _write_job(job_id, data):
    path = _job_path(job_id)
    tmp = path + '.tmp'
    payload = dict(data or {})
    payload['jobId'] = job_id
    with open(tmp, 'w', encoding='utf-8') as fh:
        json.dump(payload, fh, ensure_ascii=False)
    os.replace(tmp, path)
    _jobs[job_id] = payload


def _read_job(job_id):
    cached = _jobs.get(job_id)
    if cached:
        return dict(cached)
    path = _job_path(job_id)
    try:
        with open(path, 'r', encoding='utf-8') as fh:
            data = json.load(fh)
        if isinstance(data, dict):
            _jobs[job_id] = data
            return dict(data)
    except Exception:
        pass
    return None


def _public_job(job):
    if not isinstance(job, dict):
        return {}
    # Nunca devolver al navegador el payload completo con los SVG.
    return {k: v for k, v in job.items() if k != 'payload'}


def _run_job(job_id, payload, recovered=False):
    started = time.time()
    try:
        current = _read_job(job_id) or {}
        current.update({
            'status': 'running',
            'startedAt': current.get('startedAt') or started,
            'lastWorkerStartedAt': started,
            'serverRecoveries': int(current.get('serverRecoveries') or 0) + (1 if recovered else 0),
            'payload': payload,
        })
        _write_job(job_id, current)
        with app.test_request_context('/solve-v4', method='POST', json=payload):
            response = solve()
            status = 200
            body = response
            if isinstance(response, tuple):
                body, status = response[0], int(response[1])
            data = body.get_json(silent=True) if hasattr(body, 'get_json') else body
            if not isinstance(data, dict):
                data = {'ok': False, 'error': 'Respuesta inválida del solver'}
            final = {
                **current,
                'status': 'done' if data.get('ok') else 'error',
                'result': data,
                'httpStatus': status,
                'finishedAt': time.time(),
                'elapsedSeconds': round(time.time() - started, 2),
            }
            _write_job(job_id, final)
    except Exception as exc:
        current = _read_job(job_id) or {'payload': payload, 'startedAt': started}
        current.update({
            'status': 'error',
            'result': {'ok': False, 'error': str(exc)},
            'finishedAt': time.time(),
            'elapsedSeconds': round(time.time() - started, 2),
        })
        _write_job(job_id, current)
    finally:
        with _lock:
            _running.discard(job_id)


def _launch(job_id, payload, recovered=False):
    with _lock:
        if job_id in _running:
            return False
        _running.add(job_id)
    threading.Thread(target=_run_job, args=(job_id, payload, recovered), daemon=True).start()
    return True


@app.post('/solve-start')
def solve_start():
    payload = request.get_json(silent=True) or {}
    job_id = uuid.uuid4().hex
    initial = {
        'status': 'running',
        'startedAt': time.time(),
        'serverRecoveries': 0,
        'payload': payload,
    }
    _write_job(job_id, initial)
    _launch(job_id, payload, recovered=False)
    return jsonify(ok=True, jobId=job_id, status='running', persistentJob=True)


@app.get('/solve-status')
def solve_status():
    job_id = str(request.args.get('id') or '').strip()
    if not job_id:
        return jsonify(ok=False, error='Falta id'), 400

    job = _read_job(job_id)
    if not job:
        return jsonify(ok=False, error='Trabajo no encontrado', retryable=False), 404

    if job.get('status') == 'running':
        payload = job.get('payload') or {}
        recoveries = int(job.get('serverRecoveries') or 0)
        with _lock:
            alive_here = job_id in _running
        # Si el proceso de Render se reinició, el archivo del job permanece disponible
        # dentro de la instancia. Reanudamos el MISMO job en el servidor en lugar de
        # obligar al celular a crear IDs nuevos.
        if not alive_here and payload:
            if recoveries >= 4:
                job.update({
                    'status': 'error',
                    'result': {'ok': False, 'error': 'El worker de Render se reinició repetidamente durante este cálculo.'},
                })
                _write_job(job_id, job)
            else:
                _launch(job_id, payload, recovered=True)
                job = _read_job(job_id) or job
        elapsed = round(time.time() - float(job.get('startedAt') or time.time()), 2)
        return jsonify(ok=True, **_public_job(job), status='running', elapsedSeconds=elapsed, persistentJob=True)

    return jsonify(ok=True, **_public_job(job), persistentJob=True)


@app.get('/async-health')
def async_health():
    return jsonify(
        ok=True,
        asyncSolve=True,
        persistentJobs=True,
        startupBenchmarks=False,
        solver='best-effort-v4-batch-fill',
        sparrowBinary=core.SPARROW_BIN,
        sparrowExecutable=os.path.isfile(core.SPARROW_BIN) and os.access(core.SPARROW_BIN, os.X_OK),
    )
