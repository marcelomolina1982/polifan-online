from nest_sparrow import app
import production_safety_runtime  # gap >=3 mm y ranking por figuras completas primero
import base_only_runtime  # respaldo historico conocido
import adaptive_base_runtime  # base dinamica: cambia 1-3 figuras al variar los pendientes
import fixed_hole_runtime  # despues: rellenar huecos sin mover la base
import async_jobs  # calculo largo desacoplado de la peticion HTTP del navegador
from flask_cors import CORS

# Generador principal: Sparrow adaptativo -> base protegida -> relleno fijo de huecos.
# /nest-jobs inicia el calculo y /nest-jobs/<id> permite consultar el estado.
# V1.7 permanece como certificador final del SVG que se descarga.
CORS(app, resources={r"/*": {"origins": "*"}}, allow_headers=["Content-Type"], methods=["GET", "POST", "OPTIONS"])
