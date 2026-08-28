"""Lab-only enhancement learned from the 2026-08-28 human correction benchmarks.

Ranks complete BASE/TAPA kits that can exploit long narrow residual strips without
hard-coding any figure name. It also gives those candidates a small focused Sparrow
retry budget before the solver gives up on a residual cavity. Sparrow remains the
geometry authority and the independent validator still decides whether a result is safe.
"""
import clean_lab_v4 as v4


def _part_dims(part):
    try:
        minx,miny,maxx,maxy=part['geom'].bounds
        return max(0.0,float(maxx-minx)),max(0.0,float(maxy-miny))
    except Exception:
        return 0.0,0.0


def strip_profile(kit,gap_mm=None):
    gap=float(v4.GAP_MM if gap_mm is None else gap_mm)
    dims=[_part_dims(p) for p in (kit.get('parts') or [])]
    dims=[(w,h) for w,h in dims if w>0 and h>0]
    if not dims:
        return {'fitsVertical':False,'fitsHorizontal':False,'score':1e18}

    # Each component may rotate independently. For a vertical strip we minimize
    # thickness and stack the long dimensions along plate height. Horizontal is
    # the symmetric case along plate width.
    narrow=[min(w,h) for w,h in dims]
    long=[max(w,h) for w,h in dims]
    seams=max(0,len(dims)-1)*gap

    vertical_width=max(narrow)
    vertical_height=sum(long)+seams
    horizontal_height=max(narrow)
    horizontal_width=sum(long)+seams

    fits_v=vertical_height <= v4.PLATE_HEIGHT_MM + 0.5
    fits_h=horizontal_width <= v4.PLATE_WIDTH_MM + 0.5

    v_fill=vertical_height/max(1.0,v4.PLATE_HEIGHT_MM)
    h_fill=horizontal_width/max(1.0,v4.PLATE_WIDTH_MM)
    v_score=(vertical_width + abs(1.0-v_fill)*42.0) if fits_v else 1e12+vertical_height
    h_score=(horizontal_height + abs(1.0-h_fill)*42.0) if fits_h else 1e12+horizontal_width
    score=min(v_score,h_score)
    orientation='vertical' if v_score<=h_score else 'horizontal'

    return {
        'fitsVertical':fits_v,
        'fitsHorizontal':fits_h,
        'verticalWidthMm':round(vertical_width,3),
        'verticalHeightMm':round(vertical_height,3),
        'horizontalWidthMm':round(horizontal_width,3),
        'horizontalHeightMm':round(horizontal_height,3),
        'orientation':orientation,
        'score':float(score),
    }


def _is_strong_strip_candidate(kit):
    p=strip_profile(kit)
    part_count=len([x for x in (kit.get('parts') or []) if _part_dims(x)!=(0.0,0.0)])

    # Two different real plates exposed two strip families:
    # 1) long pieces that consume most of a ~100 mm corridor;
    # 2) compact complete BASE/TAPA kits that can stack inside the same corridor.
    # The old rule only recognized family (1), so a real 72 x 120 mm pair could be
    # skipped even though both components fit in the untouched right-side strip.
    long_vertical=(p['fitsVertical'] and p.get('verticalWidthMm',1e9)<=145.0 and
                   p.get('verticalHeightMm',0)>=0.62*v4.PLATE_HEIGHT_MM)
    long_horizontal=(p['fitsHorizontal'] and p.get('horizontalHeightMm',1e9)<=145.0 and
                     p.get('horizontalWidthMm',0)>=0.62*v4.PLATE_WIDTH_MM)

    compact_vertical=(part_count>=2 and p['fitsVertical'] and
                      p.get('verticalWidthMm',1e9)<=95.0 and
                      0.20*v4.PLATE_HEIGHT_MM<=p.get('verticalHeightMm',0)<=0.58*v4.PLATE_HEIGHT_MM)
    compact_horizontal=(part_count>=2 and p['fitsHorizontal'] and
                        p.get('horizontalHeightMm',1e9)<=95.0 and
                        0.20*v4.PLATE_WIDTH_MM<=p.get('horizontalWidthMm',0)<=0.58*v4.PLATE_WIDTH_MM)
    return bool(long_vertical or long_horizontal or compact_vertical or compact_horizontal)


_original_residual=v4._residual_candidates
_original_rank=v4._rank_remaining
_original_attempt_rows=v4._attempt_rows


def _strip_ranked_remaining(selected,kits):
    used={k.get('kitId') for k in selected}
    remain=[k for k in kits if k.get('kitId') not in used]
    ranked=[]
    for k in remain:
        p=strip_profile(k)
        if p['fitsVertical'] or p['fitsHorizontal']:
            # Complete compact kits get first crack at the residual pass. This is
            # still generic geometry-only ranking; no product name is special-cased.
            compact_bonus=-28.0 if _is_strong_strip_candidate(k) and len(k.get('parts') or [])>=2 else 0.0
            ranked.append((p['score']+compact_bonus,int(k.get('priority') or 999999),float(k.get('envelope') or 1e18),k))
    ranked.sort(key=lambda row:(row[0],row[1],row[2]))
    return [row[3] for row in ranked]


def enhanced_residual_candidates(selected,kits,limit=28):
    strip_rows=_strip_ranked_remaining(selected,kits)
    base_rows=_original_residual(selected,kits,max(limit,28))
    return v4._interleave([strip_rows,base_rows],limit)


def enhanced_rank_remaining(selected,kits):
    strip_rows=_strip_ranked_remaining(selected,kits)
    base_rows=_original_rank(selected,kits)
    return v4._interleave([base_rows,strip_rows])


def enhanced_attempt_rows(rows,attempts,phase,label,seed,seconds,continuous):
    """Give likely strip-fit +1 candidates extra continuous-rotation tries.

    Activates only during the residual +1 pass and only for geometry that is either
    a long narrow strip consumer or a compact complete kit. It never relaxes gap,
    collision or edge rules; Sparrow remains authoritative.
    """
    first=_original_attempt_rows(rows,attempts,phase,label,seed,seconds,continuous)
    if first.get('ok') and first.get('fits'):
        return first
    if phase!='residual-cavity-rescue' or not rows:
        return first
    cand=rows[-1]
    if not _is_strong_strip_candidate(cand):
        return first

    kid=str(cand.get('kitId') or cand.get('figure') or '')
    salt=sum((idx+1)*ord(ch) for idx,ch in enumerate(kid)) % 10007
    retry_seconds=max(5,min(9,int(seconds or 6)+2))
    best=first
    for extra_idx,extra_seed in enumerate((53003+salt,73009+salt,93001+salt)):
        result=v4.core._run_sparrow(rows,v4.GAP_MM,retry_seconds,extra_seed,continuous=True)
        v4._attempt(attempts,'strip-cavity-focused',f'{label} · retry {extra_idx+1}',rows,result,extra_seed,True)
        if result.get('ok') and result.get('fits'):
            return result
        best=v4._best_same_set(best,result)
    return best


v4._residual_candidates=enhanced_residual_candidates
v4._rank_remaining=enhanced_rank_remaining
v4._attempt_rows=enhanced_attempt_rows
