from nest_sparrow import app
import fixed_hole_runtime  # registra el wrapper de relleno sin cambiar /nest-sparrow
from flask_cors import CORS

# Generador principal: Sparrow + relleno fijo de huecos sobre una base válida.
# V1.7 permanece como certificador final del SVG que se descarga.
CORS(app, resources={r"/*": {"origins": "*"}}, allow_headers=["Content-Type"], methods=["GET", "POST", "OPTIONS"])
