import json
import os
import pathlib
import subprocess
import tempfile
import time
import unittest


SPARROW_BIN = os.environ.get('SPARROW_BIN_TEST')


@unittest.skipUnless(SPARROW_BIN and os.path.exists(SPARROW_BIN), 'Sparrow real no disponible')
class RealSparrowIntegrationTests(unittest.TestCase):
    def make_instance(self, count=20, w=70.0, h=40.0):
        poly = [[0.0,0.0],[w,0.0],[w,h],[0.0,h]]
        items = []
        for i in range(count):
            items.append({
                'id': i,
                'demand': 1,
                'shape': {'type':'simple_polygon','data':poly},
                'allowed_orientations':[0.0,90.0,180.0,270.0],
            })
        return {'name':'internal-real-sparrow','items':items,'strip_height':580.0}

    def run_sparrow(self, instance, seconds=2, gap=3.2):
        with tempfile.TemporaryDirectory(prefix='sparrow-real-test-') as td:
            inp = pathlib.Path(td) / 'input.json'
            inp.write_text(json.dumps(instance, separators=(',',':')), encoding='utf-8')
            started = time.monotonic()
            proc = subprocess.run([
                SPARROW_BIN, '-i', str(inp), '-t', str(seconds),
                '--min-item-separation', str(gap), '--workers', '1', '-s', '429'
            ], cwd=td, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
               text=True, timeout=seconds + 15)
            elapsed = time.monotonic() - started
            out = pathlib.Path(td) / 'output' / 'final_internal-real-sparrow.json'
            self.assertEqual(proc.returncode, 0, proc.stdout[-3000:])
            self.assertTrue(out.exists(), proc.stdout[-3000:])
            data = json.loads(out.read_text(encoding='utf-8'))
            return data, elapsed

    def test_real_binary_places_20_simple_parts_inside_plate_width(self):
        data, elapsed = self.run_sparrow(self.make_instance())
        sol = data.get('solution') or {}
        placed = ((sol.get('layout') or {}).get('placed_items') or [])
        self.assertEqual(len(placed), 20)
        self.assertLessEqual(float(sol.get('strip_width') or 1e9), 1220.5)
        self.assertLess(elapsed, 20.0)

    def test_real_binary_honors_short_time_budget_without_hanging(self):
        instance = self.make_instance(count=34, w=105.0, h=55.0)
        _, elapsed = self.run_sparrow(instance, seconds=1, gap=3.2)
        self.assertLess(elapsed, 16.0)


if __name__ == '__main__':
    unittest.main(verbosity=2)
