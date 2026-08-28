"""Lab bootstrap hook.

Python imports sitecustomize automatically at interpreter startup. Keep this hook inert
outside the isolated residual-lab service; in that lab it schedules one read-only real
state benchmark after the normal smoke test.
"""
import os

if "residual-lab" in os.environ.get("MOTOR_RUNTIME_BUILD", ""):
    import startup_real_state_probe  # noqa: F401
