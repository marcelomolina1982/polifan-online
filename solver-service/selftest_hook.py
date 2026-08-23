import json, threading, time
import clean_lab_app as base
from selftest_fixture import get_svg_text

app = base.app


def _run_selftest():
    # Espera breve para que Gunicorn termine de iniciar y el health check no compita.
    time.sleep(3)
    try:
        svg_text = get_svg_text()
        with app.test_request_context('/benchmark-plate-svg', method='POST', json={'svgText': svg_text}):
            value = base.benchmark_plate_svg()
        status = 200
        response = value
        if isinstance(value, tuple):
            response = value[0]
            if len(value) > 1 and isinstance(value[1], int):
                status = value[1]
        data = response.get_json() if hasattr(response, 'get_json') else {'raw': str(response)}
        summary = {
            'status': status,
            'ok': data.get('ok'),
            'build': data.get('build'),
            'traceId': data.get('traceId'),
            'pieceCount': data.get('pieceCount'),
            'gapMm': data.get('gapMm'),
            'rotation': data.get('rotation'),
            'seed': data.get('seed'),
            'stripWidthMm': data.get('stripWidthMm'),
            'stripWidthUsagePct': data.get('stripWidthUsagePct'),
            'geometricOccupancyPct': data.get('geometricOccupancyPct'),
            'materialInsideUsedStripPct': data.get('materialInsideUsedStripPct'),
            'sparrowReportedDensityPct': data.get('sparrowReportedDensityPct'),
            'elapsedSeconds': data.get('elapsedSeconds'),
            'error': data.get('error'),
            'attempts': data.get('attempts'),
        }
        print('SELFTEST_RESULT ' + json.dumps(summary, ensure_ascii=False, separators=(',', ':')), flush=True)
    except Exception as exc:
        print('SELFTEST_ERROR ' + repr(exc), flush=True)


threading.Thread(target=_run_selftest, name='exact-svg-selftest', daemon=True).start()
