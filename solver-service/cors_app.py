from nest_sparrow import app
import production_safety_runtime
import base_only_runtime
import adaptive_base_runtime
import intelligent_selector_runtime  # BASE 10 ESTABLE: decide QUE 10 probar; Sparrow acomoda y V1.7 certifica
import fixed_hole_runtime  # 10->11->12->13+: backtracking sin mover la base; cada crecimiento se recertifica
import strict_svg_cert_runtime  # segunda barrera: valida el SVG exacto a 3 mm y no mueve piezas

import async_jobs
from flask_cors import CORS

CORS(app, resources={r"/*": {"origins": "*"}}, allow_headers=["Content-Type"], methods=["GET", "POST", "OPTIONS"])
