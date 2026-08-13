import json
import pathlib
import time
import unittest
from itertools import combinations

ROOT=pathlib.Path(__file__).resolve().parents[1]
TESTS=ROOT/'tests'
import sys
if str(TESTS) not in sys.path: sys.path.insert(0,str(TESTS))

from test_pipeline_e2e_real import build_real_pipeline
from test_local_repair_real import kit_from_template

FIXTURE=ROOT/'tests'/'fixtures'/'real_geometry_derived.json'
PLATE_AREA=1220.0*580.0


def compact_score(k):
    # Menor huella y mayor solidez primero. No cambia prioridades: se usa sólo
    # para elegir entre kits del MISMO nivel de prioridad.
    env=float(k.get('envelope') or 1e18)
    area=max(1.0,float(k.get('area') or 1.0))
    solidity=max(.01,float(k.get('solidity') or .01))
    return env + 0.35*(env-area) + 15000.0*(1.0-solidity)


def candidate_sets_same_priority(kits, target=11, max_candidates=14):
    # Todos los kits recibidos pertenecen al mismo nivel de prioridad.
    # Generamos un portfolio chico, determinista y barato de combinaciones 11.
    if len(kits) < target: return []
    scored=sorted(kits,key=lambda k:(compact_score(k),str(k.get('figure')),str(k.get('kitId'))))
    out=[]; seen=set()
    def add(group,label):
        if len(group)!=target:return
        sig=tuple(sorted(str(k['kitId']) for k in group))
        if sig in seen:return
        seen.add(sig); out.append((label,list(group)))

    # Baseline real: primeras 11 por orden de entrada.
    add(kits[:target],'baseline-first-11')
    # Candidata principal: las 11 de menor huella.
    add(scored[:target],'lowest-footprint-11')
    # Ventanas compactas para no casarnos con una sola métrica.
    for off in range(1,min(5,len(scored)-target+1)):
        add(scored[off:off+target],f'footprint-window-{off}')

    # Mantener 8 compactas y variar las 3 restantes entre las siguientes 8.
    anchors=scored[:8]
    tail=scored[8:min(len(scored),16)]
    ranked_tail=sorted(combinations(tail,3),key=lambda c:sum(compact_score(k) for k in c))
    for idx,combo in enumerate(ranked_tail[:8]):
        add(anchors+list(combo),f'8-anchor-combo-{idx}')
        if len(out)>=max_candidates:break
    return out[:max_candidates]


class PriorityAwareSelectorRealTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fx=json.loads(FIXTURE.read_text(encoding='utf-8'))
        cls.templates=cls.fx['source']['kits']
        cls.ns=build_real_pipeline()

    def pool(self, offset=0, count=16):
        # Pool realista: 16 pedidos de igual prioridad. Repite modelos reales del
        # SVG certificado para representar varios pedidos pendientes del mismo día.
        rows=[]
        for i in range(count):
            idx=(i+offset)%len(self.templates)
            k=kit_from_template(self.templates[idx],f'pa-{offset}-{i}',priority=1)
            k['priority']=1
            rows.append(k)
        return rows

    def solve(self, selected, seed, seconds=2.2):
        started=time.monotonic()
        r=self.ns._run_sparrow(selected,3.0,seconds,seed,continuous=True)
        elapsed=time.monotonic()-started
        valid=False; cert={}
        if r.get('ok') and r.get('fits'):
            valid,cert=self.ns._validate_final_geometry(selected,r)
        return {
            'valid':bool(valid),
            'gap':float(cert.get('minimumGapMmCertified') or 0),
            'strip':float(r.get('stripWidthMm') or 0),
            'elapsed':elapsed,
            'result':r,
        }

    def test_priority_aware_11_portfolio_real_geometry(self):
        summaries=[]; total_success=0; baseline_success=0
        for offset in range(4):
            kits=self.pool(offset)
            candidates=candidate_sets_same_priority(kits)
            self.assertGreaterEqual(len(candidates),6)
            rows=[]; best=None
            for ci,(label,selected) in enumerate(candidates):
                # Dos semillas cortas por candidata; detener apenas aparece 11 certificada.
                for seed in (429+ci*97,1701+ci*131):
                    s=self.solve(selected,seed)
                    rows.append({'label':label,'seed':seed,'valid':s['valid'],
                                 'gap':round(s['gap'],4),'strip':round(s['strip'],2),
                                 'elapsed':round(s['elapsed'],2),
                                 'material_pct':round(100.0*sum(k['area'] for k in selected)/PLATE_AREA,2)})
                    if label=='baseline-first-11' and s['valid']:
                        baseline_success+=1
                    if s['valid']:
                        best=(label,selected,s)
                        break
                if best: break
            if best:
                total_success+=1
            summaries.append({'offset':offset,'success':best is not None,
                              'winner':best[0] if best else None,'runs':rows})

        print('PRIORITY_AWARE_11='+json.dumps({
            'source_sha256':self.fx['source']['sha256'],
            'cases':4,'successes':total_success,'baseline_seed_successes':baseline_success,
            'results':summaries
        },separators=(',',':')))

        # Este test no inventa éxito. Lo que sí exige es seguridad: cualquier
        # éxito debe ser certificado con gap >=3 y el portfolio debe terminar.
        for case in summaries:
            for row in case['runs']:
                self.assertLess(row['elapsed'],4.5,row)
                if row['valid']:
                    self.assertGreaterEqual(row['gap'],3.0,row)
                    self.assertLessEqual(row['strip'],1220.5,row)


if __name__=='__main__':unittest.main(verbosity=2)
