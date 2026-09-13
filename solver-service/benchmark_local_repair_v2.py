# Compatibilidad del laboratorio: clean_lab_async_app sigue importando este módulo.
# La implementación activa vive en V3 para poder comparar y revertir sin tocar
# el runtime de producción.
from benchmark_local_repair_v3 import run_exact_with_repair

__all__ = ['run_exact_with_repair']
