import json
import pathlib
import time
import unittest
from copy import deepcopy

from shapely.geometry import Polygon

from test_pipeline_e2e_real import build_real_pipeline
from local_repair_growth import try_add_complete_local_repair

ROOT=pathlib.Path(__file__).resolve().parents[1]
FIXTURE=ROOT/'tests'/'fixtures'/'real_geometry_derived.json'


def kit_from_template(template, kid, priority=1):
    parts=[]
    for idx,src in enumerate(template['parts']):
        geom=Polygon(src['points'])
        if not geom.is_valid:geom=geom.buffer(0)
        minx,miny,maxx,maxy=geom.bounds
        envelope=max(1.0,(maxx-minx)*(maxy-miny))
        parts.append({
            'instanceId':f'{kid}-p{idx}','kitId':kid,'figure':template['kit'],
            'name':f'parte-{idx}','role':'base' if idx==0 else 'tapa','geom':geom,
            'shape':{'type':'simple_polygon','data':src['points']},'trimXmm':0.0,'trimYmm':0.0,
            'area':float(geom.area),'envelope':float(envelope),
        })
    area=sum(p['area'] for p in parts); env=sum(p['envelope'] for p in parts)
    return {'kitId':kid,'figure':template['kit'],'priority':priority,'parts':parts,
            'area':area,'envelope':env,'solidity':area/max(1.0,env)}


class LocalRepairRealTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fx=json.loads(FIXTURE.read_text(encoding='utf-8'))
        cls.templates=cls.fx['source']['kits']
        cls.ns=build_real_pipeline()

    def make_kits(self,count,template_index=None):
        kits=[]
        for i in range(count):
            idx=template_index if template_index is not None else i%len(self.templates)
            kits.append(kit_from_template(self.templates[idx],f'lr-{idx}-{i}',i))
        return kits

    def solve_base10(self,kits,seconds=4):
        started=time.monotonic()
        r=self.ns._run_sparrow(kits[:10],3.0,seconds,429,continuous=True)
        elapsed=time.monotonic()-started
        self.assertTrue(r.get('ok') and r.get('fits'),r)
        valid,cert=self.ns._validate_final_geometry(kits[:10],r)
        self.assertTrue(valid,cert)
        self.assertGreaterEqual(float(cert.get('minimumGapMmCertified') or 0),3.0)
        return r,elapsed

    def test_mixed_real_local_repair_never_damages_certified_base(self):
        kits=self.make_kits(11,None)
        base,base_seconds=self.solve_base10(kits,seconds=4)
        original=deepcopy(base)
        started=time.monotonic()
        grown=try_add_complete_local_repair(kits[:10],base,kits,3.0,
                                            validator=self.ns._validate_final_geometry,
                                            max_new_candidates=1,max_removed_kits=2)
        elapsed=time.monotonic()-started
        # La base recibida es inmutable: si 11 no entra, debe quedar byte-a-byte equivalente.
        self.assertEqual(base,original)
        self.assertLess(elapsed,55.0)
        if grown is not None:
            selected,result,newkit=grown
            self.assertEqual(len(selected),11)
            self.assertEqual(len(result.get('placements') or []),22)
            valid,cert=self.ns._validate_final_geometry(selected,result)
            self.assertTrue(valid,cert)
            self.assertGreaterEqual(float(cert.get('minimumGapMmCertified') or 0),3.0)
        print('LOCAL_REPAIR_MIXED='+json.dumps({
            'source_sha256':self.fx['source']['sha256'],'base_seconds':round(base_seconds,2),
            'repair_seconds':round(elapsed,2),'grew_to_11':grown is not None
        },separators=(',',':')))

    def test_same_real_heart_geometry_attempts_11_with_small_neighborhood(self):
        # Caso deliberadamente parecido a los especiales del negocio: muchas piezas del mismo modelo.
        # Elegimos el corazón real derivado porque su área permite 11 teóricamente en 1220x580.
        kits=self.make_kits(11,2)
        material_pct=100.0*sum(k['area'] for k in kits)/(1220.0*580.0)
        self.assertLess(material_pct,90.0)
        base,base_seconds=self.solve_base10(kits,seconds=5)
        started=time.monotonic()
        grown=try_add_complete_local_repair(kits[:10],base,kits,3.0,
                                            validator=self.ns._validate_final_geometry,
                                            max_new_candidates=1,max_removed_kits=2)
        elapsed=time.monotonic()-started
        self.assertLess(elapsed,60.0)
        if grown is not None:
            selected,result,_=grown
            valid,cert=self.ns._validate_final_geometry(selected,result)
            self.assertTrue(valid,cert)
            self.assertEqual(len(selected),11)
            self.assertEqual(len(result.get('placements') or []),22)
        print('LOCAL_REPAIR_SAME_REAL='+json.dumps({
            'template':self.templates[2]['kit'],'material_pct_11':round(material_pct,2),
            'base_seconds':round(base_seconds,2),'repair_seconds':round(elapsed,2),
            'grew_to_11':grown is not None
        },separators=(',',':')))


if __name__=='__main__':
    unittest.main(verbosity=2)
