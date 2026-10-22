"""Regression guard for the IronNest industrial timeout policy.

Run: python -m unittest discover -s solver-service/tests -p 'test_ironnest_timeout_policy.py'
This test only parses source; it does not load IronNest or touch production data.
"""
import ast
from pathlib import Path
import unittest

SOURCE = Path(__file__).resolve().parents[1] / "ironnest_benchmark_app.py"


class TimeoutPolicyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tree = ast.parse(SOURCE.read_text(encoding="utf-8"))
        cls.source = SOURCE.read_text(encoding="utf-8")

    def test_total_attempts_share_a_deadline(self):
        self.assertIn("solve_deadline=time.monotonic()+IRON_SOLVE_TIMEOUT_SECONDS-10", self.source)
        self.assertIn("remaining=solve_deadline-time.monotonic()", self.source)
        self.assertIn("if remaining<8:", self.source)
        self.assertIn("timeout_seconds=min(remaining,110)", self.source)

    def test_only_one_bounded_repair(self):
        self.assertIn("attempts.append((2713,2,repair))", self.source)
        self.assertNotIn("attempts.extend([(2713,2,repair),(3911,1,repair),(6151,4,repair)])", self.source)

    def test_geometry_certification_is_preserved(self):
        self.assertIn("br._validate_layout(detailed_try,p)", self.source)
        self.assertIn("if gap<br.ABSOLUTE_MIN_GAP_MM-0.000001:", self.source)
        self.assertIn("validation['ok']=False", self.source)
        self.assertIn("IRON_SOLVER_GAP_MM=br.GAP_MM", self.source)


if __name__ == "__main__":
    unittest.main()
