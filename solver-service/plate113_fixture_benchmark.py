"""Reconstructed exact-geometry benchmark for physical Plate #113.

Reads the final real plate SVG fixture committed only to the isolated lab branch,
recovers each complete geometric kit from the unplaced source paths embedded in
the Sparrow groups, and asks the current V4 motor to autonomously repack all 12
complete kits (the original 11 + the manually added pencil).
"""
import base64
import gzip
import json
import os
import threading
import time
from collections import defaultdict
from xml.etree import ElementTree as ET

from flask import jsonify

from clean_lab_app import app
from clean_lab_v4 import solve_v4, PLATE_WIDTH_MM, PLATE_HEIGHT_MM, GAP_MM
from benchmark_routes import _validate_layout
import nest_sparrow as core

FIXTURE_DIR = os.path.join(os.path.dirname(__file__), "fixtures")
CHUNKS = [os.path.join(FIXTURE_DIR, f"plate113.b64.{i}") for i in range(4)]
TARGET_KITS = 12
TARGET_PARTS = 24


def _tag(el):
    return el.tag.split("}")[-1].lower()


def _load_svg():
    payload = "".join(open(p, "r", encoding="utf-8").read().strip() for p in CHUNKS)
    return gzip.decompress(base64.b64decode(payload)).decode("utf-8")


def _paths_without_defs(el):
    out = []
    for child in list(el):
        if _tag(child) == "defs":
            continue
        if _tag(child) == "path" and (child.attrib.get("d") or "").strip():
            out.append(child)
        out.extend(_paths_without_defs(child))
    return out


def _wrap_path(d):
    # Coordinates in the final plate are millimetre-like (viewBox 1230 x 580).
    # svg_to_geometry normalizes each contour to its own origin after parsing.
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="1230mm" height="580mm" '
        'viewBox="0 0 1230 580"><path d="' + d.replace('"', "&quot;") + '"/></svg>'
    )


def _figure_from_kit_id(kid):
    s = kid.lower()
    if "escudo boca jr" in s:
        return "Escudo Boca Jr"
    if "escudo river plate" in s:
        return "Escudo River Plate"
    if "corazon" in s or "corazón" in s:
        return "Corazón"
    if "mate yuyero" in s:
        return "Mate Yuyero"
    if "osito" in s:
        return "Osito"
    return kid


def build_reconstructed_kits():
    root = ET.fromstring(_load_svg())
    by_kit = defaultdict(list)

    for child in list(root):
        if _tag(child) != "g":
            continue
        kid = str(child.attrib.get("data-kit") or "").strip()
        instance = str(child.attrib.get("data-instance") or "").strip()
        if not kid or not instance:
            continue
        paths = _paths_without_defs(child)
        if len(paths) != 1:
            raise ValueError(f"{instance}: se esperaba 1 path fuente y aparecieron {len(paths)}")
        role = "base" if instance.endswith("-p0") else "tapa" if instance.endswith("-p1") else "simple"
        by_kit[kid].append({
            "instanceId": instance,
            "name": instance,
            "role": role,
            "sourceWidthCm": 123,
            "sourceHeightCm": 58,
            "svgText": _wrap_path(paths[0].attrib["d"]),
        })

    # The mate's second component and both pencil components were ungrouped in
    # the user's final edited SVG. Reattach them as complete kits.
    top_paths = {str(ch.attrib.get("id") or ""): ch for ch in list(root) if _tag(ch) == "path"}
    mate_id = next((k for k in by_kit if "mate yuyero" in k.lower()), None)
    if not mate_id or "path3" not in top_paths:
        raise ValueError("No se pudo recuperar el segundo componente de Mate Yuyero")
    by_kit[mate_id].append({
        "instanceId": f"{mate_id}-p1",
        "name": "Mate Yuyero · tapa recuperada",
        "role": "tapa",
        "sourceWidthCm": 123,
        "sourceHeightCm": 58,
        "svgText": _wrap_path(top_paths["path3"].attrib["d"]),
    })

    if "path1-1" not in top_paths or "path2-9" not in top_paths:
        raise ValueError("No se encontraron los dos componentes del Lápiz manual")
    by_kit["manual-lapiz"] = [
        {
            "instanceId": "manual-lapiz-p0",
            "name": "Lapiz · Base",
            "role": "base",
            "sourceWidthCm": 123,
            "sourceHeightCm": 58,
            "svgText": _wrap_path(top_paths["path1-1"].attrib["d"]),
        },
        {
            "instanceId": "manual-lapiz-p1",
            "name": "Lapiz · Tapa",
            "role": "tapa",
            "sourceWidthCm": 123,
            "sourceHeightCm": 58,
            "svgText": _wrap_path(top_paths["path2-9"].attrib["d"]),
        },
    ]

    ordered = []
    # Preserve the real original batch ordering; pencil is deliberately last.
    priority = 1
    for kid, parts in by_kit.items():
        if kid == "manual-lapiz":
            continue
        ordered.append({
            "kitId": kid,
            "figure": _figure_from_kit_id(kid),
            "date": "2026-09-02",
            "priority": priority,
            "parts": sorted(parts, key=lambda p: p["instanceId"]),
        })
        priority += 1
    ordered.append({
        "kitId": "manual-lapiz",
        "figure": "Lapiz",
        "date": "2026-09-02",
        "priority": 999,
        "parts": by_kit["manual-lapiz"],
    })

    part_count = sum(len(k["parts"]) for k in ordered)
    if len(ordered) != TARGET_KITS or part_count != TARGET_PARTS:
        raise ValueError(f"Fixture incompleto: {len(ordered)} kits / {part_count} piezas")
    return ordered


