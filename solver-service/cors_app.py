from nest_sparrow import app
import nest_sparrow as ns

# El navegador corta antes que el presupuesto histórico de 245 s.
# Reservamos margen para serialización, red, certificación y relleno fijo de huecos.
# La prioridad sigue siendo conseguir primero una base válida de 10.
ns.TOTAL_BUDGET_SECONDS = 150

import fixed_hole_runtime  # registra el wrapper de relleno sin cambiar /nest-sparrow
from flask_cors import CORS

# Generador principal: Sparrow + relleno fijo de huecos sobre una base válida.
# V1.7 permanece como certificador final del SVG que se descarga.
CORS(app, resources={r"/*": {"origins": "*"}}, allow_headers=["Content-Type"], methods=["GET", "POST", "OPTIONS"])
