from clean_lab_async_app import app
import benchmark_routes
from benchmark_local_repair_v6 import run_exact_with_repair
benchmark_routes.GAP_MM = 2.5
benchmark_routes._run_exact = run_exact_with_repair
print('POLIFAN_FRONTIER_V6_ACTIVE', flush=True)
