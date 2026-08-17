from nest_sparrow import app
import sparrow_v18_runtime  # V1.8: margen real de 3 mm contra los cuatro bordes de placa
import production_safety_runtime
import base_only_runtime
import adaptive_base_runtime
import intelligent_selector_runtime  # Smart-4: base 10 protegida + intento oportunista de 11
import hybrid_strategy_runtime  # 11/12 homogéneo con fallback a Smart-4

import async_jobs
from flask_cors import CORS

CORS(app, resources={r"/*": {"origins": "*"}}, allow_headers=["Content-Type"], methods=["GET", "POST", "OPTIONS"])
