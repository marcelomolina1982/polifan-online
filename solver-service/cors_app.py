from nest_sparrow import app
import production_safety_runtime
import base_only_runtime
import adaptive_base_runtime
import intelligent_selector_runtime  # BASE 10 ESTABLE: decide QUE 10 probar; Sparrow acomoda y V1.7 certifica
import growth_guard_runtime  # LAB: intenta 11/12/13 y conserva siempre la mejor base certificada
import practical_occupancy_runtime  # LAB: ocupación útil real, consciente de gap y huecos internos aprovechables

# La base de 10 queda protegida. El crecimiento sólo se acepta si vuelve a pasar
# el mismo certificador geométrico de producción (gap real >=3 mm, sin conflictos
# y dentro de placa). Si 11/12/13 fallan, se devuelve intacta la base válida de 10.
# La ocupación mostrada al final deja de ser sólo área sólida de material y pasa a
# representar la huella práctica bloqueada por piezas + separación de seguridad.

import async_jobs
from flask_cors import CORS

CORS(app, resources={r"/*": {"origins": "*"}}, allow_headers=["Content-Type"], methods=["GET", "POST", "OPTIONS"])