def run_plate113_benchmark():
    started = time.time()
    kits = build_reconstructed_kits()

    # Run the production candidate path exactly as V4 sees it.
    with app.test_request_context(
        "/solve-v4",
        method="POST",
        json={"kits": kits, "budgetSeconds": 240, "urgentAnchorCount": 4},
    ):
        response = solve_v4()

    status = 200
    body = response
    if isinstance(response, tuple):
        body, status = response[0], int(response[1])
    data = body.get_json(silent=True) if hasattr(body, "get_json") else body
    if not isinstance(data, dict):
        data = {"ok": False, "error": "respuesta no JSON"}

    selected_ids = set(str(x) for x in (data.get("selectedKitIds") or []))
    prepared = []
    prep_errors = []
    for kit in kits:
        if str(kit["kitId"]) not in selected_ids:
            continue
        try:
            prepared.append(core._prep_kit(kit, PLATE_WIDTH_MM, PLATE_HEIGHT_MM))
        except Exception as exc:
            prep_errors.append({"kitId": kit["kitId"], "error": str(exc)})

    validation = {}
    if prepared and data.get("placements"):
        validation, _rows = _validate_layout(prepared, data.get("placements") or [])

    complete = int(data.get("completeFigures") or 0)
    result = {
        "marker": "POLIFAN_PLATE113_RESULT",
        "ok": bool(data.get("ok")),
        "httpStatus": status,
        "fixture": "reconstructed-final-plate-exact-geometry",
        "inputCompleteKits": len(kits),
        "inputParts": sum(len(k["parts"]) for k in kits),
        "targetCompleteKits": TARGET_KITS,
        "completeFigures": complete,
        "reachedManualTarget": complete >= TARGET_KITS,
        "placements": len(data.get("placements") or []),
        "build": data.get("build"),
        "cavityAccepted": data.get("cavityAccepted"),
        "cavityAdded": data.get("cavityAdded"),
        "pairAccepted": data.get("pairAccepted"),
        "swapAccepted": data.get("swapAccepted"),
        "stripWidthMm": data.get("stripWidthMm"),
        "geometricOccupancyPct": data.get("geometricOccupancyPct"),
        "layoutValidation": validation,
        "prepErrors": prep_errors,
        "error": data.get("error"),
        "elapsedSeconds": round(time.time() - started, 2),
    }
    return result


@app.get("/benchmark-plate113-fixture")
def benchmark_plate113_fixture_route():
    try:
        result = run_plate113_benchmark()
        return jsonify(result), (200 if result.get("reachedManualTarget") else 422)
    except Exception as exc:
        return jsonify(marker="POLIFAN_PLATE113_RESULT", ok=False, error=str(exc)), 500


def _startup_plate113():
    # Avoid competing with Render's existing synthetic startup self-test.
    time.sleep(130)
    try:
        print(json.dumps(run_plate113_benchmark(), ensure_ascii=False), flush=True)
    except Exception as exc:
        print(json.dumps({
            "marker": "POLIFAN_PLATE113_RESULT",
            "ok": False,
            "error": str(exc),
        }, ensure_ascii=False), flush=True)


def start_plate113_startup_benchmark():
    threading.Thread(target=_startup_plate113, daemon=True).start()
