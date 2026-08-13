import importlib.util
import pathlib
import sys
import types
import unittest
from flask import Flask, jsonify
from shapely.geometry import Polygon

ROOT = pathlib.Path(__file__).resolve().parents[1]


class Clock:
    def __init__(self): self.t = 0.0
    def time(self): return self.t
    def add(self, seconds): self.t += float(seconds)


def load_module(filename, module_name, ns, extra_modules=None):
    old_ns = sys.modules.get('nest_sparrow')
    sys.modules['nest_sparrow'] = ns
    old_extra = {}
    for name, mod in (extra_modules or {}).items():
        old_extra[name] = sys.modules.get(name)
        sys.modules[name] = mod
    try:
        spec = importlib.util.spec_from_file_location(module_name, ROOT / filename)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod
    finally:
        if old_ns is None: sys.modules.pop('nest_sparrow', None)
        else: sys.modules['nest_sparrow'] = old_ns
        for name, old in old_extra.items():
            if old is None: sys.modules.pop(name, None)
            else: sys.modules[name] = old


def make_selector_ns(clock, behavior):
    ns = types.ModuleType('nest_sparrow')
    ns.app = Flask('selector-test')
    ns.PLATE_WIDTH_MM = 1220.0
    ns.PLATE_HEIGHT_MM = 580.0
    ns._n = lambda v, d: float(d if v is None else v)
    ns._priority = lambda k: int(k.get('priority', 1))
    ns._prep_kit = lambda k, w, h: dict(k)
    calls = []
    def run(selected, gap, budget, seed, continuous=False, extra_part=None):
        calls.append((len(selected), float(budget), seed, bool(continuous)))
        clock.add(budget)
        return behavior(len(selected), len(calls), budget)
    ns._run_sparrow = run
    def result_payload(selected, label, result, kits, rejected, attempts, started, extra_part=None):
        return jsonify({'ok': True,'completeFigures': len(selected),'density': result.get('density',70),'stripWidthMm': result.get('stripWidthMm',1200),'placements': result.get('placements',[]),'minimumGapMm':3.2,'productionCertificate':{'minimumGapMmCertified':3.2}})
    ns._result_payload=result_payload; ns.nest_sparrow=lambda:None; ns._calls=calls
    return ns


def kits(n=20):
    return [{'kitId':f'k{i}','figure':f'fig-{i}','priority':1,'envelope':100+i,'area':80+i,'solidity':.8} for i in range(n)]


class SelectorBudgetTests(unittest.TestCase):
    def call_selector(self, behavior):
        clock=Clock(); ns=make_selector_ns(clock,behavior)
        mod=load_module('intelligent_selector_runtime.py','selector_runtime_test',ns)
        mod.time=types.SimpleNamespace(time=clock.time)
        payload={'widthCm':122,'heightCm':58,'gapCm':.3,'kits':kits(24)}
        with ns.app.test_request_context(json=payload):
            response=mod.intelligent_nest()
            if isinstance(response,tuple): resp,status=response[0],response[1]
            else: resp,status=response,getattr(response,'status_code',200)
            return mod,ns,clock,resp.get_json(),status

    def test_no_fit_stops_under_hard_base_limit(self):
        def behavior(size,call,budget):
            return {'ok':True,'fits':False,'placedParts':max(0,size*2-2),'expectedParts':size*2,'density':68,'stripWidthMm':1220}
        mod,ns,clock,data,status=self.call_selector(behavior)
        self.assertEqual(status,422)
        self.assertLessEqual(clock.t,mod.BASE_SEARCH_SECONDS)
        self.assertLessEqual(sum(c[1] for c in ns._calls),55.0)
        self.assertEqual(data['hardBaseLimitSeconds'],55)
        self.assertLessEqual(len(ns._calls),mod.BASE_CANDIDATES)

    def test_valid_10_is_never_lost_when_growth_fails(self):
        def behavior(size,call,budget):
            if size==10 and call==1:return {'ok':True,'fits':True,'placedParts':20,'expectedParts':20,'density':73.4,'stripWidthMm':1197,'placements':[]}
            return {'ok':True,'fits':False,'placedParts':size*2-1,'expectedParts':size*2,'density':73,'stripWidthMm':1210}
        mod,ns,clock,data,status=self.call_selector(behavior)
        self.assertEqual(status,200); self.assertEqual(data['completeFigures'],10); self.assertTrue(data['protectedBase10']); self.assertFalse(data['improvedAbove10']); self.assertLessEqual(clock.t,mod.MAX_SECONDS)

    def test_11_is_kept_if_found_and_12_failure_does_not_downgrade(self):
        def behavior(size,call,budget):
            if size==10:return {'ok':True,'fits':True,'placedParts':20,'expectedParts':20,'density':73.4,'stripWidthMm':1197,'placements':[]}
            if size==11 and call==2:return {'ok':True,'fits':True,'placedParts':22,'expectedParts':22,'density':78,'stripWidthMm':1200,'placements':[]}
            return {'ok':True,'fits':False,'placedParts':size*2-1,'expectedParts':size*2,'density':78,'stripWidthMm':1210}
        mod,ns,clock,data,status=self.call_selector(behavior)
        self.assertEqual(status,200); self.assertEqual(data['completeFigures'],11); self.assertTrue(data['improvedAbove10']); self.assertLessEqual(clock.t,mod.MAX_SECONDS)


