# Compatibilidad del laboratorio: clean_lab_async_app sigue importando este módulo.
# La implementación activa vive en V6; producción no usa esta rama.
from benchmark_local_repair_v6 import run_exact_with_repair

# Registrar las rutas de prueba V6 recién cuando clean_lab_async_app importa este
# wrapper al final de su arranque. En ese momento la app Flask ya existe.
import benchmark_async_v6  # noqa: F401,E402

__all__ = ['run_exact_with_repair']
