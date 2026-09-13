import benchmark_local_repair_v3 as v3
from benchmark_contour_repair import _contour_candidates


def run_exact_with_repair(kits, budget=210):
    previous = v3._dense_candidates
    try:
        v3._dense_candidates = _contour_candidates
        return v3.run_exact_with_repair(kits, budget=budget)
    finally:
        v3._dense_candidates = previous


__all__ = ['run_exact_with_repair']