class GrowthGuardTests(unittest.TestCase):
    def make_ns_and_fill(self,validator_accept=True,grow_once=True):
        ns=types.ModuleType('nest_sparrow'); ns.app=Flask('growth-test'); ns.PLATE_WIDTH_MM=1220.; ns.PLATE_HEIGHT_MM=580.; ns._n=lambda v,d:float(d if v is None else v); ns._priority=lambda k:int(k.get('priority',1)); ns._prep_kit=lambda k,w,h:dict(k)
        base=[]
        for i in range(10): base += [{'kitId':f'k{i}','instanceId':f'k{i}-a'},{'kitId':f'k{i}','instanceId':f'k{i}-b'}]
        ns.nest_sparrow=lambda:jsonify({'ok':True,'completeFigures':10,'partialExtra':False,'density':73.4,'stripWidthMm':1197,'placements':base,'productionCertificate':{'minimumGapMmCertified':3.18}})
        ns._validate_final_geometry=lambda selected,result:(validator_accept,{'minimumGapMmCertified':3.2,'collisionCount':0,'outsidePlateCount':0} if validator_accept else {'reason':'gap geométrico menor a 3 mm','gapMm':2.9})
        fill=types.ModuleType('fixed_hole_fill'); state={'done':False}
        def grow(selected,result,allkits,gap,max_candidates=24):
            if not grow_once or state['done']:return None
            state['done']=True; extra=next(k for k in allkits if k['kitId'] not in {x['kitId'] for x in selected}); out=dict(result); out['placements']=list(result.get('placements',[]))+[{'kitId':extra['kitId'],'instanceId':extra['kitId']+'-a'},{'kitId':extra['kitId'],'instanceId':extra['kitId']+'-b'}]; out['density']=78
            return selected+[extra],out,extra
        fill.try_add_complete_fixed=grow; return ns,fill
    def test_rejected_growth_returns_exact_base_10(self):
        ns,fill=self.make_ns_and_fill(False,True); mod=load_module('growth_guard_runtime.py','growth_guard_reject_test',ns,{'fixed_hole_fill':fill})
        with ns.app.test_request_context(json={'widthCm':122,'heightCm':58,'gapCm':.3,'kits':kits(14)}): data=mod.nest_with_guarded_growth().get_json()
        self.assertEqual(data['completeFigures'],10); self.assertEqual(data['density'],73.4)
    def test_accepted_growth_returns_11_never_zero(self):
        ns,fill=self.make_ns_and_fill(True,True); mod=load_module('growth_guard_runtime.py','growth_guard_accept_test',ns,{'fixed_hole_fill':fill})
        with ns.app.test_request_context(json={'widthCm':122,'heightCm':58,'gapCm':.3,'kits':kits(14)}): data=mod.nest_with_guarded_growth().get_json()
        self.assertEqual(data['completeFigures'],11); self.assertTrue(data['base10Preserved']); self.assertGreaterEqual(data['minimumGapMm'],3.0)


class PracticalOccupancyTests(unittest.TestCase):
    def make_ns(self,geom):
        ns=types.ModuleType('nest_sparrow'); ns.app=Flask('occ-test'); ns.PLATE_WIDTH_MM=100.; ns.PLATE_HEIGHT_MM=100.; ns._n=lambda v,d:float(d if v is None else v); ns._priority=lambda k:1; ns._prep_kit=lambda k,w,h:{'parts':[{'instanceId':'p1','geom':geom}]}; ns.nest_sparrow=lambda:jsonify({'ok':True}); return ns
    def test_gap_aware_occupancy_exceeds_material_area(self):
        geom=Polygon([(20,20),(80,20),(80,80),(20,80)],holes=[[(47,47),(53,47),(53,53),(47,53)]]); ns=self.make_ns(geom); mod=load_module('practical_occupancy_runtime.py','occ_test_small_hole',ns); metrics=mod._metrics({'placements':[{'instanceId':'p1','xCm':0,'yCm':0,'angle':0}]},{'widthCm':10,'heightCm':10,'gapCm':.6,'kits':[{'kitId':'k1'}]}); self.assertIsNotNone(metrics); self.assertGreater(metrics['practicalOccupancyPct'],metrics['materialDensityPct']); self.assertAlmostEqual(metrics['occupancyGapMm'],6.0); self.assertLess(metrics['practicalOccupancyPct'],100.0)
    def test_large_internal_hole_remains_partly_free(self):
        geom=Polygon([(10,10),(90,10),(90,90),(10,90)],holes=[[(35,35),(65,35),(65,65),(35,65)]]); ns=self.make_ns(geom); mod=load_module('practical_occupancy_runtime.py','occ_test_large_hole',ns); metrics=mod._metrics({'placements':[{'instanceId':'p1','xCm':0,'yCm':0,'angle':0}]},{'widthCm':10,'heightCm':10,'gapCm':.6,'kits':[{'kitId':'k1'}]}); self.assertGreater(metrics['practicalFreePct'],0.0); self.assertGreater(metrics['largestFreeRegionPct'],0.0); self.assertGreater(metrics['practicalOccupancyPct'],metrics['materialDensityPct'])


class PipelineContractTests(unittest.TestCase):
    def test_cors_import_order_keeps_safety_before_selector_and_occupancy_last(self):
        text=(ROOT/'cors_app.py').read_text(encoding='utf-8'); order=['import production_safety_runtime','import intelligent_selector_runtime','import growth_guard_runtime','import practical_occupancy_runtime']; positions=[text.index(x) for x in order]; self.assertEqual(positions,sorted(positions))
    def test_selector_declares_expected_hard_limits(self):
        text=(ROOT/'intelligent_selector_runtime.py').read_text(encoding='utf-8')
        self.assertIn('BASE_SEARCH_SECONDS=55',text); self.assertIn('MAX_SECONDS=90',text); self.assertIn('BASE_CANDIDATES=7',text); self.assertIn('GROWTH11_CANDIDATES=10',text); self.assertIn("'protectedBase10':True",text)


if __name__=='__main__': unittest.main(verbosity=2)
