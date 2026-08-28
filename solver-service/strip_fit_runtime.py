"""Generic residual-strip ranking for the isolated Polifan motor lab.

This does not special-case any figure. It derives a compact profile from the prepared
geometry of every BASE/TAPA kit and promotes kits whose components can share a
narrow vertical or horizontal residual strip.
"""
PLATE_WIDTH_MM = 1230.0
PLATE_HEIGHT_MM = 580.0
GAP_MM = 3.0


def _dims(part):
    geom = part.get('geom')
    if geom is not None and not getattr(geom, 'is_empty', True):
        minx, miny, maxx, maxy = geom.bounds
        return max(0.0, maxx-minx), max(0.0, maxy-miny)
    return 0.0, 0.0


def _kit_profile(kit):
    parts = list(kit.get('parts') or [])
    dims = [_dims(p) for p in parts]
    dims = [(w,h) for w,h in dims if w > 0 and h > 0]
    if not dims:
        return {'verticalWidth':1e18,'verticalLength':1e18,'horizontalHeight':1e18,'horizontalLength':1e18,'stripScore':1e18}

    # Each component may rotate independently. For a vertical residual strip, orient
    # each component so its narrow side becomes the strip width and stack lengths.
    narrow = [min(w,h) for w,h in dims]
    long = [max(w,h) for w,h in dims]
    vertical_width = max(narrow)
    vertical_length = sum(long) + GAP_MM*max(0,len(dims)-1)

    # Horizontal counterpart: same geometry, useful when a shallow band remains.
    horizontal_height = vertical_width
    horizontal_length = vertical_length

    v_over = max(0.0, vertical_length-PLATE_HEIGHT_MM)
    h_over = max(0.0, horizontal_length-PLATE_WIDTH_MM)
    # Strongly penalize an impossible stack, then prefer narrow strips and good use
    # of the available strip length. This remains only a ranking hint; Sparrow and
    # the independent validator still decide whether it actually fits.
    v_score = v_over*20.0 + vertical_width + abs(PLATE_HEIGHT_MM-min(vertical_length,PLATE_HEIGHT_MM))*0.08
    h_score = h_over*20.0 + horizontal_height + abs(PLATE_WIDTH_MM-min(horizontal_length,PLATE_WIDTH_MM))*0.04
    return {
        'verticalWidth':vertical_width,
        'verticalLength':vertical_length,
        'horizontalHeight':horizontal_height,
        'horizontalLength':horizontal_length,
        'stripScore':min(v_score,h_score),
    }


def install():
    import clean_lab_v4 as v4
    original_rank = v4._rank_remaining
    original_residual = v4._residual_candidates

    def promote(rows, limit=None):
        base = list(rows or [])
        profiled = sorted(base, key=lambda k:(_kit_profile(k)['stripScore'], k.get('priority',999999), k.get('envelope',1e18)))
        # Interleave strip-aware order with the existing robust ranking rather than
        # replacing it. This keeps urgency/area/solidity behaviour intact.
        out=[];seen=set();i=0
        while i < max(len(profiled),len(base)):
            for source in (profiled,base):
                if i < len(source):
                    k=source[i];kid=k.get('kitId')
                    if kid not in seen:
                        seen.add(kid);out.append(k)
                        if limit and len(out)>=limit:return out
            i+=1
        return out

    def rank_remaining(selected,kits):
        return promote(original_rank(selected,kits))

    def residual_candidates(selected,kits,limit=28):
        original = original_residual(selected,kits,max(limit,28))
        used={k.get('kitId') for k in selected}
        remain=[k for k in kits if k.get('kitId') not in used]
        strip_sorted=sorted(remain,key=lambda k:(_kit_profile(k)['stripScore'],k.get('priority',999999),k.get('envelope',1e18)))
        merged=[];seen=set();i=0
        while len(merged)<limit and i<max(len(strip_sorted),len(original)):
            for source in (strip_sorted,original):
                if i<len(source):
                    k=source[i];kid=k.get('kitId')
                    if kid not in seen:
                        seen.add(kid);merged.append(k)
                        if len(merged)>=limit:break
            i+=1
        return merged

    v4._rank_remaining = rank_remaining
    v4._residual_candidates = residual_candidates
    v4.STRIP_FIT_RUNTIME = True
    v4._kit_strip_profile = _kit_profile
    return True
