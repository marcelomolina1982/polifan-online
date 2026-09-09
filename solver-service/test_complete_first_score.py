"""Safety regression tests for Polifan plate candidate ranking.
Run locally/CI; no network, DB, Render or Vercel required.
"""
from candidate_ranking import candidate_score, score_selected


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


def test_real_selected_score_never_mutates_inputs():
    selected = [{'kitId': 'a', 'priority': 1}, {'kitId': 'b', 'priority': 2}]
    result = {'density': 80.5, 'stripWidthMm': 1180.0}
    before_selected = repr(selected)
    before_result = repr(result)
    score_selected(selected, result)
    assert repr(selected) == before_selected
    assert repr(result) == before_result
