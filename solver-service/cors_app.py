from nest_sparrow import app
import production_safety_runtime  # gap >=3 mm y ranking por figuras completas primero
import base_only_runtime  # respaldo historico conocido
import adaptive_base_runtime  # respaldo de selección incremental
import intelligent_selector_runtime  # decide qué 10 probar y aprende de éxitos/fallos
import fixed_hole_runtime  # después: rellenar huecos sin mover la base
import async_jobs  # cálculo largo desacoplado de la petición HTTP del navegador
from flask_cors import CORS

# Generador principal: selector inteligente -> Sparrow acomoda -> V1.7 certifica -> relleno fijo.
# /nest-jobs inicia el cálculo y /nest-jobs/<id> permite consultar el estado.
CORS(app, resources={r"/*": {"origins": "*"}}, allow_headers=["Content-Type"], methods=["GET", "POST", "OPTIONS"])
