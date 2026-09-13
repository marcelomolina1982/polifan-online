# Compatibilidad del laboratorio: clean_lab_async_app sigue importando este módulo.
# La implementación activa vive en V4 para comparar y revertir sin tocar
# el runtime de producción.
from benchmark_local_repair_v4 import run_exact_with_repair

__all__ = ['run_exact_with_repair']
