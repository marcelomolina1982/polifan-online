import importlib.util
import json
import pathlib
import sys
import time
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
TESTS=ROOT/'tests'
if str(TESTS) not in sys.path:sys.path.insert(0,str(TESTS))

from test_pipeline_e2e_real import build_real_pipeline
from test_local_repair_real import kit_from_template

FIXTURE=ROOT/'tests'/'fixtures'/'real_geometry_derived.json'


def load_hybrid():
    spec=importlib.util.spec_from_file_location('hybrid_strategy_runtime_test',ROOT/'hybrid_strategy_runtime.py')
    mod=importlib.util.module_from_spec(spec)
    sys.modules['hybrid_strategy_runtime_test']=mod
    spec.loader.exec_module(mod)
    return mod


class HybridStrategyRealTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fx=json.loads(FIXTURE.read_text(encoding='utf-8'))
        cls.templates=cls.fx['source']['kits']
        cls.ns=build_real_pipeline()
        # build_real_pipeline deja su nest_sparrow real en sys.modules; el módulo híbrido
        # se conecta exactamente a esa instancia, como ocurrirá en cors_app.
        cls.hy=load_hybrid()

    def test_mixed_case_is_rejected_by_homogeneous_detector_immediately(self):
        kits=[]
        for i in range(12):
            t=self.templates[i % len(self.templates)]
            k=kit_from_template(t,f'mix-auto-{i}',i)
            # Fuerza nombres distintos para verificar que no se active el fast-path por error.
            k['figure']=f"{k['figure']} #{i}"
            for p in k['parts']:p['figure']=k['figure']
            kits.append(k)
        started=time.monotonic()
        got=self.hy.try_homogeneous_boost(kits,3.0,started=started)
        elapsed=time.monotonic()-started
        self.assertIsNone(got)
        self.assertLess(elapsed,0.5)

    def test_real_derived_homogeneous_11_is_detected_and_certified(self):
        template=self.templates[2]
        kits=[kit_from_template(template,f'hybrid-homo-{i}',i) for i in range(11)]
        started=time.monotonic()
        got=self.hy.try_homogeneous_boost(kits,3.0,started=started)
        elapsed=time.monotonic()-started
        self.assertIsNotNone(got,'El caso real derivado que ya demostró 11 debe activar el fast-path')
        selected,result,cert,meta=got
        self.assertEqual(len(selected),11)
        self.assertEqual(len(result.get('placements') or []),22)
        self.assertGreaterEqual(float(cert.get('minimumGapMmCertified') or 0),3.0)
        self.assertEqual(cert.get('collisionCount'),0)
        self.assertEqual(cert.get('outsidePlateCount'),0)
        self.assertTrue(meta.get('homogeneousDetected'))
        self.assertLessEqual(elapsed,18.5)
        print('HYBRID_AUTO_11='+json.dumps({
            'template':template['kit'],'complete':len(selected),
            'gap':round(float(cert.get('minimumGapMmCertified') or 0),4),
            'strip':round(float(result.get('stripWidthMm') or 0),2),
            'elapsed':round(elapsed,2),'attempts':meta.get('homogeneousAttempts')
        },separators=(',',':')))

    def test_real_derived_homogeneous_12_never_fakes_success(self):
        template=self.templates[2]
        kits=[kit_from_template(template,f'hybrid-homo12-{i}',i) for i in range(12)]
        got=self.hy.try_homogeneous_boost(kits,3.0,started=time.monotonic())
        self.assertIsNotNone(got)
        selected,result,cert,meta=got
        # Con este modelo real sabemos que 11 entra y 12 normalmente no: el híbrido debe
        # conservar 11, no inventar 12 ni degradar a cero.
        self.assertIn(len(selected),(11,12))
        self.assertGreaterEqual(float(cert.get('minimumGapMmCertified') or 0),3.0)
        self.assertEqual(len(result.get('placements') or []),len(selected)*2)
        if len(selected)==12:
            self.assertLessEqual(float(result.get('stripWidthMm') or 1e9),1220.5)


if __name__=='__main__':unittest.main(verbosity=2)
