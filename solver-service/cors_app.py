from nest_sparrow import app
import base_only_runtime  # primero: encontrar 10 con la configuración estable conocida
import fixed_hole_runtime  # después: rellenar huecos sin mover la base
import emergency_cut_runtime  # si 10 falla, entregar una placa menor valida para no bloquear producción
import async_jobs  # cálculo largo desacoplado de la petición HTTP del navegador
from flask_cors import CORS

# Generador principal: Sparrow base protegida + relleno fijo de huecos.
# /nest-jobs inicia el cálculo y /nest-jobs/<id> permite consultar el estado.
# V1.7 permanece como certificador final del SVG que se descarga.
CORS(app, resources={r"/*": {"origins": "*"}}, allow_headers=["Content-Type"], methods=["GET", "POST", "OPTIONS"])
