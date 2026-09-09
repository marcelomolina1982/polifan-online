"""Candidate ranking for the experimental Polifan nesting motor.

This module is intentionally pure: it has no network, Render, inventory or order side effects.
The production solver can adopt it only after regression/benchmark tests pass.
"""


def candidate_score(complete_figures, density, strip_width_mm, priority_penalty=0):
    """Return a lexicographic score where complete kits are the primary objective.

    Order of preference:
      1. more complete BASE+TAPA kits
      2. lower production-priority penalty
      3. higher geometric density
      4. smaller used strip width
    """
    return (
        int(complete_figures),
        -int(priority_penalty),
        float(density),
        -float(strip_width_mm),
    )


def score_selected(selected, result):
    """Score a solver result without mutating either argument."""
    priorities = [int(float(k.get('priority', 999999))) for k in (selected or [])]
    # This is deliberately a tie-breaker, not allowed to beat an extra complete kit.
    priority_penalty = sum(priorities)
    return candidate_score(
        len(selected or []),
        result.get('density') or 0,
        result.get('stripWidthMm') or 1e18,
        priority_penalty,
    )
