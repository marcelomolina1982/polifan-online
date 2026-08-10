from nest_nfp import app
from flask_cors import CORS

# Generador principal: NFP/Minkowski. V1.7 permanece como certificador final.
CORS(app, resources={r"/*": {"origins": "*"}}, allow_headers=["Content-Type"], methods=["GET", "POST", "OPTIONS"])
