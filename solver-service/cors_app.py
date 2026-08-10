from nest_v32 import app
from flask_cors import CORS

# Permitir que la app web en Vercel llame directamente al solver de Render.
CORS(app, resources={r"/*": {"origins": "*"}}, allow_headers=["Content-Type"], methods=["GET", "POST", "OPTIONS"])
