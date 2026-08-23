"""Laboratorio limpio del motor Polifan.

Objetivo: disponer de un recorrido verificable que NO importe la cadena histórica
production_safety/base_only/adaptive/intelligent/hybrid/final/emergency.

Este módulo usa directamente nest_sparrow.py y expone endpoints separados. No
reemplaza producción ni toca Vercel.
"""
from flask import Flask, jsonify, request
from flask_cors import CORS
import nest_sparrow as core
import time, uuid

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

BUILD = "clean-lab-v1-2026-08-23"

# Capturamos la función ORIGINAL del módulo antes de importar cualquier runtime.
SOLVER = core.nest_sparrow


def identity():
    return {
        "module": getattr(SOLVER, "__module__", ""),
        "name": getattr(SOLVER, "__name__", ""),
        "qualname": getattr(SOLVER, "__qualname__", ""),
    }


@app.get("/health")
def health():
    return jsonify(ok=True, build=BUILD, mode="clean-sparrow-only", solver=identity(),
                   historicalRuntimesLoaded=False)


@app.get("/runtime-info")
def runtime_info():
    return jsonify(ok=True, build=BUILD, mode="clean-sparrow-only", solver=identity(),
                   historicalRuntimesLoaded=False, widthCm=122, heightCm=58,
                   requestedGapMm=3.0)


@app.post("/solve")
def solve():
    payload = request.get_json(silent=True) or {}
    trace_id = uuid.uuid4().hex[:12]
    started = time.time()
    # Forzamos únicamente invariantes físicas; no imponemos densidad ni cantidad.
    payload = dict(payload)
    payload["widthCm"] = 122
    payload["heightCm"] = 58
    payload["gapCm"] = 0.3
    payload.pop("targetDensity", None)
    payload["traceId"] = trace_id
    with core.app.test_request_context("/nest-sparrow", method="POST", json=payload):
        value = SOLVER()
    status = 200
    response = value
    if isinstance(value, tuple):
        response = value[0]
        if len(value) > 1 and isinstance(value[1], int):
            status = value[1]
    try:
        result = response.get_json() or {}
    except Exception:
        result = {"ok": False, "error": "Respuesta no JSON del solver limpio"}
        status = 500
    result["trace"] = {
        "traceId": trace_id,
        "build": BUILD,
        "solver": identity(),
        "historicalRuntimesLoaded": False,
        "elapsedSeconds": round(time.time() - started, 3),
        "inputKitCount": len(payload.get("kits") or []),
        "widthCm": 122,
        "heightCm": 58,
        "gapMm": 3.0,
    }
    return jsonify(result), status
