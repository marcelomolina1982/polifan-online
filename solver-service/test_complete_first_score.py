"""Safety regression tests for Polifan plate candidate ranking.
Run locally/CI; no network, DB, Render or Vercel required.
"""


def candidate_score(complete_figures, density, strip_width_mm, priority_penalty=0):
    """Production objective: complete kits first, then priority, then density, then compactness."""
    return (
        int(complete_figures),
        -int(priority_penalty),
        float(density),
        -float(strip_width_mm),
    )


def test_more_complete_figures_always_win_over_density():
    ten_dense = candidate_score(10, 88.0, 1100)
    eleven_less_dense = candidate_score(11, 79.0, 1200)
    assert eleven_less_dense > ten_dense


def test_priority_breaks_tie_before_density():
    urgent = candidate_score(11, 78.0, 1200, priority_penalty=0)
    less_urgent = candidate_score(11, 90.0, 1000, priority_penalty=1)
    assert urgent > less_urgent


def test_density_breaks_tie_when_count_and_priority_equal():
    a = candidate_score(11, 81.0, 1200, priority_penalty=0)
    b = candidate_score(11, 80.0, 1000, priority_penalty=0)
    assert a > b


def test_strip_width_is_last_tiebreaker():
    compact = candidate_score(11, 81.0, 1100, priority_penalty=0)
    wide = candidate_score(11, 81.0, 1200, priority_penalty=0)
    assert compact > wide
