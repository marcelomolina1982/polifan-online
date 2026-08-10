from nest_v5 import app
from flask_cors import CORS

# La app conserva la ruta historica /nest-v3, pero desde ahora ejecuta
# Motor V5 geometrico directo (sin PackingSolver para decidir posiciones).
if 'nest_v5' in app.view_functions and 'nest_v3' in app.view_functions:
    app.view_functions['nest_v3']=app.view_functions['nest_v5']

CORS(app, resources={r"/*": {"origins": "*"}}, allow_headers=["Content-Type"], methods=["GET", "POST", "OPTIONS"])
