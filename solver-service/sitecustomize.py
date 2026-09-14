"""Lab bootstrap hook.

Python imports sitecustomize automatically at interpreter startup. Keep this hook inert
outside isolated lab services.
"""
import os

runtime = os.environ.get("MOTOR_RUNTIME_BUILD", "")

if "residual-lab" in runtime:
    import startup_real_state_probe  # noqa: F401

if runtime in ("motor-complete-first-safe-20260909", "motor-frontier-v6-lab"):
    try:
        import benchmark_routes
        benchmark_routes.GAP_MM = 2.5
        from benchmark_local_repair_v6 import run_exact_with_repair
        benchmark_routes._run_exact = run_exact_with_repair
    except Exception as exc:
        print("POLIFAN_FRONTIER_V6_BOOTSTRAP_ERROR", repr(exc), flush=True)
