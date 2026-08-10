from nest_v32 import app
from flask_cors import CORS

# Compatibilidad inmediata: la app actual sigue llamando /nest-v3,
# pero esa ruta ejecuta desde ahora la lógica V3.2 (10+ o 9 con alta ocupación).
if 'nest_v32' in app.view_functions and 'nest_v3' in app.view_functions:
    app.view_functions['nest_v3']=app.view_functions['nest_v32']

CORS(app, resources={r"/*": {"origins": "*"}}, allow_headers=["Content-Type"], methods=["GET", "POST", "OPTIONS"])
