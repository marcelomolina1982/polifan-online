from nest_sparrow import app
import sparrow_v18_runtime  # V1.8: margen real de 3 mm contra los cuatro bordes de placa
import production_safety_runtime
import base_only_runtime
import adaptive_base_runtime
import intelligent_selector_runtime  # base 10 protegida + crecimiento
import hybrid_strategy_runtime  # boost homogéneo + fallback Growth Fix
import final_runtime_v20  # selector final: crecimiento 11..16 y ruta explícita

# IMPORTANTE: async_jobs se importa al final, cuando el handler definitivo ya
# quedó registrado. Además v25.0.20 resuelve la vista dinámicamente por trabajo.
import async_jobs
from flask import jsonify
from flask_cors import CORS

CORS(app, resources={r"/*": {"origins": "*"}}, allow_headers=["Content-Type"], methods=["GET", "POST", "OPTIONS"])

@app.get('/runtime-info')
def runtime_info():
    view=app.view_functions.get('nest_sparrow')
    return jsonify(ok=True,build='v25.0.20-final-growth',runtime='final-runtime-v20',solverFunction=getattr(view,'__name__','-'),growthTargets=[11,12,13,14,15,16],targetDensity=70,minGapMm=2.5,edgeMarginMm=3)
