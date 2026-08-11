"""Production safety guards for Sparrow.

This module intentionally monkey-patches only two pure decision points in
``nest_sparrow``.  It does not change geometry, scale or placements:

* every Sparrow solve is forced to use >= 3.0 mm separation;
* valid solutions are ranked by complete figures first, then density, then
  compact strip width.

Imported by cors_app before runtime wrappers are installed.
"""
import nest_sparrow as ns

MIN_PRODUCTION_GAP_MM = 3.0

_original_run_sparrow = ns._run_sparrow


def _run_sparrow_production(selected, gap_mm, seconds, seed, continuous=False, extra_part=None):
    safe_gap = max(MIN_PRODUCTION_GAP_MM, float(gap_mm or 0.0))
    return _original_run_sparrow(
        selected,
        safe_gap,
        seconds,
        seed,
        continuous=continuous,
        extra_part=extra_part,
    )


def _score_complete_first(target, result):
    """Never prefer a denser 10-kit plate over a valid 11+ kit plate."""
    return (
        int(target),
        float(result.get('density') or 0.0),
        -float(result.get('stripWidthMm') or 1e18),
    )


ns._run_sparrow = _run_sparrow_production
ns._score = _score_complete_first
ns.MIN_PRODUCTION_GAP_MM = MIN_PRODUCTION_GAP_MM
