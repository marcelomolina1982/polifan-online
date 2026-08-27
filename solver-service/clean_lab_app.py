"""Motor de laboratorio Polifan: multi-pass best-effort con Sparrow.

Objetivos:
- placa util fija 1230 x 580 mm (placa fisica nueva 1260 x 600 mm)
- GAP duro de 3 mm
- preservar primero los pedidos urgentes
- rellenar con pedidos futuros mientras sigan entrando
- nunca exigir 70% ni una cantidad minima de figuras
- devolver siempre la mejor placa valida encontrada dentro del presupuesto de tiempo
"""
from flask import Flask, jsonify, request
from flask_cors import CORS
import time
import uuid

import nest_sparrow as core

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

BUILD = "best-effort-multipass-v1-123x58-lab-2026-08-27"
PLATE_WIDTH_MM = 1230.0
PLATE_HEIGHT_MM = 580.0
PLATE_AREA_MM2 = PLATE_WIDTH_MM * PLATE_HEIGHT_MM
GAP_MM = 3.0
MAX_POOL = 40
DEFAULT_ANCHORS = 6
DEFAULT_BUDGET_SECONDS = 90
QUICK_SECONDS = 5
REFINE_SECONDS = 14


def _identity():
    return {"name":"polifan_best_effort_multipass","placer":"sparrow","geometry":"real SVG polygons"}

def _material_area(rows): return sum(float(k.get("area") or 0) for k in rows)
def _occupancy(rows): return 100.0 * _material_area(rows) / PLATE_AREA_MM2 if rows else 0.0

def _metrics(rows, result):
    area=_material_area(rows); strip=float(result.get("stripWidthMm") or 0); strip_area=strip*PLATE_HEIGHT_MM if strip>0 else 0
    return {"materialAreaMm2":round(area,2),"plateAreaMm2":round(PLATE_AREA_MM2,2),"geometricOccupancyPct":round(100.0*area/PLATE_AREA_MM2,3),"stripWidthMm":round(strip,3),"stripWidthUsagePct":round(100.0*strip/PLATE_WIDTH_MM,3) if strip else 0.0,"materialInsideUsedStripPct":round(100.0*area/strip_area,3) if strip_area else 0.0,"sparrowReportedDensityPct":round(float(result.get("solverDensity") or 0),3)}

def _attempt(attempts,phase,label,rows,result,seed,continuous):
    m=_metrics(rows,result) if result.get("ok") else {}
    attempts.append({"phase":phase,"label":label,"count":len(rows),"seed":seed,"rotation":"continua" if continuous else "15deg","fits":bool(result.get("fits")),"geometricOccupancyPct":m.get("geometricOccupancyPct"),"stripWidthMm":m.get("stripWidthMm",result.get("stripWidthMm")),"solverDensityPct":m.get("sparrowReportedDensityPct"),"error":result.get("error")})

def _unique_candidates(rows):
    seen=set(); out=[]
    for row in rows:
        kid=row.get("kitId")
        if kid not in seen: seen.add(kid); out.append(row)
    return out

def _extension_candidates(selected,all_kits,limit=4):
    used={k.get("kitId") for k in selected}; remain=[k for k in all_kits if k.get("kitId") not in used]
    if not remain:return []
    urgent=sorted(remain,key=lambda k:(k.get("priority",999999),-k.get("area",0)))
    by_area=sorted(remain,key=lambda k:(-k.get("area",0),k.get("priority",999999)))
    compact=sorted(remain,key=lambda k:(k.get("envelope",1e18),-k.get("solidity",0),k.get("priority",999999)))
    dense=sorted(remain,key=lambda k:(-k.get("solidity",0),k.get("envelope",1e18),k.get("priority",999999)))
    return _unique_candidates(urgent[:2]+by_area[:2]+compact[:2]+dense[:2])[:limit]

def _candidate_score(base,candidate,result): return (_material_area(base+[candidate]),-float(candidate.get("priority") or 999999),-float(result.get("stripWidthMm") or 1e18))
def _best_same_set(current_result,challenger):
    if not challenger.get("ok") or not challenger.get("fits"):return current_result
    if not current_result or not current_result.get("fits"):return challenger
    a=float(current_result.get("stripWidthMm") or 1e18); b=float(challenger.get("stripWidthMm") or 1e18)
    if b<a-0.25:return challenger
    if abs(b-a)<=0.25 and float(challenger.get("solverDensity") or 0)>float(current_result.get("solverDensity") or 0):return challenger
    return current_result

@app.get("/health")
def health(): return jsonify(ok=True,build=BUILD,mode="best-effort-multipass",solver=_identity(),widthCm=123,heightCm=58,gapMm=GAP_MM,minimumCompleteFigures=None,minimumDensity=None)
@app.get("/runtime-info")
def runtime_info(): return jsonify(ok=True,build=BUILD,mode="best-effort-multipass",solver=_identity(),strategy=["anclar pedidos urgentes","rellenar iterativamente con futuros","probar candidatos por urgencia/area/compacidad","refinar con rotacion continua","devolver mejor resultado valido al vencer el tiempo"],widthCm=123,heightCm=58,gapMm=GAP_MM,minimumCompleteFigures=None,minimumDensity=None,defaultBudgetSeconds=DEFAULT_BUDGET_SECONDS)

