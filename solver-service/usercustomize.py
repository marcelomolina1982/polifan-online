import os

runtime = os.environ.get('MOTOR_RUNTIME_BUILD','')
if 'residual-lab' in runtime:
    try:
        import benchmark_local_repair_v6 as v6
        _original = v6.run_exact_with_repair
        def _bounded(kits, budget=185):
            return _original(kits, budget=min(105, int(budget or 105)))
        v6.run_exact_with_repair = _bounded
        import benchmark_async_v6
        print('POLIFAN_V6_ASYNC_BOUNDED_ACTIVE', flush=True)
    except Exception as exc:
        print('POLIFAN_V6_ASYNC_BOOTSTRAP_ERROR', repr(exc), flush=True)
