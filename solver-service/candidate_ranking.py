"""Pure candidate ranking for the experimental Polifan nesting motor.

No network, Render, inventory, order, or cut-batch side effects live here.
A candidate must already be geometrically valid before it is ranked.
"""


def _priority_signature(selected):
    """Return ordered production priorities, padded only by the selected set itself.

    Lower numeric priority is more urgent.  We negate each value so Python's
    normal lexicographic max() prefers the most urgent differing item first.
    This avoids the ambiguity of summing priorities (e.g. [1, 10] vs [5, 6]).
    """
    priorities = sorted(int(float(k.get('priority', 999999))) for k in (selected or []))
    return tuple(-priority for priority in priorities)


def candidate_score(complete_figures, priority_signature, density, strip_width_mm):
    """Lexicographic production objective.

    Preference order:
      1. more complete BASE+TAPA kits
      2. more urgent included production, compared item-by-item
      3. higher geometric density
      4. smaller used strip width

    Geometry/separation are eligibility constraints and must be certified before
    this score is used; they are never traded for a better score.
    """
    return (
        int(complete_figures),
        tuple(priority_signature or ()),
        float(density),
        -float(strip_width_mm),
    )


def score_selected(selected, result):
    """Score an already-valid solver result without mutating either argument."""
    return candidate_score(
        len(selected or []),
        _priority_signature(selected),
        result.get('density') or 0,
        result.get('stripWidthMm') or 1e18,
    )
