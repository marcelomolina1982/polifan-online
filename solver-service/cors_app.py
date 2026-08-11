from nest_sparrow import app
import production_safety_runtime
import base_only_runtime
import adaptive_base_runtime
import intelligent_selector_runtime  # decide QUE 10 probar; Sparrow acomoda
# TEMPORALMENTE NO importar fixed_hole_runtime: su helper depende de una API antigua
# (_try_place_part) y puede tirar una base 10 que el selector ya resolvio.
# Primero estabilizamos 10 completas; el crecimiento 11+ vuelve despues.
import async_jobs
from flask_cors import CORS

CORS(app, resources={r"/*": {"origins": "*"}}, allow_headers=["Content-Type"], methods=["GET", "POST", "OPTIONS"])
