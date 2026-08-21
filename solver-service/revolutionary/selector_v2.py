"""TVT geometry-aware portfolio selector V2.

Experimental laboratory code. It does not touch production inventory or the
stable solver. The selector preserves an urgent core, then diversifies the
remaining slots using real geometry instead of only list position.
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass


@dataclass
class Portfolio:
    label: str
    kits: list


def _kid(k):
    return str(k.get('kitId') or '')


def _priority(k):
    try:
        return float(k.get('priority') or 999999)
    except Exception:
        return 999999.0


def _dims(k):
    widths=[]; heights=[]
    for p in k.get('parts') or []:
        g=p.get('geom')
        if g is None or getattr(g,'is_empty',True):
            continue
        minx,miny,maxx,maxy=g.bounds
        widths.append(maxx-minx); heights.append(maxy-miny)
    if not widths:
        env=max(1.0,float(k.get('envelope') or 1.0))
        side=math.sqrt(env)
        return side,side
    return max(widths),max(heights)


def signature(k):
    area=max(1.0,float(k.get('area') or 1.0))
    env=max(area,float(k.get('envelope') or area))
    solidity=max(0.01,min(1.0,float(k.get('solidity') or area/env)))
    w,h=_dims(k)
    long=max(w,h); short=max(1.0,min(w,h))
    aspect=long/short
    return {
        'area':area,'envelope':env,'solidity':solidity,
        'w':w,'h':h,'aspect':aspect,'waste':max(0.0,env-area),
    }


def _unique(rows):
    out=[]; seen=set()
    for k in rows:
        key=_kid(k)
        if not key or key in seen:
            continue
        seen.add(key); out.append(k)
    return out


def _rankers():
    return {
        'compact': lambda k: (signature(k)['envelope'], -signature(k)['solidity'], -signature(k)['area'], _priority(k)),
        'dense': lambda k: (-signature(k)['solidity'], signature(k)['envelope'], _priority(k)),
        'area': lambda k: (-signature(k)['area'], -signature(k)['solidity'], _priority(k)),
        'small-fill': lambda k: (signature(k)['area'], signature(k)['envelope'], _priority(k)),
        'concave': lambda k: (signature(k)['solidity'], -signature(k)['area'], _priority(k)),
        'elongated': lambda k: (-signature(k)['aspect'], signature(k)['area'], _priority(k)),
        'squarish': lambda k: (abs(signature(k)['aspect']-1.0), -signature(k)['area'], _priority(k)),
    }


def _balance_score(rows):
    """Cheap proxy for geometrically complementary kits.

    Rewards area while penalizing a portfolio made only of similarly elongated
    pieces. This is selection guidance only; Sparrow remains the geometric judge.
    """
    if not rows:
        return -1e18
    sig=[signature(k) for k in rows]
    area=sum(s['area'] for s in sig)
    aspects=[s['aspect'] for s in sig]
    mean=sum(aspects)/len(aspects)
    variance=sum((a-mean)**2 for a in aspects)/len(aspects)
    solids=sum(s['solidity'] for s in sig)/len(sig)
    small=sum(1 for s in sig if s['area'] < area/len(sig)*0.72)
    large=sum(1 for s in sig if s['area'] > area/len(sig)*1.28)
    mix_bonus=min(small,large)*0.025*area
    return area*(0.78+0.22*solids) + mix_bonus + min(2.0,variance)*0.012*area


def portfolios(kits,target,limit=36,seed=20260821):
    if len(kits)<target:
        return []
    ordered=sorted(kits,key=lambda k:(_priority(k),str(k.get('date') or ''),_kid(k)))

    # Preserve most urgent work, but leave enough slots for geometry to matter.
    flex=max(3,min(6,target//3+1))
    core_count=max(5,target-flex)
    core=ordered[:core_count]
    pool=_unique(ordered[core_count:min(len(ordered),48)])
    slots=target-len(core)
    if slots<0 or len(pool)<slots:
        return [Portfolio('priority-pure',ordered[:target])]

    out=[]; seen=set()
    def add(label,tail):
        rows=_unique(core+list(tail))
        if len(rows)!=target:
            return
        sig=tuple(sorted(_kid(k) for k in rows))
        if sig in seen:
            return
        seen.add(sig); out.append(Portfolio(label,rows))

    add('priority-pure',ordered[core_count:target])
    for name,key in _rankers().items():
        ranked=sorted(pool,key=key)
        add(name,ranked[:slots])
        for off in range(1,min(8,max(0,len(ranked)-slots))+1):
            add(f'{name}-window-{off}',ranked[off:off+slots])
            if len(out)>=limit:
                return out[:limit]

    # Geometry-aware deterministic random neighbourhoods. We sample a modest
    # horizon, score complete portfolios, then keep only the strongest diverse
    # combinations. This avoids combinatorial explosion.
    rng=random.Random(seed+target*1009)
    horizon=pool[:min(28,len(pool))]
    sampled=[]
    for i in range(min(180, max(40,limit*5))):
        if len(horizon)<slots:
            break
        tail=rng.sample(horizon,slots)
        rows=_unique(core+tail)
        if len(rows)!=target:
            continue
        sampled.append((_balance_score(rows),i,tail))
    sampled.sort(key=lambda x:(-x[0],x[1]))
    for _,i,tail in sampled:
        add(f'geometry-mix-{i}',tail)
        if len(out)>=limit:
            break
    return out[:limit]
