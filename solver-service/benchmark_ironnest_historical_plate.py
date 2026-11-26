"""Isolated IronNest benchmark against an EXISTING historical plate fixture.

Reads only solver-service/fixtures/plate113.b64.* from this Git branch. No
production API, credentials, customer orders or outgoing network requests.
The shapes are sampled from the original SVG paths; THIS IS NOT an exact
certification of today's uncut 39 SVGs and must not authorize deployment.
"""
import base64
import gzip
import json
import math
import multiprocessing
import pathlib
import queue
import time
from xml.etree import ElementTree as ET

import ironnest
from shapely.affinity import rotate, translate
from shapely.geometry import Polygon
from svgpathtools import parse_path

BASE = pathlib.Path(__file__).resolve().parent
W, H = 1230.0, 580.0
GAP_SEARCH = 4.5
GAP_HARD = 3.0
FOUR = [0.0, 90.0, 180.0, 270.0]
EIGHT = [float(a) for a in range(0, 360, 45)]

def tag(el):
    return el.tag.rsplit("}", 1)[-1]

def read_kits():
    compressed = "".join((BASE/"fixtures"/f"plate113.b64.{i}").read_text().strip() for i in range(4))
    root = ET.fromstring(gzip.decompress(base64.b64decode(compressed)).decode("utf-8"))
    by_kit={}
    for child in root:
        if tag(child) != "g" or not child.get("data-instance") or not child.get("data-kit"):
            continue
        paths = [el.get("d") for el in child.iter() if tag(el)=="path" and el.get("d")]
        if len(paths)!=1:
            raise ValueError("Historical source component has an unexpected number of paths")
        by_kit.setdefault(child.get("data-kit"),[]).extend(paths)
    special = {child.get("id"):child.get("d") for child in root if tag(child)=="path"}
    for key in ("path3", "path1-1", "path2-9"):
        if not special.get(key):
            raise ValueError("Missing a historical fixture component")
    mate=next((key for key in by_kit if "mate yuyero" in key.lower()),None)
    if not mate:
        raise ValueError("Missing historical mate kit")
    by_kit[mate].append(special["path3"])
    by_kit["manual-lapiz"]=[special["path1-1"],special["path2-9"]]
    kits=list(by_kit.values())
    if len(kits)!=12 or any(len(k)!=2 for k in kits):
        raise ValueError(f"Expected 12 historical two-part kits, got {len(kits)}")
    return kits

def polygon_from_svg(d, step_mm, tolerance_mm):
    options=[]
    for sub in parse_path(d).continuous_subpaths():
        coords=[]
        for seg in sub:
            dist=seg.length(error=1e-2)
            n=max(1,min(100,math.ceil(dist/step_mm)))
            coords.extend((float(seg.point(j/n).real),float(seg.point(j/n).imag)) for j in range(n))
        if len(coords)<3:
            continue
        poly=Polygon(coords)
        if not poly.is_valid:
            poly=poly.buffer(0)
        if poly.is_empty:
            continue
        if poly.geom_type=="MultiPolygon":
            poly=max(poly.geoms,key=lambda p:p.area)
        if poly.geom_type=="Polygon" and poly.area>1:
            options.append(poly)
    if not options:
        raise ValueError("Historical path contains no usable contour")
    poly=max(options,key=lambda p:p.area).simplify(tolerance_mm,preserve_topology=True)
    xmin,ymin,_,_=poly.bounds
    return translate(poly,xoff=-xmin,yoff=-ymin)

def contours(data):
    detailed=[polygon_from_svg(d,1.0,0.1) for d in data]
    solver=[polygon_from_svg(d,2.0,0.6) for d in data]
    # Preserve identical trim origins for solver and validation to avoid
    # re-normalization drift; both polygons are trimmed independently by design.
    outlines=[[(float(x),float(y)) for x,y in poly.exterior.coords[:-1]] for poly in solver]
    if any(len(x)<3 for x in outlines):
        raise ValueError("Invalid simplified component")
    return outlines,detailed

