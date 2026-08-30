from clean_lab_app import app
from sa_runtime_wrapper import solve_v4_sa as solve
from flask import jsonify, request
import base64, gzip, json, os, threading, time, uuid
from urllib import error as urlerror, request as urlrequest
import nest_sparrow as core

# Runtime productivo del motor 1230.
# No ejecuta benchmarks/self-tests al arrancar. Los jobs se guardan localmente
# y, si está configurado Supabase, también en almacenamiento durable.
core.SPARROW_BIN = os.path.abspath(os.environ.get('SPARROW_BIN', './sparrow'))

JOBS_DIR = os.environ.get('POLIFAN_JOBS_DIR', '/tmp/polifan-sparrow-jobs')
os.makedirs(JOBS_DIR, exist_ok=True)

SUPABASE_URL = str(os.environ.get('POLIFAN_SUPABASE_URL') or '').rstrip('/')
SUPABASE_KEY = str(os.environ.get('POLIFAN_SUPABASE_PUBLISHABLE_KEY') or '')
MOTOR_JOB_SECRET = str(os.environ.get('POLIFAN_MOTOR_JOB_SECRET') or '')
DURABLE_CONFIGURED = bool(SUPABASE_URL and SUPABASE_KEY and MOTOR_JOB_SECRET)

_jobs = {}
_running = set()
_lock = threading.Lock()

_ALLOWED_ORIGINS = {
    'https://polifan-app-v2.vercel.app',
}


@app.after_request
def _cors_motor_response(response):
    origin = str(request.headers.get('Origin') or '')
    if origin in _ALLOWED_ORIGINS or origin.endswith('.vercel.app'):
        response.headers['Access-Control-Allow-Origin'] = origin
        response.headers['Vary'] = 'Origin'
    response.headers['Access-Control-Allow-Methods'] = 'GET,POST,OPTIONS'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type,Authorization'
    response.headers['Cache-Control'] = 'no-store'
    return response


@app.route('/solve-start', methods=['OPTIONS'])
@app.route('/solve-status', methods=['OPTIONS'])
def _motor_options():
    return ('', 204)


def _job_path(job_id):
    safe = ''.join(c for c in str(job_id) if c.isalnum() or c in ('-', '_'))
    return os.path.join(JOBS_DIR, safe + '.json')


def _pack_job(data):
    raw = json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    packed = gzip.compress(raw, compresslevel=6)
    return {
        'encoding': 'gzip+base64',
        'blob': base64.b64encode(packed).decode('ascii'),
        'rawBytes': len(raw),
        'packedBytes': len(packed),
    }


def _unpack_job(value):
    if not isinstance(value, dict):
        return None
    if value.get('encoding') == 'gzip+base64' and value.get('blob'):
        try:
            raw = gzip.decompress(base64.b64decode(value['blob']))
            data = json.loads(raw.decode('utf-8'))
            return data if isinstance(data, dict) else None
        except Exception as exc:
            print('POLIFAN_DURABLE_DECODE_ERROR', type(exc).__name__, flush=True)
            return None
    return value if 'status' in value else None


