from __future__ import annotations
from pathlib import Path
import math, random, tempfile, time
import motor_definitivo_v1 as core
import motor_definitivo_v4 as v4
import motor_definitivo_v5 as v5
import motor_definitivo_v6 as v6


def _score(ev):
    return v5._score(ev)


def _pair_hint(state, gap, pair_hints=None):
    if pair_hints:
        for ia, ib in pair_hints:
            if 0 <= ia < len(state) and 0 <= ib < len(state) and ia != ib:
                return ia, ib
    ps = v5._pairs(state, gap)
    return (ps[0][1], ps[0][2]) if ps else None


def _neighborhood(state, ia, ib, extra=4):
    active = [ia, ib]
    ranked = []
    for k, p in enumerate(state):
        if k in (ia, ib):
            continue
        d = min(p.geom.distance(state[ia].geom), p.geom.distance(state[ib].geom))
        ranked.append((d, k))
    ranked.sort()
    active.extend(k for _, k in ranked[:extra])
    return active


def _micro_lns(pieces, gap, seconds=14.0, pair_hints=None, extra_neighbors=4, seed=170713):
    """Micro-LNS V1.7: libera el par conflictivo y sus vecinos mas cercanos.

    El resto de la placa queda congelado. Se permiten estados intermedios con
    mas de un conflicto para poder salir de callejones locales, pero nunca borde.
    """
    start = time.time()
    base = [p.clone() for p in pieces]
    base_ev = core.evaluate(base, gap)
    pair = _pair_hint(base, gap, pair_hints)
    if not pair or base_ev[2]:
        return base, base_ev, {'used': False, 'reason': 'sin_par_o_borde'}

    ia, ib = pair
    active = _neighborhood(base, ia, ib, extra_neighbors)
    rng = random.Random(seed)
    best = [p.clone() for p in base]
    best_ev = base_ev
    cur = [p.clone() for p in base]
    cur_ev = base_ev
    tested = accepted = 0

    def energy(ev):
        return ev[0] + 140.0 * ev[1] + 100000.0 * ev[2]

    while time.time() - start < seconds:
        elapsed = time.time() - start
        progress = min(1.0, elapsed / max(seconds, 1e-9))
        remain = 1.0 - progress
        scale = max(0.25, 9.0 * (remain ** 1.35))
        angle_scale = max(0.20, 5.0 * (remain ** 1.15))

        # El par conflictivo recibe mas intentos; los vecinos pueden abrirle espacio.
        weights = [5.0 if k in (ia, ib) else 1.8 for k in active]
        idx = rng.choices(active, weights=weights, k=1)[0]

        if idx in (ia, ib) and rng.random() < 0.62:
            ux, uy = v5._pair_direction(cur, ia, ib)
            sign = -1.0 if idx == ia else 1.0
            tx, ty = -uy, ux
            dx = sign * ux * abs(rng.gauss(scale, scale * 0.45)) + tx * rng.gauss(0, scale * 0.75)
            dy = sign * uy * abs(rng.gauss(scale, scale * 0.45)) + ty * rng.gauss(0, scale * 0.75)
        else:
            # Vecinos se alejan preferentemente del punto medio del par.
            ca = cur[ia].geom.centroid; cb = cur[ib].geom.centroid
            mx, my = (ca.x + cb.x) / 2.0, (ca.y + cb.y) / 2.0
            c = cur[idx].geom.centroid
            vx, vy = c.x - mx, c.y - my
            L = math.hypot(vx, vy) or 1.0
            if rng.random() < 0.60:
                dx = vx / L * abs(rng.gauss(scale * 0.8, scale * 0.4)) + rng.gauss(0, scale * 0.35)
                dy = vy / L * abs(rng.gauss(scale * 0.8, scale * 0.4)) + rng.gauss(0, scale * 0.35)
            else:
                dx, dy = rng.gauss(0, scale), rng.gauss(0, scale)

        ang = max(-8.0, min(8.0, rng.gauss(0, angle_scale)))
        nxt = v5._move(cur, idx, dx, dy, ang)
        tested += 1
        ev = core.evaluate(nxt, gap)
        if ev[2]:
            continue
        if ev[1] == 0:
            return nxt, ev, {
                'used': True, 'solved': True, 'mode': 'neighborhood_lns',
                'active': active, 'pair': [ia, ib], 'tested': tested,
                'accepted': accepted, 'seconds': round(time.time() - start, 3),
                'target_gap_mm': gap,
            }

        # Permite atravesar estados algo peores para reacomodar el microsector.
        delta = energy(ev) - energy(cur_ev)
        temp = max(0.12, 24.0 * remain)
        if delta <= 0 or rng.random() < math.exp(-min(700.0, delta / temp)):
            cur, cur_ev = nxt, ev
            accepted += 1
            if _score(ev) < _score(best_ev):
                best, best_ev = [p.clone() for p in nxt], ev

        # Reinicios alrededor del mejor estado para no derivar demasiado.
        if tested % 700 == 0:
            cur = [p.clone() for p in best]
            cur_ev = best_ev

    return best, best_ev, {
        'used': True, 'solved': best_ev[1] == 0 and best_ev[2] == 0,
        'mode': 'neighborhood_lns_exhausted', 'active': active,
        'pair': [ia, ib], 'tested': tested, 'accepted': accepted,
        'seconds': round(time.time() - start, 3), 'target_gap_mm': gap,
    }


