from nest_sparrow import app
import sparrow_v18_runtime  # geometría base: margen real de 3 mm
import production_safety_runtime
import base_only_runtime
import adaptive_base_runtime
import intelligent_selector_runtime
import hybrid_strategy_runtime
import final_runtime_v20  # runtime final v25.0.22: V1.10 Global Recompact
import emergency_cut_runtime  # PRODUCCION: fallback certificado 9 -> 6 antes de bloquear

import async_jobs
from flask import jsonify, request
from flask_cors import CORS
from motor_definitivo_v7 import solve_svg_text

CORS(app, resources={r"/*": {"origins": "*"}}, allow_headers=["Content-Type"], methods=["GET", "POST", "OPTIONS"])

@app.get('/runtime-info')
def runtime_info():
    view=app.view_functions.get('nest_sparrow')
    return jsonify(ok=True,build='v25.0.22-emergency-fallback-live',runtime='sparrow-emergency-certified-fallback',solverFunction=getattr(view,'__name__','-'),growthTargets=[11,12,13,14,15,16],globalRecompact=True,emergencyFallback=True,fallbackRange=[9,8,7,6],targetDensity=70,minGapMm=3.0,edgeMarginMm=3)


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
