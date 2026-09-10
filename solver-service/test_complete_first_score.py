"""Safety regression tests for Polifan plate candidate ranking.
Run locally/CI; no network, DB, Render or Vercel required.
"""
from pathlib import Path
from candidate_ranking import candidate_score, score_selected


def test_more_complete_figures_always_win_over_density_and_priority():
    ten_dense_urgent = candidate_score(10, (-1,) * 10, 88.0, 1100)
    eleven_less_dense = candidate_score(11, (-999,) * 11, 79.0, 1200)
    assert eleven_less_dense > ten_dense_urgent


def test_priority_is_compared_item_by_item_not_by_sum():
    # Both sets sum to 11, but [1,10] contains the most urgent first item.
    urgent_first = score_selected(
        [{'priority': 1}, {'priority': 10}],
        {'density': 78.0, 'stripWidthMm': 1200},
    )
    flatter = score_selected(
        [{'priority': 5}, {'priority': 6}],
        {'density': 90.0, 'stripWidthMm': 1000},
    )
    assert urgent_first > flatter


def test_density_breaks_tie_when_count_and_priority_equal():
    a = candidate_score(11, (-1, -2), 81.0, 1200)
    b = candidate_score(11, (-1, -2), 80.0, 1000)
    assert a > b


def test_strip_width_is_last_tiebreaker():
    compact = candidate_score(11, (-1, -2), 81.0, 1100)
    wide = candidate_score(11, (-1, -2), 81.0, 1200)
    assert compact > wide


def test_real_selected_score_never_mutates_inputs():
    selected = [{'kitId': 'a', 'priority': 2}, {'kitId': 'b', 'priority': 5}]
    result = {'density': 81.5, 'stripWidthMm': 1199.0}
    before_selected = repr(selected)
    before_result = repr(result)
    assert score_selected(selected, result) == candidate_score(2, (-2, -5), 81.5, 1199.0)
    assert repr(selected) == before_selected
    assert repr(result) == before_result


def test_production_solver_is_wired_to_the_safe_ranking_module():
    """Prevents a false green: the pure helper must actually be used by nest_sparrow."""
    source = (Path(__file__).parent / 'nest_sparrow.py').read_text(encoding='utf-8')
    assert 'from candidate_ranking import score_selected' in source
    assert 'sc=score_selected(selected,result)' in source.replace(' ', '')
    assert 'def _score(' not in source
