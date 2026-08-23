import nest_sparrow as ns
from nest_sparrow import app
from flask import jsonify, request
from flask_cors import CORS
from revolutionary.ensemble_v10_9 import revolutionary_solve
from revolutionary.runtime_gate import solver_lane
# The ONLY auto benchmark. It has no imports that start legacy suites.
import revolutionary.benchmark_suite_v8 as replacement_exam

CORS(app, resources={r"/*": {"origins": "*"}}, allow_headers=["Content-Type"], methods=["GET", "POST", "OPTIONS"])

@app.get('/health')
def lab_render_health():
    return jsonify(ok=True,service='polifan-cnc-solver-test',mode='v10.9-true-clean-lowcpu',productionUntouched=True)

@app.get('/runtime-info')
def runtime_info():
    return jsonify(ok=True,build='motor-v10.9-true-clean-lowcpu',runtime='Sparrow single lane; few long runs; warm-start growth; no legacy auto suites',productionUntouched=True,revolutionaryEndpoint='/revolutionary/nest',replacementExam='/revolutionary/benchmark/replacement-exam',minGapMm=3.0,workers=1)

@app.get('/revolutionary/health')
def revolutionary_health():
    return jsonify(ok=True,engine='TVT Revolutionary V10.9 lowcpu-longrun-warmstart',mode='single-lane-free-tier',minGapMm=3.0,workers=1,productionUntouched=True)

@app.get('/revolutionary/benchmark/replacement-exam')
def revolutionary_replacement_exam():
    try:
        seconds=request.args.get('seconds')
        seconds_each=None if seconds is None else max(120.0,min(360.0,float(seconds)))
        result=replacement_exam.run_suite(seconds_each=seconds_each)
        return jsonify(result),(200 if result.get('ok') else 422)
    except Exception as exc:
        return jsonify(ok=False,error=repr(exc),productionUntouched=True),500

@app.post('/revolutionary/nest')
def revolutionary_nest():
    data=request.get_json(silent=True) or {}
    width=max(1.0,ns._n(data.get('widthCm'),122)*10)
    height=max(1.0,ns._n(data.get('heightCm'),58)*10)
    if abs(width-1220.0)>1 or abs(height-580.0)>1:
        return jsonify(ok=False,error='El laboratorio está fijado a placa 1220x580 mm'),400
    raw=sorted(data.get('kits') or [],key=lambda k:(ns._priority(k),str(k.get('date') or ''),str(k.get('figure') or '')))[:96]
    prepared=[];rejected=[]
    for kit in raw:
        try:
            p=ns._prep_kit(kit,width,height);p['date']=str(kit.get('date') or '');prepared.append(p)
        except Exception as exc:
            rejected.append({'kitId':str(kit.get('kitId') or ''),'figure':str(kit.get('figure') or ''),'reason':str(exc)})
    if not prepared:
        return jsonify(ok=False,error='No hay kits geométricos utilizables',rejected=rejected[:12]),422
    try:
        total_seconds=max(120.0,min(360.0,float(data.get('seconds') or 300.0)))
        # One global lane: requests wait rather than launching another Sparrow and
        # stealing CPU from the active plate/benchmark.
        with solver_lane():
            result=revolutionary_solve(prepared,total_seconds=total_seconds,max_workers=1)
        result['candidatePool']=len(prepared);result['rejected']=rejected[:12]
        result['productionUntouched']=True;result['runtimeWorkers']=1
        return jsonify(result),(200 if result.get('ok') else 422)
    except Exception as exc:
        return jsonify(ok=False,error=str(exc),engine='TVT Revolutionary V10.9 lowcpu-longrun-warmstart',productionUntouched=True),500