def worker(outlines,detailed,rotations,out):
    try:
        started=time.monotonic()
        placements,unplaced=ironnest.nest(
            outlines,qty=[1]*len(outlines),
            container=[(.7,.7),(W-.7,.7),(W-.7,H-.7),(.7,H-.7)],
            holes=[],min_sep=GAP_SEARCH,
            rotations=[rotations]*len(outlines),
            seed=1777,budget=24,strategy="sampling",
            column_weight=3,restarts=1,separation_effort="fast"
        )
        indices=[int(a[0]) for a in placements]
        unique=len(set(indices))==len(indices)
        valid_indices=all(0<=idx<len(outlines) for idx in indices)
        placed=[]
        if valid_indices:
            for idx,x,y,angle in placements:
                g=translate(rotate(detailed[int(idx)],float(angle),origin=(0,0)),
                            xoff=float(x),yoff=float(y))
                placed.append(g)
        gap=min((float(p.distance(q)) for i,p in enumerate(placed)
                 for q in placed[i+1:]),default=None)
        within=all(g.bounds[0]>=-0.001 and g.bounds[1]>=-0.001
                   and g.bounds[2]<=W+0.001 and g.bounds[3]<=H+0.001
                   for g in placed)
        whole=(unique and valid_indices and len(indices)==len(outlines)
               and len(unplaced)==0 and within
               and (gap is None or gap>=GAP_HARD-.001))
        width=(max(g.bounds[2] for g in placed)-min(g.bounds[0] for g in placed)) if placed else None
        out.put({"ok":True,"completeAndCertified":whole,
                 "placed":len(indices),"missing":len(unplaced),
                 "minimumGapMm":round(gap,3) if gap is not None else None,
                 "withinPlate":within,"uniqueIds":unique,
                 "usedWidthMm":round(width,1) if width is not None else None,
                 "elapsedSeconds":round(time.monotonic()-started,2),
                 "anglesUsed":sorted({round(float(a[3]),2) for a in placements})})
    except BaseException as exc:
        out.put({"ok":False,"error":repr(exc)})

def bounded_run(label,outlines,detailed,rotations,limit=90):
    ctx=multiprocessing.get_context("spawn")
    result_queue=ctx.Queue(maxsize=1)
    process=ctx.Process(target=worker,args=(outlines,detailed,rotations,result_queue))
    process.start()
    process.join(limit)
    if process.is_alive():
        process.terminate();process.join(3)
        if process.is_alive():
            process.kill();process.join(3)
        result={"ok":False,"timeout":True}
    else:
        try:result=result_queue.get(timeout=2)
        except queue.Empty:result={"ok":False,"error":f"No solver result (exit={process.exitcode})"}
    result_queue.close()
    return {"mode":label,**result}

if __name__=="__main__":
    # Compare complete historical kits, never count an orphan base or lid.
    kits=read_kits()
    cases=[]
    for kit_count in (10,11,12):
        data=[d for kit in kits[:kit_count] for d in kit]
        outlines,detailed=contours(data)
        start=time.monotonic()
        results=[bounded_run("4 rotations",outlines,detailed,FOUR),
                 bounded_run("8 rotations",outlines,detailed,EIGHT)]
        cases.append({"completeKitsRequested":kit_count,"parts":len(outlines),
                      "results":results,"totalSeconds":round(time.monotonic()-start,2)})
    print("IRONNEST_HISTORICAL_PLATE="+json.dumps({
        "fixture":"Existing historical plate 113; sampled contours only",
        "plateMm":[W,H],"solverGapMm":GAP_SEARCH,"hardGapMm":GAP_HARD,
        "cases":cases,"productionReady":False,
        "caveat":"Historical rather than current 39 parts; strict production detailed-SVG verification still required."
    },ensure_ascii=False),flush=True)