def _durable_rpc(name, body, timeout=12):
    if not DURABLE_CONFIGURED:
        return None
    endpoint = f"{SUPABASE_URL}/rest/v1/rpc/{name}"
    payload = json.dumps(body, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    req = urlrequest.Request(
        endpoint,
        data=payload,
        method='POST',
        headers={
            'apikey': SUPABASE_KEY,
            'Authorization': 'Bearer ' + SUPABASE_KEY,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        },
    )
    try:
        with urlrequest.urlopen(req, timeout=timeout) as response:
            raw = response.read().decode('utf-8')
            return json.loads(raw) if raw else None
    except (urlerror.URLError, urlerror.HTTPError, TimeoutError, ValueError) as exc:
        print('POLIFAN_DURABLE_RPC_ERROR', name, type(exc).__name__, flush=True)
        return None


def _durable_put(job_id, data):
    if not DURABLE_CONFIGURED:
        return False
    packed = _pack_job(data)
    result = _durable_rpc('motor_job_put', {
        'p_secret': MOTOR_JOB_SECRET,
        'p_job_id': job_id,
        'p_data': packed,
    })
    return result is True


def _durable_get(job_id):
    if not DURABLE_CONFIGURED:
        return None
    value = _durable_rpc('motor_job_get', {
        'p_secret': MOTOR_JOB_SECRET,
        'p_job_id': job_id,
    })
    return _unpack_job(value)


def _write_local_job(job_id, payload):
    path = _job_path(job_id)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as fh:
        json.dump(payload, fh, ensure_ascii=False)
    os.replace(tmp, path)
    _jobs[job_id] = payload


def _write_job(job_id, data):
    payload = dict(data or {})
    payload['jobId'] = job_id
    _write_local_job(job_id, payload)
    if DURABLE_CONFIGURED and not _durable_put(job_id, payload):
        print('POLIFAN_DURABLE_WRITE_MISSED', job_id, flush=True)


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

    durable = _durable_get(job_id)
    if isinstance(durable, dict):
        try:
            _write_local_job(job_id, durable)
        except Exception:
            _jobs[job_id] = durable
        print('POLIFAN_JOB_DURABLE_RECOVERED', job_id, flush=True)
        return dict(durable)
    return None


def _public_job(job):
    if not isinstance(job, dict):
        return {}
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
        print('POLIFAN_JOB_RUN', job_id, 'recovered='+str(bool(recovered)), flush=True)
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
            print('POLIFAN_JOB_DONE', job_id, final['status'], final['elapsedSeconds'], flush=True)
    except Exception as exc:
        current = _read_job(job_id) or {'payload': payload, 'startedAt': started}
        current.update({
            'status': 'error',
            'result': {'ok': False, 'error': str(exc)},
            'finishedAt': time.time(),
            'elapsedSeconds': round(time.time() - started, 2),
        })
        _write_job(job_id, current)
        print('POLIFAN_JOB_ERROR', job_id, repr(exc), flush=True)
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
    print('POLIFAN_JOB_START', job_id, 'kits='+str(len(payload.get('kits') or [])), flush=True)
    return jsonify(
        ok=True,
        jobId=job_id,
        status='running',
        persistentJob=True,
        durableJob=DURABLE_CONFIGURED,
    )


@app.get('/solve-status')
def solve_status():
    job_id = str(request.args.get('id') or '').strip()
    if not job_id:
        return jsonify(ok=False, error='Falta id'), 400

    job = _read_job(job_id)
    if not job:
        print('POLIFAN_JOB_MISSING', job_id, flush=True)
        return jsonify(ok=False, error='Trabajo no encontrado', retryable=DURABLE_CONFIGURED), 404

    if job.get('status') == 'running':
        payload = job.get('payload') or {}
        recoveries = int(job.get('serverRecoveries') or 0)
        with _lock:
            alive_here = job_id in _running
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
        return jsonify(
            ok=True,
            **_public_job(job),
            status='running',
            elapsedSeconds=elapsed,
            persistentJob=True,
            durableJob=DURABLE_CONFIGURED,
        )

    return jsonify(ok=True, **_public_job(job), persistentJob=True, durableJob=DURABLE_CONFIGURED)


@app.get('/async-health')
def async_health():
    return jsonify(
        ok=True,
        asyncSolve=True,
        persistentJobs=True,
        durableJobs=DURABLE_CONFIGURED,
        durableStore='supabase' if DURABLE_CONFIGURED else 'local-only',
        directStatusCors=True,
        startupBenchmarks=False,
        solver='best-effort-v4-batch-fill',
        sparrowBinary=core.SPARROW_BIN,
        sparrowExecutable=os.path.isfile(core.SPARROW_BIN) and os.access(core.SPARROW_BIN, os.X_OK),
    )
