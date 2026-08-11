from nest_sparrow import app
import production_safety_runtime
import base_only_runtime
import adaptive_base_runtime
import intelligent_selector_runtime  # decide QUE 10 probar; Sparrow acomoda
# El helper fixed_hole_fill actual ya usa backtracking posicional y no depende
# de la antigua _try_place_part. Se importa DESPUES del selector inteligente
# para envolver su resultado: las 10 originales quedan inmutables y sólo se
# agregan figuras completas si toda la placa vuelve a certificar producción.
import fixed_hole_runtime
import async_jobs
from flask_cors import CORS

CORS(app, resources={r"/*": {"origins": "*"}}, allow_headers=["Content-Type"], methods=["GET", "POST", "OPTIONS"])
