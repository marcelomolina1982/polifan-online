from nest_sparrow import app
import sparrow_v18_runtime  # geometría base: margen real de 3 mm
import production_safety_runtime
import base_only_runtime
import adaptive_base_runtime
import intelligent_selector_runtime
import hybrid_strategy_runtime
import final_runtime_v20  # runtime final v25.0.22: V1.10 Global Recompact

import async_jobs
from flask import jsonify
from flask_cors import CORS

CORS(app, resources={r"/*": {"origins": "*"}}, allow_headers=["Content-Type"], methods=["GET", "POST", "OPTIONS"])

@app.get('/runtime-info')
def runtime_info():
    view=app.view_functions.get('nest_sparrow')
    return jsonify(ok=True,build='v25.0.22-global-recompact',runtime='sparrow-v1.10-global-recompact',solverFunction=getattr(view,'__name__','-'),growthTargets=[11,12,13,14,15,16],globalRecompact=True,targetDensity=70,minGapMm=2.5,edgeMarginMm=3)
