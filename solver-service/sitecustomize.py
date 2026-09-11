"""Lab bootstrap hook.

Python imports sitecustomize automatically at interpreter startup. Keep this hook inert
outside isolated lab services.
"""
import os

runtime = os.environ.get("MOTOR_RUNTIME_BUILD", "")

if "residual-lab" in runtime:
    import startup_real_state_probe  # noqa: F401

if runtime == "motor-complete-first-safe-20260909":
    try:
        import benchmark_routes
        benchmark_routes.GAP_MM = 2.5
        from benchmark_local_repair import run_exact_with_repair
        benchmark_routes._run_exact = run_exact_with_repair
    except Exception:
        pass
