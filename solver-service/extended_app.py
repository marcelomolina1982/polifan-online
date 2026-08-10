from app import app
from flask import request, jsonify
from motor_definitivo_v6 import solve_svg_text

@app.get('/motor-definitivo/health')
def motor_definitivo_health():
    return jsonify(ok=True,engine='Motor Polifan Definitivo V1.6',mode='test',preferredGapMm=3.0,absoluteMinGapMm=2.5)

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
        return jsonify(ok=certified,engine='Motor Polifan Definitivo V1.6',**result),(200 if certified else 422)
    except Exception as exc:
        return jsonify(ok=False,error=str(exc),engine='Motor Polifan Definitivo V1.6'),500
