from flask import request, jsonify
import tempfile, time
from pathlib import Path
import motor_definitivo_v1 as core
from extended_app import app

STRICT_GAP_MM=3.0
VALIDATION_PPM=4.0


def _validate_svg_text(svg_text, filename='placa.svg'):
    started=time.time()
    with tempfile.TemporaryDirectory(prefix='polifan_cert_') as td:
        inp=Path(td)/(Path(filename or 'placa.svg').name or 'placa.svg')
        if not inp.name.lower().endswith('.svg'):
            inp=inp.with_suffix('.svg')
        inp.write_text(svg_text,encoding='utf-8')
        root,defs,pieces,collapsed=core.extract(inp,VALIDATION_PPM)
        if not pieces:
            return {
                'status':'SIN_GEOMETRIA','validation':{'valid':False,'piece_count':0,'conflicts':0,'border_conflicts':0,'min_gap_mm':None,'gap_required_mm':STRICT_GAP_MM},
                'seconds':round(time.time()-started,3)
            }
        ev=core.evaluate(pieces,STRICT_GAP_MM)
        valid=(ev[1]==0 and ev[2]==0 and ev[3] is not None and float(ev[3])>=STRICT_GAP_MM)
        validation={
            'valid':valid,
            'piece_count':len(pieces),
            'collapsed_internal':collapsed,
            'conflicts':int(ev[1]),
            'border_conflicts':int(ev[2]),
            'min_gap_mm':None if ev[3] is None else round(float(ev[3]),9),
            'gap_required_mm':STRICT_GAP_MM,
            'validation_ppm':VALIDATION_PPM,
            'geometry_unchanged':True,
        }
        return {
            'status':'CERTIFICADO' if valid else 'EXPORT_RECHAZADO',
            'pieces':len(pieces),
            'validation':validation,
            'svgText':svg_text if valid else None,
            'seconds':round(time.time()-started,3),
            'engineVersion':'V1.7-strict-3mm-validator-only',
            'certificationStrategy':'validate_exact_svg_without_repacking_strict_3mm',
        }


def strict_motor_definitivo_svg():
    data=request.get_json(silent=True) or {}
    svg_text=data.get('svgText') or ''
    if not svg_text.strip():
        return jsonify(ok=False,error='Falta svgText'),400
    if len(svg_text)>8_000_000:
        return jsonify(ok=False,error='SVG demasiado grande para el modo de prueba'),413
    filename=str(data.get('filename') or 'placa.svg')
    try:
        result=_validate_svg_text(svg_text,filename)
        certified=result.get('status')=='CERTIFICADO'
        return jsonify(ok=certified,engine='Certificador exacto V1.7 · 3 mm duros · sin reacomodar',**result),(200 if certified else 422)
    except Exception as exc:
        return jsonify(ok=False,error=str(exc),engine='Certificador exacto V1.7 · 3 mm duros'),500


def strict_motor_definitivo_health():
    return jsonify(ok=True,engine='Certificador exacto V1.7',mode='test',preferredGapMm=3.0,absoluteMinGapMm=3.0,repacking=False)

# Sustituir las rutas antiguas ya registradas por extended_app sin crear endpoints duplicados.
if 'motor_definitivo_svg' in app.view_functions:
    app.view_functions['motor_definitivo_svg']=strict_motor_definitivo_svg
if 'motor_definitivo_health' in app.view_functions:
    app.view_functions['motor_definitivo_health']=strict_motor_definitivo_health
