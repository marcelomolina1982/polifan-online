from copy import deepcopy
from xml.etree import ElementTree as ET
import time, uuid

from flask import jsonify, request
from clean_lab_app import app, core, GAP_MM, PLATE_WIDTH_MM, PLATE_HEIGHT_MM, _metrics


def _extract_piece_kits(svg_text):
    root = ET.fromstring(svg_text)
    kits = []
    for g in root.iter():
        gid = str(g.attrib.get('id') or '')
        if not gid.startswith('pieza_') or g.attrib.get('data-polifan-piece') != '1':
            continue
        piece = deepcopy(g)
        piece.attrib.pop('transform', None)
        wrapper = ET.Element('svg', {
            'xmlns': 'http://www.w3.org/2000/svg',
            'width': '1220mm', 'height': '580mm', 'viewBox': '0 0 1220 580'
        })
        wrapper.append(piece)
        piece_svg = ET.tostring(wrapper, encoding='unicode')
        geom, trimx, trimy = core.svg_to_geometry(piece_svg, 122, 58, solver_tolerance_mm=.18, max_vertices=360)
        if geom.is_empty or geom.area <= 0:
            continue
        industrial = None
        for child in piece.iter():
            if child.attrib.get('data-industrial-piece') is not None:
                industrial = child
                break
        figure = str((industrial.attrib.get('data-kit') if industrial is not None else '') or gid)
        instance = str((industrial.attrib.get('data-instance') if industrial is not None else '') or gid)
        part = {
            'instanceId': instance, 'kitId': gid, 'figure': figure, 'name': gid, 'role': 'simple',
            'geom': geom, 'shape': core._shape(geom), 'trimXmm': float(trimx), 'trimYmm': float(trimy),
            'area': float(geom.area or 0),
            'envelope': max(1.0, (geom.bounds[2]-geom.bounds[0])*(geom.bounds[3]-geom.bounds[1]))
        }
        kits.append({
            'kitId': gid, 'figure': figure, 'priority': len(kits)+1, 'parts': [part],
            'area': part['area'], 'envelope': part['envelope'],
            'solidity': part['area']/max(1.0, part['envelope'])
        })
    return kits


def _run_exact(kits, budget=90):
    started = time.time()
    attempts = []
    best = None
    runs = [(1777, True, 22), (3911, True, 22), (907, False, 18), (5119, True, 22)]
    for seed, continuous, seconds in runs:
        if time.time() - started > budget - 8:
            break
        result = core._run_sparrow(kits, GAP_MM, seconds, seed, continuous=continuous)
        m = _metrics(kits, result) if result.get('ok') else {}
        attempts.append({
            'seed': seed, 'rotation': 'continua' if continuous else '15deg',
            'fits': bool(result.get('fits')), 'stripWidthMm': m.get('stripWidthMm'),
            'geometricOccupancyPct': m.get('geometricOccupancyPct'),
            'materialInsideUsedStripPct': m.get('materialInsideUsedStripPct'),
            'error': result.get('error')
        })
        if result.get('ok') and result.get('fits'):
            score = (-float(result.get('stripWidthMm') or 1e18), float(result.get('solverDensity') or 0))
            if best is None or score > best[0]:
                best = (score, result)
    if best is None:
        return None, attempts, round(time.time()-started, 2)
    return best[1], attempts, round(time.time()-started, 2)


@app.route('/upload-benchmark', methods=['GET', 'POST'])
def upload_benchmark():
    if request.method == 'GET':
        return '''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Polifan · prueba real</title><style>body{font-family:Arial;max-width:760px;margin:35px auto;padding:22px}button{padding:13px 18px;font-size:16px}input{margin:20px 0;width:100%}.note{background:#f3f3f3;padding:14px;border-radius:10px}</style></head><body><h2>Prueba real de placa · Render</h2><div class="note">Subí un SVG exportado de una placa. Se extraen sus contornos reales, se respetan 3 mm y Sparrow hace varias pasadas. No usa Vercel.</div><form method="post" enctype="multipart/form-data"><input type="file" name="file" accept=".svg,image/svg+xml" required><button type="submit">Reacomodar placa real</button></form></body></html>'''
    uploaded = request.files.get('file')
    if not uploaded:
        return jsonify(ok=False, error='Falta archivo SVG'), 400
    try:
        svg_text = uploaded.read().decode('utf-8-sig')
        kits = _extract_piece_kits(svg_text)
    except Exception as exc:
        return jsonify(ok=False, error=f'No se pudo leer el SVG: {exc}'), 422
    if not kits:
        return jsonify(ok=False, error='No se detectaron piezas data-polifan-piece en el SVG'), 422
    result, attempts, elapsed = _run_exact(kits, 95)
    trace_id = uuid.uuid4().hex[:12]
    if result is None:
        return jsonify(ok=False, error='No se pudo reacomodar el conjunto completo', traceId=trace_id,
                       pieceCount=len(kits), gapMm=GAP_MM, attempts=attempts, elapsedSeconds=elapsed), 422
    m = _metrics(kits, result)
    return jsonify(ok=True, engine='Sparrow exact real-SVG multipass', traceId=trace_id,
                   pieceCount=len(kits), placements=result.get('placements') or [], gapMm=GAP_MM,
                   widthCm=122, heightCm=58, attempts=attempts, elapsedSeconds=elapsed, **m)
