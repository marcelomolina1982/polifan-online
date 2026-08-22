from nest_sparrow import app
import base_only_runtime  # primero: encontrar 10 con la configuración estable conocida
import fixed_hole_runtime  # después: rellenar huecos sin mover la base
import emergency_cut_runtime  # si 10 falla, entregar una placa menor valida para no bloquear producción
import async_jobs  # cálculo largo desacoplado de la petición HTTP del navegador
from flask import request, jsonify
from flask_cors import CORS
from motor_definitivo_v7 import solve_svg_text

# Generador principal: Sparrow base protegida + relleno fijo de huecos.
# /nest-jobs inicia el cálculo y /nest-jobs/<id> permite consultar el estado.
# El certificador V1.7 valida GEOMETRIA, no cantidad de juegos.
CORS(app, resources={r"/*": {"origins": "*"}}, allow_headers=["Content-Type"], methods=["GET", "POST", "OPTIONS"])

@app.get('/motor-definitivo/health')
def motor_definitivo_health():
    return jsonify(ok=True,engine='Motor Polifan Definitivo V1.7',mode='emergency-lab',preferredGapMm=3.0,absoluteMinGapMm=2.5,runtime='release-fast-cert-estable')

@app.post('/motor-definitivo/svg')
def motor_definitivo_svg():
    data=request.get_json(silent=True) or {}
    svg_text=data.get('svgText') or ''
    if not svg_text.strip():
        return jsonify(ok=False,error='Falta svgText'),400
    if len(svg_text)>8_000_000:
        return jsonify(ok=False,error='SVG demasiado grande'),413
    filename=str(data.get('filename') or 'placa.svg')
    try:
        seconds3=max(1.0,min(20.0,float(data.get('seconds3') or 8.0)))
        seconds25=max(1.0,min(30.0,float(data.get('seconds25') or 14.0)))
        result=solve_svg_text(svg_text,filename,seconds3,seconds25)
        certified=str(result.get('status','')).startswith('CERTIFICADO')
        return jsonify(ok=certified,engine='Motor Polifan Definitivo V1.7',**result),(200 if certified else 422)
    except Exception as exc:
        return jsonify(ok=False,error=str(exc),engine='Motor Polifan Definitivo V1.7'),500
