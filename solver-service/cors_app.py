from nest_v4 import app
from flask_cors import CORS

# Compatibilidad inmediata: la app actual sigue llamando /nest-v3,
# pero esa ruta ejecuta desde ahora Motor V4 progresivo.
if 'nest_v4' in app.view_functions and 'nest_v3' in app.view_functions:
    app.view_functions['nest_v3']=app.view_functions['nest_v4']

CORS(app, resources={r"/*": {"origins": "*"}}, allow_headers=["Content-Type"], methods=["GET", "POST", "OPTIONS"])
