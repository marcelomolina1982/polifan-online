import nest_sparrow as ns
from nest_sparrow import app
import sparrow_v18_runtime  # geometría base
import production_safety_runtime
import base_only_runtime
import adaptive_base_runtime
import intelligent_selector_runtime
import hybrid_strategy_runtime
import final_runtime_v20

import async_jobs
import json, threading, time
from flask import jsonify, request
from flask_cors import CORS
from revolutionary.ensemble_v1 import revolutionary_solve
from revolutionary.realcase_plate06_exact import run_plate06_mama

CORS(app, resources={r"/*": {"origins": "*"}}, allow_headers=["Content-Type"], methods=["GET", "POST", "OPTIONS"])


@app.get('/health')
def lab_render_health():
    return jsonify(ok=True,service='polifan-cnc-solver-test',mode='revolutionary-lab')


@app.get('/runtime-info')
def runtime_info():
    view=app.view_functions.get('nest_sparrow')
    return jsonify(
        ok=True,
        build='motor-revolucionario-lab-v2.3-exact-svg',
        runtime='sparrow+jagua ensemble lab',
        solverFunction=getattr(view,'__name__','-'),
        productionUntouched=True,
        revolutionaryEndpoint='/revolutionary/nest',
        selftestEndpoint='/revolutionary/selftest',
        realCaseEndpoint='/revolutionary/realcase/plate06-mama',
        targetDensity=70,
        minGapMm=3.0,
        edgeMarginMm=3.0,
    )


@app.get('/revolutionary/health')
def revolutionary_health():
    return jsonify(
        ok=True,
        engine='TVT Revolutionary Ensemble V2.3',
        mode='isolated-lab',
        minGapMm=3.0,
        completeCountFirst=True,
        ensemble=True,
        racingSelector=True,
        realHistoricalGate=True,
        exactSvgSnapshot=True,
        productionUntouched=True,
    )


def _selftest_part(kit_id, idx, width_mm, height_mm, kind='rect'):
    if kind == 'l':
        d=f'M 0 0 H {width_mm} V {height_mm*0.38:.3f} H {width_mm*0.46:.3f} V {height_mm} H 0 Z'
    elif kind == 'trap':
        d=f'M {width_mm*0.12:.3f} 0 H {width_mm*0.88:.3f} L {width_mm} {height_mm} H 0 Z'
    else:
        d=f'M 0 0 H {width_mm} V {height_mm} H 0 Z'
    svg=f'<svg xmlns="http://www.w3.org/2000/svg" width="{width_mm}mm" height="{height_mm}mm" viewBox="0 0 {width_mm} {height_mm}"><path d="{d}" fill="none" stroke="#000"/></svg>'
    return {
        'instanceId':f'{kit_id}-p{idx}',
        'name':f'pieza {idx+1}',
        'role':'base' if idx == 0 else 'tapa',
        'sourceWidthCm':width_mm/10.0,
        'sourceHeightCm':height_mm/10.0,
        'svgText':svg,
    }


@app.get('/revolutionary/selftest')
def revolutionary_selftest():
    dims=[
        (118,88,'rect'),(126,82,'l'),(108,96,'trap'),(132,76,'rect'),
        (114,92,'l'),(124,84,'trap'),(106,98,'rect'),(136,74,'l'),
        (112,90,'trap'),(128,80,'rect'),(104,100,'l'),(134,72,'trap'),
        (116,86,'rect'),(122,88,'l'),(110,94,'trap'),(130,78,'rect'),
        (108,90,'l'),(120,82,'trap'),
    ]
    raw=[]
    for i,(w,h,kind) in enumerate(dims,1):
        kid=f'selftest-{i:02d}'
        raw.append({
            'kitId':kid,'figure':f'Selftest {i:02d}','priority':1,'date':'2026-08-21',
            'parts':[
                _selftest_part(kid,0,w,h,kind),
                _selftest_part(kid,1,max(76,w-16),max(58,h-14),'rect' if kind != 'rect' else 'trap'),
            ],
        })
    prepared=[]; rejected=[]
    for kit in raw:
        try:
            p=ns._prep_kit(kit,1220.0,580.0); p['date']=kit['date']; prepared.append(p)
        except Exception as exc:
            rejected.append({'kitId':kit['kitId'],'reason':str(exc)})
    if len(prepared) < 10:
        return jsonify(ok=False,engine='TVT Revolutionary Ensemble V2.3',error='selftest preparation failed',prepared=len(prepared),rejected=rejected),500
    try:
        result=revolutionary_solve(prepared,total_seconds=75.0,max_workers=4)
        result['benchmark']='synthetic-deterministic-v2-smoke'; result['candidatePool']=len(prepared); result['prepared']=len(prepared); result['rejected']=rejected; result['productionUntouched']=True
        return jsonify(result),(200 if result.get('ok') else 422)
    except Exception as exc:
        return jsonify(ok=False,engine='TVT Revolutionary Ensemble V2.3',benchmark='synthetic-deterministic-v2-smoke',error=str(exc),productionUntouched=True),500


@app.get('/revolutionary/realcase/plate06-mama')
def revolutionary_realcase_plate06_mama():
    try:
        result=run_plate06_mama(seconds=105.0)
        result['productionUntouched']=True
        return jsonify(result),(200 if result.get('ok') else 422)
    except Exception as exc:
        return jsonify(ok=False,engine='TVT Revolutionary Ensemble V2.3',benchmark='plate06_mama_exact_svg_geometry_v3',error=str(exc),productionUntouched=True),500


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
            p=ns._prep_kit(kit,width,height); p['date']=str(kit.get('date') or ''); prepared.append(p)
        except Exception as exc:
            rejected.append({'kitId':str(kit.get('kitId') or ''),'figure':str(kit.get('figure') or ''),'reason':str(exc)})
    if len(prepared)<10:
        return jsonify(ok=False,error=f'Sólo hay {len(prepared)} kits utilizables',rejected=rejected[:12]),422
    try:
        total_seconds=max(30.0,min(240.0,float(data.get('seconds') or 150.0))); workers=max(1,min(4,int(data.get('workers') or 4)))
        result=revolutionary_solve(prepared,total_seconds=total_seconds,max_workers=workers); result['candidatePool']=len(prepared); result['rejected']=rejected[:12]
        return jsonify(result),(200 if result.get('ok') else 422)
    except Exception as exc:
        return jsonify(ok=False,error=str(exc),engine='TVT Revolutionary Ensemble V2.3'),500


def _background_benchmarks():
    try:
        time.sleep(6)
        synthetic=revolutionary_selftest().get_json() if hasattr(revolutionary_selftest(),'get_json') else None
    except Exception:
        synthetic=None
    if synthetic is not None:
        print('REV_BENCH_RESULT '+json.dumps(synthetic,separators=(',',':'),ensure_ascii=False),flush=True)
    try:
        real=run_plate06_mama(seconds=105.0)
        real['productionUntouched']=True
        print('REV_REALCASE_RESULT '+json.dumps(real,separators=(',',':'),ensure_ascii=False),flush=True)
    except Exception as exc:
        print('REV_REALCASE_RESULT '+json.dumps({'ok':False,'benchmark':'plate06_mama_exact_svg_geometry_v3','error':str(exc),'productionUntouched':True},separators=(',',':')),flush=True)

threading.Thread(target=_background_benchmarks,name='revolutionary-benchmarks',daemon=True).start()
