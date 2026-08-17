from nest_sparrow import app
import sparrow_v18_runtime  # geometría base: margen real de 3 mm contra los cuatro bordes de placa
import production_safety_runtime
import base_only_runtime
import adaptive_base_runtime
import intelligent_selector_runtime  # base 10 protegida + Balanced Growth
import hybrid_strategy_runtime  # boost homogéneo + fallback Balanced Growth
import final_runtime_v20  # runtime final v25.0.21: crecimiento balanceado 11..16

# IMPORTANTE: async_jobs se importa al final, cuando el handler definitivo ya
# quedó registrado. Cada trabajo resuelve dinámicamente el solver activo.
import async_jobs
from flask import jsonify
from flask_cors import CORS

CORS(app, resources={r"/*": {"origins": "*"}}, allow_headers=["Content-Type"], methods=["GET", "POST", "OPTIONS"])

@app.get('/runtime-info')
def runtime_info():
    view=app.view_functions.get('nest_sparrow')
    return jsonify(ok=True,build='v25.0.21-balanced-growth',runtime='sparrow-v1.9-balanced-growth',solverFunction=getattr(view,'__name__','-'),growthTargets=[11,12,13,14,15,16],targetDensity=70,minGapMm=2.5,edgeMarginMm=3)
