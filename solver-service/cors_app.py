from nest_sparrow import app
import production_safety_runtime
import base_only_runtime
import adaptive_base_runtime
import intelligent_selector_runtime  # BASE 10 ESTABLE: decide QUE 10 probar; Sparrow acomoda

# IMPORTANTE: fixed_hole_runtime queda AISLADO durante la validacion de BASE 10.
# La capa 11+ sigue dependiendo de helpers antiguos y no puede intervenir mientras
# no este reescrita. Nunca debe romper una placa base de 10 ya resuelta.

import strict_svg_cert_runtime  # segunda barrera: valida el SVG exacto a 3 mm y no mueve piezas
import async_jobs
from flask_cors import CORS

CORS(app, resources={r"/*": {"origins": "*"}}, allow_headers=["Content-Type"], methods=["GET", "POST", "OPTIONS"])
