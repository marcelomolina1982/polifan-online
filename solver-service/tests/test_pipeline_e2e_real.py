import importlib.util
import os
import pathlib
import sys
import types
import unittest

from flask import Flask
from shapely.geometry import box

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPARROW = os.environ.get('SPARROW_BIN_TEST')


def load_path(filename, module_name):
    spec = importlib.util.spec_from_file_location(module_name, ROOT / filename)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = mod
    spec.loader.exec_module(mod)
    return mod


def rectangle_part(kit_id, suffix, w=86.0, h=72.0):
    geom = box(0, 0, w, h)
    return {
        'instanceId': f'{kit_id}-{suffix}',
        'kitId': kit_id,
        'figure': kit_id,
        'name': suffix,
        'role': suffix,
        'geom': geom,
        'shape': {
            'type': 'simple_polygon',
            'data': [[0.0, 0.0], [w, 0.0], [w, h], [0.0, h]],
        },
        'trimXmm': 0.0,
        'trimYmm': 0.0,
        'area': float(geom.area),
        'envelope': float(w * h),
    }


def prepared_kit(i):
    kid = f'kit-{i:02d}'
    parts = [rectangle_part(kid, 'base'), rectangle_part(kid, 'tapa')]
    area = sum(p['area'] for p in parts)
    envelope = sum(p['envelope'] for p in parts)
    return {
        'kitId': kid,
        'figure': f'Figura {i:02d}',
        'priority': i,
        'parts': parts,
        'area': area,
        'envelope': envelope,
        'solidity': area / envelope,
    }


def build_real_pipeline():
    if not SPARROW or not os.path.exists(SPARROW):
        raise unittest.SkipTest('SPARROW_BIN_TEST no disponible')

    # nest_sparrow.py importa dos módulos grandes de la app. Para esta prueba
    # usamos stubs mínimos sólo para poder cargar EL motor real y su _run_sparrow.
    extended = types.ModuleType('extended_app')
    extended.app = Flask('pipeline-e2e')
    extended._kit_valid_for_plate = lambda kit, w, h: (True, None)
    app_stub = types.ModuleType('app')
    app_stub._n = lambda v, d=0: float(d if v is None else v)
    app_stub.svg_to_geometry = lambda *a, **k: (_ for _ in ()).throw(RuntimeError('no debe parsear SVG en este test'))

    old_ext, old_app = sys.modules.get('extended_app'), sys.modules.get('app')
    sys.modules['extended_app'], sys.modules['app'] = extended, app_stub
    old_bin = os.environ.get('SPARROW_BIN')
    os.environ['SPARROW_BIN'] = SPARROW
    try:
        ns = load_path('nest_sparrow.py', 'nest_sparrow')
    finally:
        if old_ext is None: sys.modules.pop('extended_app', None)
        else: sys.modules['extended_app'] = old_ext
        if old_app is None: sys.modules.pop('app', None)
        else: sys.modules['app'] = old_app
        if old_bin is None: os.environ.pop('SPARROW_BIN', None)
        else: os.environ['SPARROW_BIN'] = old_bin

    # Evitamos parsear SVG porque estos kits sintéticos ya tienen geometría real.
    ns._prep_kit = lambda k, w, h: k

    # Cargar exactamente el mismo orden que producción/lab.
    load_path('production_safety_runtime.py', 'production_safety_runtime_e2e')
    load_path('intelligent_selector_runtime.py', 'intelligent_selector_runtime_e2e')
    load_path('fixed_hole_fill.py', 'fixed_hole_fill')
    load_path('growth_guard_runtime.py', 'growth_guard_runtime_e2e')
    load_path('practical_occupancy_runtime.py', 'practical_occupancy_runtime_e2e')

    # El contrato de presupuestos 110/155 ya se prueba aparte. En E2E queremos
    # validar la cadena geométrica completa sin gastar minutos en CI: cada intento
    # llama al binario REAL, pero se limita a 2 s por intento.
    real_run = ns._run_sparrow
    requested_budgets = []
    def fast_real_run(selected, gap, seconds, seed, continuous=False, extra_part=None):
        requested_budgets.append(float(seconds))
        return real_run(selected, gap, min(float(seconds), 2.0), seed,
                        continuous=continuous, extra_part=extra_part)
    ns._run_sparrow = fast_real_run
    ns._e2e_requested_budgets = requested_budgets
    return ns


class FullPipelineRealTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ns = build_real_pipeline()

    def call_pipeline(self, count):
        payload = {
            'widthCm': 122,
            'heightCm': 58,
            'gapCm': .3,
            'targetDensity': 75,
            'kits': [prepared_kit(i) for i in range(count)],
        }
        with self.ns.app.test_request_context('/nest-sparrow', method='POST', json=payload):
            response = self.ns.nest_sparrow()
            if isinstance(response, tuple):
                resp, status = response[0], response[1]
            else:
                resp, status = response, getattr(response, 'status_code', 200)
            return resp.get_json(), status

    def assert_certified(self, data, expected_min):
        self.assertTrue(data.get('ok'), data)
        self.assertGreaterEqual(int(data.get('completeFigures') or 0), expected_min)
        cert = data.get('productionCertificate') or {}
        self.assertEqual(cert.get('collisionCount'), 0)
        self.assertEqual(cert.get('outsidePlateCount'), 0)
        self.assertGreaterEqual(float(cert.get('minimumGapMmCertified') or 0), 3.0)
        self.assertGreaterEqual(float(data.get('minimumGapMm') or 0), 3.0)
        self.assertIn('practicalOccupancyPct', data)
        self.assertGreater(float(data['practicalOccupancyPct']), 0.0)
        self.assertLessEqual(float(data['practicalOccupancyPct']), 100.0)
        self.assertGreaterEqual(float(data.get('stripWidthMm') or 0), 0.0)
        self.assertLessEqual(float(data.get('stripWidthMm') or 99999), 1220.5)

    def test_pipeline_real_10_selector_solver_certificate_occupancy(self):
        data, status = self.call_pipeline(10)
        self.assertEqual(status, 200, data)
        self.assertEqual(int(data.get('completeFigures') or 0), 10)
        self.assert_certified(data, 10)

    def test_pipeline_real_11_preserves_or_improves_base(self):
        data, status = self.call_pipeline(11)
        self.assertEqual(status, 200, data)
        self.assert_certified(data, 10)
        self.assertIn(int(data.get('completeFigures') or 0), (10, 11))
        self.assertTrue(data.get('base10Preserved', True))

    def test_pipeline_real_12_never_degrades_below_10(self):
        data, status = self.call_pipeline(12)
        self.assertEqual(status, 200, data)
        self.assert_certified(data, 10)
        self.assertGreaterEqual(int(data.get('completeFigures') or 0), 10)
        self.assertLessEqual(int(data.get('completeFigures') or 0), 12)


if __name__ == '__main__':
    unittest.main(verbosity=2)
