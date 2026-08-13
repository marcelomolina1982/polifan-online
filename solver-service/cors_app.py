from nest_sparrow import app
import production_safety_runtime
import base_only_runtime
import adaptive_base_runtime
import intelligent_selector_runtime  # BASE 10 ESTABLE: decide QUE 10 probar; Sparrow acomoda y V1.7 certifica
import hybrid_strategy_runtime  # LAB: si hay 11+ del mismo modelo, prueba 11/12 rápido antes del fallback estable
import growth_guard_runtime  # LAB: intenta crecimiento protegido desde la mejor base válida
import practical_occupancy_runtime  # LAB: ocupación útil real, consciente de gap y huecos internos aprovechables

# Estrategia híbrida del laboratorio:
# - lotes homogéneos: intentar 11/12 con varias semillas cortas y certificación real;
# - lotes mixtos: conservar la base estable de 10 y usar crecimiento protegido;
# - nunca aceptar una mejora sin gap real >=3 mm, sin conflictos y dentro de placa.

import async_jobs
from flask_cors import CORS

CORS(app, resources={r"/*": {"origins": "*"}}, allow_headers=["Content-Type"], methods=["GET", "POST", "OPTIONS"])
