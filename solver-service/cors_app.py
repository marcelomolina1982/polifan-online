from nest_sparrow import app
from flask_cors import CORS

# Generador principal: Sparrow (state-of-the-art irregular strip packing sobre jagua-rs).
# El código Python sólo adapta SVG <-> Sparrow. V1.7 permanece como certificador final.
CORS(app, resources={r"/*": {"origins": "*"}}, allow_headers=["Content-Type"], methods=["GET", "POST", "OPTIONS"])
