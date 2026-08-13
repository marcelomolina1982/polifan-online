import json
import pathlib
import time
import unittest
from shapely.geometry import Polygon

from test_pipeline_e2e_real import build_real_pipeline

ROOT = pathlib.Path(__file__).resolve().parents[1]
FIXTURE = ROOT / 'tests' / 'fixtures' / 'real_geometry_derived.json'


class MixedQuickRepackRealTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = json.loads(FIXTURE.read_text(encoding='utf-8'))
        cls.templates = cls.fixture['source']['kits']
        cls.ns = build_real_pipeline()

    def kit_from_template(self, template, kid, priority):
        parts=[]
        for idx, source_part in enumerate(template['parts']):
            pts=source_part['points']
            geom=Polygon(pts)
            if not geom.is_valid:
                geom=geom.buffer(0)
            minx,miny,maxx,maxy=geom.bounds
            env=max(1.0,(maxx-minx)*(maxy-miny))
            parts.append({
                'instanceId':f'{kid}-p{idx}','kitId':kid,'figure':template['kit'],
                'name':f'parte-{idx}','role':'base' if idx==0 else 'tapa',
                'geom':geom,'shape':{'type':'simple_polygon','data':pts},
                'trimXmm':0.0,'trimYmm':0.0,'area':float(geom.area),'envelope':float(env),
            })
        area=sum(p['area'] for p in parts)
        env=sum(p['envelope'] for p in parts)
        return {'kitId':kid,'figure':template['kit'],'priority':priority,'parts':parts,
                'area':area,'envelope':env,'solidity':area/max(1.0,env)}

    def run_case(self, offset):
        kits=[]
        for i in range(11):
            t=self.templates[(i+offset)%len(self.templates)]
            kits.append(self.kit_from_template(t,f'mix-{offset}-{i}',i))
        rows=[]
        best=None
        for seed in (429,1701,7919,31337):
            started=time.monotonic()
            r=self.ns._run_sparrow(kits,3.0,2.5,seed,continuous=True)
            elapsed=time.monotonic()-started
            valid=False; cert={}
            if r.get('ok') and r.get('fits'):
                valid,cert=self.ns._validate_final_geometry(kits,r)
            rows.append({'seed':seed,'fits':bool(r.get('fits')),'valid':bool(valid),
                         'gap':round(float(cert.get('minimumGapMmCertified') or 0),4),
                         'strip':round(float(r.get('stripWidthMm') or 0),2),
                         'elapsed':round(elapsed,2)})
            if valid:
                best=(r,cert)
                break
        return best,rows

    def test_four_real_mixed_orders_quick_repack_11(self):
        summary=[]
        successes=0
        worst=0.0
        for offset in range(4):
            best,rows=self.run_case(offset)
            worst=max(worst,max(r['elapsed'] for r in rows))
            if best:
                successes+=1
                r,cert=best
                self.assertEqual(len(r.get('placements') or []),22)
                self.assertGreaterEqual(float(cert.get('minimumGapMmCertified') or 0),3.0)
                self.assertLessEqual(float(r.get('stripWidthMm') or 1e9),1220.5)
            summary.append({'offset':offset,'success':best is not None,'runs':rows})
        print('MIXED_QUICK_REPACK_11='+json.dumps({'successes':successes,'cases':4,'worst_single_try_seconds':round(worst,2),'results':summary},separators=(',',':')))
        self.assertLess(worst,4.0)


if __name__=='__main__':
    unittest.main(verbosity=2)
