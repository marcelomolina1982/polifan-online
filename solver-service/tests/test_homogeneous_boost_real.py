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


class HomogeneousBoostRealTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fx=json.loads(FIXTURE.read_text(encoding='utf-8'))
        cls.templates=cls.fx['source']['kits']
        cls.ns=build_real_pipeline()

    def run_multistart(self,count,template_index,seeds=(429,1701,7919,31337,65537),seconds=3):
        template=self.templates[template_index]
        kits=[kit_from_template(template,f'homo-{template_index}-{i}',i) for i in range(count)]
        best=None; rows=[]
        for seed in seeds:
            started=time.monotonic()
            r=self.ns._run_sparrow(kits,3.0,seconds,seed,continuous=True)
            elapsed=time.monotonic()-started
            valid=False; cert={}
            if r.get('ok') and r.get('fits'):
                valid,cert=self.ns._validate_final_geometry(kits,r)
            rows.append({'seed':seed,'fits':bool(r.get('fits')),'valid':bool(valid),
                         'gap':round(float(cert.get('minimumGapMmCertified') or 0),4),
                         'strip':round(float(r.get('stripWidthMm') or 0),2),'elapsed':round(elapsed,2)})
            if valid:
                best=(r,cert);break
        return kits,best,rows

    def test_real_heart_homogeneous_11_multistart(self):
        kits,best,rows=self.run_multistart(11,2)
        material=100.0*sum(k['area'] for k in kits)/(1220*580)
        print('HOMO_REAL_11='+json.dumps({'template':self.templates[2]['kit'],'material_pct':round(material,2),'runs':rows,'success':best is not None},separators=(',',':')))
        # No imponemos éxito artificial: el test registra la capacidad real. Sí exigimos que no haya falso positivo.
        if best:
            r,cert=best
            self.assertEqual(len(r.get('placements') or []),22)
            self.assertGreaterEqual(float(cert.get('minimumGapMmCertified') or 0),3.0)
            self.assertLessEqual(float(r.get('stripWidthMm') or 1e9),1220.5)

    def test_real_heart_homogeneous_12_only_if_11_is_possible(self):
        kits11,best11,rows11=self.run_multistart(11,2,seeds=(429,1701,7919),seconds=3)
        if not best11:
            self.skipTest('11 homogéneas no entró con este modelo real; no tiene sentido forzar 12')
        kits12,best12,rows12=self.run_multistart(12,2,seeds=(429,1701,7919,31337,65537),seconds=4)
        print('HOMO_REAL_12='+json.dumps({'template':self.templates[2]['kit'],'runs':rows12,'success':best12 is not None},separators=(',',':')))
        if best12:
            r,cert=best12
            self.assertEqual(len(r.get('placements') or []),24)
            self.assertGreaterEqual(float(cert.get('minimumGapMmCertified') or 0),3.0)


if __name__=='__main__':unittest.main(verbosity=2)