@app.post("/solve")
def solve():
    data=request.get_json(silent=True) or {}; trace_id=uuid.uuid4().hex[:12]; started=time.time()
    raw=sorted(data.get("kits") or [],key=lambda k:(core._priority(k),str(k.get("date") or ""),str(k.get("figure") or "")))[:MAX_POOL]
    if not raw:return jsonify(ok=False,error="No llegaron figuras al motor",traceId=trace_id),400
    budget=max(25,min(150,int(data.get("budgetSeconds") or DEFAULT_BUDGET_SECONDS))); requested_anchors=int(data.get("urgentAnchorCount") or DEFAULT_ANCHORS)
    kits=[]; rejected=[]
    for k in raw:
        try:kits.append(core._prep_kit(k,PLATE_WIDTH_MM,PLATE_HEIGHT_MM))
        except Exception as exc:rejected.append({"kitId":str(k.get("kitId") or ""),"figure":str(k.get("figure") or ""),"reason":str(exc)})
    if not kits:return jsonify(ok=False,error="No hay geometria SVG utilizable",traceId=trace_id,rejected=rejected[:12]),422
    attempts=[]; selected=None; best_result=None; anchor_count_used=0; start_anchor=min(len(kits),max(1,requested_anchors))
    for count in range(start_anchor,0,-1):
        if time.time()-started>=budget-12:break
        rows=kits[:count]; seed=1103+count*97; seconds=min(QUICK_SECONDS+1,max(3,int(budget-(time.time()-started)-10))); result=core._run_sparrow(rows,GAP_MM,seconds,seed,continuous=False); _attempt(attempts,"urgent-anchor",f"top-{count}-urgentes",rows,result,seed,False)
        if result.get("ok") and result.get("fits"):selected=list(rows);best_result=result;anchor_count_used=count;break
    if selected is None:
        for idx,row in enumerate(kits[:10]):
            if time.time()-started>=budget-8:break
            seed=1709+idx*53;result=core._run_sparrow([row],GAP_MM,4,seed,continuous=False);_attempt(attempts,"single-fallback","pieza-individual",[row],result,seed,False)
            if result.get("ok") and result.get("fits"):selected=[row];best_result=result;anchor_count_used=1 if idx==0 else 0;break
    if selected is None:return jsonify(ok=False,error="Sparrow no pudo colocar ni una pieza valida",build=BUILD,traceId=trace_id,attempts=attempts,rejected=rejected[:12],elapsedSeconds=round(time.time()-started,2)),422
    fill_pass=0
    while time.time()-started<budget-20:
        candidates=_extension_candidates(selected,kits,limit=4)
        if not candidates:break
        fitted=[]
        for idx,cand in enumerate(candidates):
            remaining=budget-(time.time()-started)
            if remaining<20:break
            rows=selected+[cand];seed=2309+fill_pass*401+idx*83+len(rows)*17;seconds=min(QUICK_SECONDS,max(3,int(remaining-17)));result=core._run_sparrow(rows,GAP_MM,seconds,seed,continuous=False);_attempt(attempts,"fill",f"agregar:{cand.get('figure')}",rows,result,seed,False)
            if result.get("ok") and result.get("fits"):fitted.append((_candidate_score(selected,cand,result),cand,result))
        if not fitted:break
        fitted.sort(key=lambda x:x[0],reverse=True);_,winner,winner_result=fitted[0];selected.append(winner);best_result=winner_result;fill_pass+=1
    if time.time()-started<budget-16:
        extra_candidates=_extension_candidates(selected,kits,limit=3)
        for idx,cand in enumerate(extra_candidates):
            remaining=budget-(time.time()-started)
            if remaining<14:break
            rows=selected+[cand];seed=4703+idx*131+len(rows)*19;seconds=min(8,max(4,int(remaining-10)));result=core._run_sparrow(rows,GAP_MM,seconds,seed,continuous=True);_attempt(attempts,"continuous-extra",f"rotacion-libre:{cand.get('figure')}",rows,result,seed,True)
            if result.get("ok") and result.get("fits"):selected.append(cand);best_result=result;break
    for idx,seed in enumerate((7919,10429)):
        remaining=budget-(time.time()-started)
        if remaining<7:break
        seconds=min(REFINE_SECONDS,max(5,int(remaining-2)));result=core._run_sparrow(selected,GAP_MM,seconds,seed+idx*17,continuous=True);_attempt(attempts,"refine","mismo-conjunto",selected,result,seed+idx*17,True);best_result=_best_same_set(best_result,result)
    metrics=_metrics(selected,best_result)
    return jsonify(ok=True,build=BUILD,traceId=trace_id,engine="Sparrow multi-pass best-effort",historicalRuntimesLoaded=False,completeFigures=len(selected),urgentAnchorsRequested=start_anchor,urgentAnchorsKept=anchor_count_used,selectedKitIds=[k.get("kitId") for k in selected],placements=best_result.get("placements") or [],gapMm=GAP_MM,widthCm=123,heightCm=58,minimumCompleteFigures=None,minimumDensity=None,noArtificialMinimum=True,bestEffort=True,stoppedBecause="no-more-fit-or-time-budget",budgetSeconds=budget,rejected=rejected[:12],rejectedCount=len(rejected),attempts=attempts,elapsedSeconds=round(time.time()-started,2),**metrics)
