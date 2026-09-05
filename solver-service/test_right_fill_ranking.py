import time
import unittest
from unittest.mock import patch

from shapely.geometry import box

import sa_runtime_wrapper as runtime


def part(instance_id,width,height):
    return {'instanceId':instance_id,'geom':box(0,0,width,height)}


def kit(kit_id,width,height,priority=1):
    return {'kitId':kit_id,'figure':kit_id,'priority':priority,'parts':[part(kit_id+'-p0',width,height)]}


class RightFillRankingTests(unittest.TestCase):
    def test_prefers_complete_kit_that_fits_observed_right_strip(self):
        selected=[kit('base',1000,100)]
        base={'placements':[{'instanceId':'base-p0','xCm':0,'yCm':0,'angle':0}]}
        too_wide=kit('wide',260,80,1)
        strip_fit=kit('strip-fit',190,160,2)

        ranked,free=runtime._right_fill_candidates(selected,[*selected,too_wide,strip_fit],base)

        self.assertAlmostEqual(free,211.0)
        self.assertEqual(ranked[0]['kitId'],'strip-fit')

    def test_sweep_keeps_trying_after_invalid_candidate(self):
        selected=[kit('base',1000,100)]
        base={'placements':[{'instanceId':'base-p0','kitId':'base','xCm':0,'yCm':0,'angle':0}]}
        first=kit('first',180,90,1)
        second=kit('second',190,80,2)
        calls=[]

        def fake_sparrow(rows,*args,**kwargs):
            calls.append(rows[-1]['kitId'])
            if len(calls)==1:return {'ok':False,'fits':False,'placements':[]}
            return {'ok':True,'fits':True,'placements':base['placements']+[{'instanceId':'second-p0','kitId':'second','xCm':101.0,'yCm':0,'angle':0}]}

        with patch.object(runtime.v4.core,'_run_sparrow',side_effect=fake_sparrow), \
             patch.object(runtime,'_certify',return_value=(True,'ok')), \
             patch.object(runtime.v4,'_attempt'):
            found,diagnostics=runtime._right_fill_sweep(selected,[*selected,first,second],base,[],time.time()+20)

        self.assertIsNotNone(found)
        self.assertEqual(calls,['first','second'])
        self.assertTrue(diagnostics[-1]['certified'])
        self.assertEqual(diagnostics[-1]['observedRightFreeMm'],211.0)


if __name__=='__main__':
    unittest.main()