def solve_file(inp, outdir, seconds3=8.0, seconds25=14.0):
    t0 = time.time()
    root, defs, pieces, collapsed = core.extract(inp, 1.0)
    if not pieces:
        return {'archivo': inp.name, 'status': 'SIN_GEOMETRIA', 'seconds': round(time.time()-t0,3), 'engineVersion': 'V1.7'}

    base = core.compact_seed(pieces)
    attempts = []

    def try_gap(final_gap, seconds):
        gap = final_gap + core.SEARCH_SAFETY
        ev0 = core.evaluate(base, gap)
        if ev0[1] == 0 and ev0[2] == 0:
            return [p.clone() for p in base], ev0
        best = None; best_ev = ev0
        per = max(0.5, seconds / 4)
        for s in (17, 43, 101, 211):
            cand, cev, meta = core.anneal(base, gap, per, s)
            attempts.append({'gap': final_gap, 'eval': cev, 'meta': meta})
            if _score(cev) < _score(best_ev):
                best, best_ev = cand, cev
            if cev[1] == 0 and cev[2] == 0:
                return cand, cev
        return best, best_ev

    sol, ev = try_gap(core.PREFERRED_GAP, seconds3)
    used = core.PREFERRED_GAP
    if sol is None or ev[1] or ev[2]:
        sol, ev = try_gap(core.MIN_GAP, seconds25)
        used = core.MIN_GAP

    repair_meta = pair_meta = None
    if sol is not None and ev[2] == 0 and 1 <= ev[1] <= 2:
        sol2, ev2, repair_meta = v4.repair_residual(sol, core.MIN_GAP + core.SEARCH_SAFETY, seconds=10.0, max_pairs=2)
        attempts.append({'repair_v14': repair_meta, 'eval': ev2})
        if _score(ev2) < _score(ev) or (ev2[1] == 0 and ev2[2] == 0):
            sol, ev = sol2, ev2

    if sol is not None and ev[2] == 0 and ev[1] == 1:
        ps = v5._pairs(sol, core.MIN_GAP + core.SEARCH_SAFETY)
        hints = [(ps[0][1], ps[0][2])] if ps else None
        sol2, ev2, pair_meta = v6._deep_last_pair(sol, core.MIN_GAP + core.SEARCH_SAFETY, seconds=18.0, pair_hints=hints)
        attempts.append({'repair_v16': pair_meta, 'eval': ev2})
        if _score(ev2) < _score(ev) or (ev2[1] == 0 and ev2[2] == 0):
            sol, ev = sol2, ev2

    # V1.7: solo si aun queda UN conflicto y borde 0, libera el microvecindario.
    rescue_meta = []
    rescue_gap = None
    if sol is not None and ev[2] == 0 and ev[1] == 1:
        for stage, target_gap in enumerate((3.0, 2.8, 2.65), 1):
            ps = v5._pairs(sol, target_gap)
            hints = [(ps[0][1], ps[0][2])] if ps else None
            cand, cev, meta_lns = _micro_lns(
                sol, target_gap, seconds=13.0, pair_hints=hints,
                extra_neighbors=4, seed=170713 + stage * 97,
            )
            rescue_meta.append({'stage': stage, 'target_gap_mm': target_gap, 'meta': meta_lns, 'eval': cev})
            if _score(cev) < _score(core.evaluate(sol, target_gap)) or (cev[1] == 0 and cev[2] == 0):
                sol = cand
            ev = core.evaluate(sol, target_gap)
            if ev[1] == 0 and ev[2] == 0:
                rescue_gap = target_gap
                break

    if sol is None or ev[1] or ev[2]:
        return {
            'archivo': inp.name, 'status': 'NO_RESUELTO', 'pieces': len(pieces),
            'collapsed_internal': collapsed, 'conflicts': ev[1],
            'border_conflicts': ev[2], 'min_gap_mm': ev[3],
            'attempts': attempts, 'repair': repair_meta, 'pairRepair': pair_meta,
            'neighborhoodRescue': rescue_meta, 'seconds': round(time.time()-t0,3),
            'engineVersion': 'V1.7',
        }

    out = outdir / (inp.stem + '__POLIFAN_OK.svg')
    meta = {
        'engine': 'Motor Polifan Definitivo V1.7', 'source': inp.name,
        'plate_mm': [core.PLATE_W, core.PLATE_H], 'target_gap_used_mm': used,
        'rescue_search_gap_mm': rescue_gap, 'scale': '1:1',
        'piece_count': len(pieces), 'collapsed_internal_details': collapsed,
    }
    ok, val = v5._export_validate(defs, sol, out, meta, len(pieces))

    # Mantiene la guardia exacta de V1.5/V1.6 para los conflictos de exportacion.
    export_repairs = []
    for guard_round in range(3):
        if ok or val.get('border_conflicts', 0):
            break
        rpairs = val.get('conflict_pairs') or []
        if not rpairs:
            break
        hints = [(int(p['a']), int(p['b'])) for p in rpairs[:2]]
        sol2, ev2, meta_rep = v6._deep_last_pair(sol, 4.0, seconds=14.0, pair_hints=hints)
        export_repairs.append({'round': guard_round+1, 'pairs': rpairs[:2], 'repair': meta_rep, 'eval': ev2})
        if ev2[2]:
            break
        sol = sol2
        ok, val = v5._export_validate(defs, sol, out, meta, len(pieces))

    status = 'CERTIFICADO' if ok else 'EXPORT_RECHAZADO'
    return {
        'archivo': inp.name, 'status': status, 'pieces': len(pieces),
        'collapsed_internal': collapsed, 'search_gap_used_mm': used,
        'rescue_search_gap_mm': rescue_gap, 'search_min_gap_mm': ev[3],
        'validation': val, 'output': str(out), 'attempts': attempts,
        'repair': repair_meta, 'pairRepair': pair_meta,
        'neighborhoodRescue': rescue_meta, 'exportRepairs': export_repairs,
        'seconds': round(time.time()-t0,3), 'engineVersion': 'V1.7',
    }


def solve_svg_text(svg_text: str, filename: str = 'placa.svg', seconds3: float = 8.0, seconds25: float = 14.0):
    with tempfile.TemporaryDirectory(prefix='polifan_def_') as td:
        base = Path(td)
        safe = Path(filename or 'placa.svg').name
        if not safe.lower().endswith('.svg'):
            safe += '.svg'
        inp = base / safe
        outdir = base / 'out'
        outdir.mkdir()
        inp.write_text(svg_text, encoding='utf-8')
        result = solve_file(inp, outdir, seconds3, seconds25)
        txt = None
        path = result.get('output')
        if path and Path(path).exists():
            txt = Path(path).read_text(encoding='utf-8')
        result = dict(result)
        result.pop('output', None)
        result['svgText'] = txt
        result['engineVersion'] = 'V1.7'
        result['certificationStrategy'] = 'v16_plus_neighborhood_lns_with_strict_2_5mm_export_certificate'
        return result
