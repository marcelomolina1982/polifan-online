from copy import deepcopy
from xml.etree import ElementTree as ET

from selftest_fixture import get_svg_text


def _fixture_to_kits():
    root = ET.fromstring(get_svg_text())
    kits = []
    for g in root.iter():
        gid = str(g.attrib.get('id') or '')
        if not gid.startswith('pieza_') or g.attrib.get('data-polifan-piece') != '1':
            continue
        piece = deepcopy(g)
        piece.attrib.pop('transform', None)
        wrapper = ET.Element('svg', {
            'width': '1220mm',
            'height': '580mm',
            'viewBox': '0 0 1220 580',
        })
        wrapper.append(piece)
        svg_text = ET.tostring(wrapper, encoding='unicode')
        industrial = None
        for child in piece.iter():
            if child.attrib.get('data-industrial-piece') is not None:
                industrial = child
                break
        figure = str(industrial.attrib.get('data-kit') or gid) if industrial is not None else gid
        instance = str(industrial.attrib.get('data-instance') or gid) if industrial is not None else gid
        kits.append({
            'kitId': gid,
            'figure': figure,
            'priority': len(kits) + 1,
            'parts': [{
                'instanceId': instance,
                'name': gid,
                'role': 'simple',
                'sourceWidthCm': 122,
                'sourceHeightCm': 58,
                'svgText': svg_text,
            }],
        })
    return kits


def register_selftest(app, solve):
    @app.get('/selftest-real-svg')
    def selftest_real_svg():
        try:
            budget = 75
            kits = _fixture_to_kits()
            with app.test_request_context('/solve', method='POST', json={
                'kits': kits,
                'budgetSeconds': budget,
                'urgentAnchorCount': min(6, len(kits)),
            }):
                response = solve()
            status = 200
            body = response
            if isinstance(response, tuple):
                body, status = response[0], int(response[1])
            data = body.get_json(silent=True) if hasattr(body, 'get_json') else body
            if not isinstance(data, dict):
                data = {'ok': False, 'error': 'Respuesta invalida del selftest'}
            data['selftest'] = True
            data['fixtureKits'] = len(kits)
            return data, status
        except Exception as exc:
            return {'ok': False, 'selftest': True, 'error': str(exc)}, 500
