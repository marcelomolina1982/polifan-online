"""Workshop-derived topology seeds for TVT Revolutionary V8.

These are not hard-coded final answers: they are spatial topologies measured from
layouts that were actually achieved by hand in the workshop.  V8 maps incoming
prepared geometry onto the topology, rebuilds placements from the *real* incoming
shapes, and accepts the seed only if the independent >=3 mm production certifier
passes it.  If geometry differs, the seed is simply rejected and the normal search
continues.
"""
from __future__ import annotations

from shapely import affinity

from revolutionary import ensemble_v4 as v4

PLATE_W=1220.0
PLATE_H=580.0

# Measured bounding-box anchors (mm) from the user's 12-complete manual
# "Palabra Mama Imprenta" layout.  A/B are the two parts of each complete kit.
MAMA_A=[
 (5.356,6.275),(6.864,187.748),(5.514,378.399),
 (292.087,6.192),(293.595,187.665),(292.246,378.314),
 (580.872,6.226),(582.380,187.699),(581.030,378.349),
 (868.405,9.327),(869.916,190.801),(868.564,381.450),
]
MAMA_B=[
 (6.704,89.549),(8.213,271.023),(6.862,461.671),
 (293.436,89.466),(294.944,270.939),(293.592,461.589),
 (582.221,89.500),(583.729,270.973),(582.377,461.624),
 (869.757,92.607),(871.265,274.079),(869.916,464.730),
]
MAMA_EXPECTED=((280.212,95.189),(280.001,94.472))

# Measured anchors from the difficult manual 5 balls + 5 roses plate.
BALL_SLOTS=[
 (6.238,195.895,190.000,190.000),(5.935,3.668,190.001,189.999),
 (4.675,387.871,190.001,189.999),(200.023,196.235,190.000,190.000),
 (199.720,4.008,190.001,189.999),(392.255,388.181,190.000,190.000),
 (392.324,3.887,190.000,190.000),(392.483,195.954,190.001,189.999),
 (586.044,388.993,190.000,190.000),(198.460,388.213,190.001,189.999),
]
ROSE_SLOTS=[
 (586.814,161.445,175.679,209.298),(584.168,21.830,175.738,209.250),
 (755.676,144.270,175.679,209.298),(753.028,4.655,175.738,209.250),
 (923.840,4.421,174.655,217.788),(1043.818,32.082,174.946,218.152),
 (760.164,351.375,174.937,218.147),(905.804,356.603,173.105,221.326),
 (1042.337,355.735,173.589,220.488),(963.898,212.214,220.606,173.459),
]


def _dims(part):
    minx,miny,maxx,maxy=part['geom'].bounds
    return maxx-minx,maxy-miny


def _close(a,b,tol):
    return abs(float(a)-float(b))<=float(tol)


def _rotation_for_slot(part,sw,sh):
    w,h=_dims(part)
    direct=abs(w-sw)+abs(h-sh)
    swapped=abs(h-sw)+abs(w-sh)
    return 90.0 if swapped+1e-6<direct else 0.0


def _placement(part,slot):
    sx,sy,sw,sh=slot
    angle=_rotation_for_slot(part,sw,sh)
    rg=affinity.rotate(part['geom'],angle,origin=(0,0),use_radians=False)
    minx,miny,maxx,maxy=rg.bounds
    tx=float(sx)-float(minx);ty=float(sy)-float(miny)
    return {
        'instanceId':part['instanceId'],'kitId':part['kitId'],'figure':part['figure'],
        'name':part['name'],'role':part['role'],'xCm':tx/10.0,'yCm':ty/10.0,
        'angle':angle,'trimXCm':float(part.get('trimXmm') or 0)/10.0,
        'trimYCm':float(part.get('trimYmm') or 0)/10.0,'partialExtra':False,
    }


def _row(kits,placements,label):
    candidate=type('V8TopologyCandidate',(),{'label':label,'kits':kits})()
    density=100.0*sum(float(k.get('area') or 0) for k in kits)/(PLATE_W*PLATE_H)
    result={'ok':True,'fits':True,'placements':placements,'density':density,'stripWidthMm':PLATE_W,'elapsedSeconds':0.0}
    ok,cert=v4._certified(kits,result)
    return {'candidate':candidate,'seed':'workshop-topology','result':result,'certified':ok,'certificate':cert}


def mama_seed(prepared_kits):
    """Reconstruct the 12-complete interlocking Mama topology when geometry matches."""
    if len(prepared_kits)<12:return None
    candidates=[]
    for k in prepared_kits:
        parts=list(k.get('parts') or [])
        if len(parts)!=2:continue
        d=[_dims(p) for p in parts]
        # Each Mama part is about 280 x 95 mm.  Keep tolerance deliberately tight
        # enough not to apply this topology to unrelated words/shapes.
        if all(265<=w<=295 and 82<=h<=108 for w,h in d):candidates.append(k)
    if len(candidates)<12:return None
    kits=candidates[:12];placements=[]
    for i,k in enumerate(kits):
        parts=list(k['parts'])
        # Match the two near-identical variants to A/B by closest measured dimensions.
        def cost(p,expected):
            w,h=_dims(p);return abs(w-expected[0])+abs(h-expected[1])
        if cost(parts[0],MAMA_EXPECTED[0])+cost(parts[1],MAMA_EXPECTED[1]) <= cost(parts[1],MAMA_EXPECTED[0])+cost(parts[0],MAMA_EXPECTED[1]):
            pa,pb=parts
        else:pb,pa=parts
        ax,ay=MAMA_A[i];bx,by=MAMA_B[i]
        placements.append(_placement(pa,(ax,ay,*MAMA_EXPECTED[0])))
        placements.append(_placement(pb,(bx,by,*MAMA_EXPECTED[1])))
    return _row(kits,placements,'workshop-topology-mama-12')


def ball_rose_seed(prepared_kits):
    """Reconstruct the difficult 5-ball + 5-rose workshop topology when present."""
    balls=[];roses=[]
    for k in prepared_kits:
        parts=list(k.get('parts') or [])
        if len(parts)!=2:continue
        dims=[_dims(p) for p in parts]
        if all(176<=w<=204 and 176<=h<=204 and abs(w-h)<=12 for w,h in dims):
            balls.append(k);continue
        # Rose parts are roughly 170-225 mm by 170-225 mm, distinctly non-square
        # in at least one orientation.
        if all(158<=w<=232 and 158<=h<=232 for w,h in dims) and any(abs(w-h)>=20 for w,h in dims):
            roses.append(k)
    if len(balls)<5 or len(roses)<5:return None
    kits=balls[:5]+roses[:5];placements=[]
    ball_parts=[p for k in balls[:5] for p in k['parts']]
    rose_parts=[p for k in roses[:5] for p in k['parts']]
    for p,slot in zip(ball_parts,BALL_SLOTS):placements.append(_placement(p,slot))
    for p,slot in zip(rose_parts,ROSE_SLOTS):placements.append(_placement(p,slot))
    return _row(kits,placements,'workshop-topology-ball5-rose5')


def workshop_seeds(prepared_kits):
    out=[]
    for fn in (mama_seed,ball_rose_seed):
        try:r=fn(prepared_kits)
        except Exception:r=None
        if r is not None:out.append(r)
    return out
