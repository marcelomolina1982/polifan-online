import json
import pathlib
import time
import unittest
from collections import Counter

from shapely.geometry import Polygon

from test_pipeline_e2e_real import build_real_pipeline

ROOT = pathlib.Path(__file__).resolve().parents[1]
FIXTURE = ROOT / 'tests' / 'fixtures' / 'real_geometry_derived.json'


class RealUserGeometryStressTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = json.loads(FIXTURE.read_text(encoding='utf-8'))
        cls.templates = cls.fixture['source']['kits']
        cls.ns = build_real_pipeline()

        def prep_real(k, width_mm, height_mm):
            variant = int(k.get('variant', 0)) % len(cls.templates)
            template = cls.templates[variant]
            kid = str(k['kitId'])
            parts = []
            for idx, source_part in enumerate(template['parts']):
                pts = source_part['points']
                geom = Polygon(pts)
                if not geom.is_valid:
                    geom = geom.buffer(0)
                if geom.is_empty:
                    raise ValueError(f'geometría vacía {template["kit"]} p{idx}')
                minx, miny, maxx, maxy = geom.bounds
                envelope = max(1.0, (maxx-minx)*(maxy-miny))
                parts.append({
                    'instanceId': f'{kid}-p{idx}',
                    'kitId': kid,
                    'figure': template['kit'],
                    'name': f'parte-{idx}',
                    'role': 'base' if idx == 0 else 'tapa',
                    'geom': geom,
                    'shape': {'type': 'simple_polygon', 'data': pts},
                    'trimXmm': 0.0,
                    'trimYmm': 0.0,
                    'area': float(geom.area),
                    'envelope': float(envelope),
                })
            area = sum(p['area'] for p in parts)
            envelope = sum(p['envelope'] for p in parts)
            return {
                'kitId': kid,
                'figure': template['kit'],
                'priority': float(k.get('priority', 999)),
                'parts': parts,
                'area': area,
                'envelope': envelope,
                'solidity': area/max(1.0, envelope),
            }

        cls.ns._prep_kit = prep_real

    def raw_payload(self, count, offset, reverse=False):
        rows=[]
        for i in range(count):
            variant=(i+offset) % len(self.templates)
            priority=(count-i if reverse else i) + (offset*0.01)
            rows.append({
                'kitId': f'real-{count}-{offset}-{i}',
                'figure': self.templates[variant]['kit'],
                'priority': priority,
                'variant': variant,
            })
        return {
            'widthCm': 122,
            'heightCm': 58,
            'gapCm': .3,
            'targetDensity': 75,
            'kits': rows,
        }

    def call(self, count, offset, reverse=False):
        payload=self.raw_payload(count, offset, reverse)
        started=time.monotonic()
        with self.ns.app.test_request_context('/nest-sparrow', method='POST', json=payload):
            response=self.ns.nest_sparrow()
            if isinstance(response, tuple):
                resp,status=response[0],response[1]
            else:
                resp,status=response,getattr(response,'status_code',200)
            data=resp.get_json()
        return data,status,time.monotonic()-started

    def assert_certified(self, data, status):
        self.assertEqual(status, 200, data)
        self.assertTrue(data.get('ok'), data)
        self.assertGreaterEqual(int(data.get('completeFigures') or 0), 10, data)
        cert=data.get('productionCertificate') or {}
        self.assertEqual(cert.get('collisionCount'), 0, data)
        self.assertEqual(cert.get('outsidePlateCount'), 0, data)
        self.assertGreaterEqual(float(cert.get('minimumGapMmCertified') or 0), 3.0, data)
        self.assertLessEqual(float(data.get('stripWidthMm') or 1e9), 1220.5, data)
        self.assertIn('practicalOccupancyPct', data)

    def test_fixture_is_traceable_to_real_uploaded_svg(self):
        source=self.fixture['source']
        self.assertEqual(source['source_name'], 'placa-sparrow-1__SPARROW_CERTIFICADO (6).svg')
        self.assertEqual(source['sha256'], '5f686be235c931fd085e90d0e04f82c1a48765cc464c82bd1f912b973081d14b')
        self.assertEqual(len(source['kits']), 4)
        self.assertTrue(all(len(k['parts']) == 2 for k in source['kits']))
        # La reducción a 24 puntos no debe desfigurar el área real más de 8%.
        for kit in source['kits']:
            for part in kit['parts']:
                poly=Polygon(part['points'])
                ref=float(part['area'])
                err=abs(float(poly.area)-ref)/max(1.0,ref)
                self.assertLess(err, .08, (kit['kit'], err))

    def test_stress_real_geometry_10_11_12_multiple_orders(self):
        results=[]
        # 12 ejecuciones completas del pipeline real: 4 variantes para cada 10/11/12.
        for count in (10,11,12):
            for offset in range(4):
                reverse=bool(offset % 2)
                data,status,elapsed=self.call(count,offset,reverse)
                self.assert_certified(data,status)
                results.append({
                    'requested':count,
                    'offset':offset,
                    'reverse':reverse,
                    'complete':int(data.get('completeFigures') or 0),
                    'gap':float((data.get('productionCertificate') or {}).get('minimumGapMmCertified') or 0),
                    'occupancy':round(float(data.get('practicalOccupancyPct') or 0),2),
                    'strip':round(float(data.get('stripWidthMm') or 0),2),
                    'elapsed':round(elapsed,2),
                })
        by_count=Counter(r['requested'] for r in results if r['complete']>=r['requested'])
        worst=max(r['elapsed'] for r in results)
        mean=sum(r['elapsed'] for r in results)/len(results)
        min_gap=min(r['gap'] for r in results)
        self.assertGreaterEqual(min_gap,3.0)
        # Cada ejecución CI limita cada llamada real a Sparrow a 2s; el pipeline completo
        # no debe volver al patrón de 800-900s visto en Render.
        self.assertLess(worst,45.0,results)
        print('REAL_USER_STRESS_SUMMARY='+json.dumps({
            'source_sha256': self.fixture['source']['sha256'],
            'runs': len(results),
            'mean_seconds': round(mean,2),
            'worst_seconds': round(worst,2),
            'min_certified_gap_mm': round(min_gap,4),
            'full_target_successes': {str(k):by_count[k] for k in (10,11,12)},
            'results': results,
        },separators=(',',':')))


if __name__ == '__main__':
    unittest.main(verbosity=2)
