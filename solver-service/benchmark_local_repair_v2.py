# Compatibilidad del laboratorio: clean_lab_async_app sigue importando este módulo.
# La implementación activa vive en V6; producción no usa esta rama.
from benchmark_local_repair_v6 import run_exact_with_repair

__all__ = ['run_exact_with_repair']
