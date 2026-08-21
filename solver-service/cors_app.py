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
from flask import jsonify, request
from flask_cors import CORS
from motor_definitivo_v7 import solve_svg_text
from revolutionary.ensemble_v1 import revolutionary_solve

CORS(app, resources={r"/*": {"origins": "*"}}, allow_headers=["Content-Type"], methods=["GET", "POST", "OPTIONS"])


@app.get('/runtime-info')
def runtime_info():
    view=app.view_functions.get('nest_sparrow')
    return jsonify(
        ok=True,
        build='motor-revolutionario-lab',
        runtime='sparrow+jagua ensemble lab',
        solverFunction=getattr(view,'__name__','-'),
        productionUntouched=True,
        revolutionaryEndpoint='/revolutionary/nest',
        targetDensity=70,
        minGapMm=3.0,
        edgeMarginMm=3.0,
    )


@app.get('/revolutionary/health')
def revolutionary_health():
    return jsonify(
        ok=True,
        engine='TVT Revolutionary Ensemble V1',
        mode='isolated-lab',
        minGapMm=3.0,
        completeCountFirst=True,
        ensemble=True,
        productionUntouched=True,
    )


@app.post('/revolutionary/nest')
def revolutionary_nest():
    data=request.get_json(silent=True) or {}
    width=max(1.0,ns._n(data.get('widthCm'),122)*10)
    height=max(1.0,ns._n(data.get('heightCm'),58)*10)
    if abs(width-1220.0)>1 or abs(height-580.0)>1:
        return jsonify(ok=False,error='El laboratorio está fijado a placa 1220x580 mm'),400

    raw=sorted(
        data.get('kits') or [],
        key=lambda k:(ns._priority(k),str(k.get('date') or ''),str(k.get('figure') or '')),
    )[:96]
    prepared=[];rejected=[]
    for kit in raw:
        try:
            p=ns._prep_kit(kit,width,height)
            p['date']=str(kit.get('date') or '')
            prepared.append(p)
        except Exception as exc:
            rejected.append({'kitId':str(kit.get('kitId') or ''),'figure':str(kit.get('figure') or ''),'reason':str(exc)})
    if len(prepared)<10:
        return jsonify(ok=False,error=f'Sólo hay {len(prepared)} kits utilizables',rejected=rejected[:12]),422

    try:
        total_seconds=max(30.0,min(240.0,float(data.get('seconds') or 150.0)))
        workers=max(1,min(4,int(data.get('workers') or 4)))
        result=revolutionary_solve(prepared,total_seconds=total_seconds,max_workers=workers)
        result['candidatePool']=len(prepared)
        result['rejected']=rejected[:12]
        return jsonify(result),(200 if result.get('ok') else 422)
    except Exception as exc:
        return jsonify(ok=False,error=str(exc),engine='TVT Revolutionary Ensemble V1'),500


@app.get('/motor-definitivo/health')
def motor_definitivo_health():
    return jsonify(
        ok=True,
        engine='Motor Polifan Definitivo V1.7',
        mode='test',
        preferredGapMm=3.0,
        absoluteMinGapMm=2.5,
        runtime='cors_app',
    )


@app.post('/motor-definitivo/svg')
def motor_definitivo_svg():
    data=request.get_json(silent=True) or {}
    svg_text=data.get('svgText') or ''
    if not svg_text.strip():
        return jsonify(ok=False,error='Falta svgText'),400
    if len(svg_text)>8_000_000:
        return jsonify(ok=False,error='SVG demasiado grande para el modo de prueba'),413

    filename=str(data.get('filename') or 'placa.svg')
    try:
        seconds3=max(1.0,min(20.0,float(data.get('seconds3') or 8.0)))
        seconds25=max(1.0,min(30.0,float(data.get('seconds25') or 14.0)))
        result=solve_svg_text(svg_text,filename,seconds3,seconds25)
        certified=str(result.get('status','')).startswith('CERTIFICADO')
        return jsonify(ok=certified,engine='Motor Polifan Definitivo V1.7',**result),(200 if certified else 422)
    except Exception as exc:
        return jsonify(ok=False,error=str(exc),engine='Motor Polifan Definitivo V1.7'),500
