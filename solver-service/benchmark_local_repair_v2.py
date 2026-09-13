# Compatibilidad del laboratorio: clean_lab_async_app sigue importando este módulo.
# La implementación activa vive en V5 para comparar y revertir sin tocar producción.
from benchmark_local_repair_v5 import run_exact_with_repair

__all__ = ['run_exact_with_repair']
