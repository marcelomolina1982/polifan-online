from nfp2_patch import app
import selftest_nfp2  # registra /nest-nfp2/selftest usando el núcleo ya parcheado
from flask_cors import CORS

# Generador principal: NFP completo estilo SVGnest (inner-fit menos unión de NFPs).
# V1.7 permanece como certificador final.
CORS(app, resources={r"/*": {"origins": "*"}}, allow_headers=["Content-Type"], methods=["GET", "POST", "OPTIONS"])
