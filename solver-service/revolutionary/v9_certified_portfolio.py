"""Certification gate for TVT Revolutionary V9 portfolio.

External optimizers are proposal engines only. A candidate can compete with the
incumbent only when it contains complete kits and passes the independent TVT
geometry certificate (>=3 mm, no overlap, inside 1220x580).
"""
from __future__ import annotations
from dataclasses import dataclass
from typing import Any

MIN_GAP_MM=3.0
PLATE_W_MM=1220.0
PLATE_H_MM=580.0

@dataclass
class CertifiedCandidate:
    source:str
    strategy:str
    result:dict[str,Any]
    complete_kits:int
    minimum_gap_mm:float
    density:float

    @property
    def score(self):
        return (self.complete_kits,self.minimum_gap_mm,self.density)


def complete_kit_ids(placements:list[dict[str,Any]], prepared_kits:list[dict[str,Any]])->list[str]:
    expected={str(k.get('kitId')):{str(p.get('instanceId')) for p in (k.get('parts') or [])} for k in prepared_kits}
    actual:dict[str,set[str]]={}
    duplicates:set[str]=set()
    seen:set[str]=set()
    for p in placements or []:
        kid=str(p.get('kitId') or '')
        iid=str(p.get('instanceId') or '')
        if not kid or not iid:continue
        if iid in seen:duplicates.add(kid)
        seen.add(iid);actual.setdefault(kid,set()).add(iid)
    return [kid for kid,want in expected.items() if kid not in duplicates and want and actual.get(kid,set())==want]


def certify_external_candidate(candidate:dict[str,Any],prepared_kits:list[dict[str,Any]],certifier)->CertifiedCandidate|None:
    """certifier must return collisionCount/outsidePlateCount/minimumGapMmCertified.

    Keeping the certifier injected prevents U-Nesting (or any future optimizer)
    from ever becoming its own safety authority.
    """
    placements=list(candidate.get('placements') or [])
    complete=complete_kit_ids(placements,prepared_kits)
    if not complete:return None
    cert=certifier(placements)
    gap=float(cert.get('minimumGapMmCertified') or 0.0)
    if int(cert.get('collisionCount') or 0)!=0:return None
    if int(cert.get('outsidePlateCount') or 0)!=0:return None
    if gap+1e-9<MIN_GAP_MM:return None
    result=dict(candidate);result['productionCertificate']=cert;result['completeFigures']=len(complete);result['minimumGapMm']=gap;result['ok']=True
    return CertifiedCandidate(str(candidate.get('source') or 'external'),str(candidate.get('strategy') or 'unknown'),result,len(complete),gap,float(candidate.get('density') or 0.0))


def choose_best(incumbent:dict[str,Any], certified:list[CertifiedCandidate])->dict[str,Any]:
    base_count=int(incumbent.get('completeFigures') or 0);base_gap=float(incumbent.get('minimumGapMm') or 0.0);base_density=float(incumbent.get('density') or 0.0)
    best_score=(base_count,base_gap,base_density);best=incumbent
    for c in certified:
        if c.score>best_score:best_score=c.score;best=c.result
    return best
