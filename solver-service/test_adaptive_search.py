"""Regression tests for the pure adaptive Sparrow rescue policy."""
from adaptive_search import rescue_plan


def test_rescue_targets_only_next_complete_frontier():
    plan = rescue_plan(10, 16, 80)
    assert plan
    assert {row['target'] for row in plan} == {11}


def test_frontier_advances_after_better_certified_plate():
    plan = rescue_plan(11, 16, 80)
    assert plan
    assert {row['target'] for row in plan} == {12}


def test_no_rescue_before_safe_base_of_ten():
    assert rescue_plan(9, 16, 120) == []


def test_no_rescue_when_no_more_complete_kits_exist():
    assert rescue_plan(12, 12, 120) == []


def test_low_remaining_budget_is_not_overspent():
    assert rescue_plan(10, 16, 21) == []


def test_attempts_are_reproducible_and_budget_bounded():
    a = rescue_plan(10, 16, 80)
    b = rescue_plan(10, 16, 80)
    assert a == b
    assert sum(row['seconds'] for row in a) + 8 <= 80
    assert len({row['seed'] for row in a}) == len(a)
