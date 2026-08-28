"""Best-effort v4: ancla urgentes y rellena la placa por lotes para no gastar el tiempo probando una pieza por corrida."""
from flask import jsonify, request
import time, uuid

import clean_lab_app as base
from clean_lab_app import app, core, GAP_MM, _attempt, _best_same_set
from cavity_postfill import try_add_one as cavity_try_add_one

PLATE_WIDTH_MM = 1230.0
PLATE_HEIGHT_MM = 580.0
PLATE_AREA_MM2 = PLATE_WIDTH_MM * PLATE_HEIGHT_MM
base.PLATE_WIDTH_MM = PLATE_WIDTH_MM
base.PLATE_HEIGHT_MM = PLATE_HEIGHT_MM
base.PLATE_AREA_MM2 = PLATE_AREA_MM2
core.PLATE_WIDTH_MM = PLATE_WIDTH_MM
core.PLATE_HEIGHT_MM = PLATE_HEIGHT_MM
core.PLATE_AREA_MM2 = PLATE_AREA_MM2

BUILD = "best-effort-multipass-v4-1230-exact-plus-one-2026-08-28"
DEFAULT_BUDGET_SECONDS = 180
MAX_POOL_V4 = 120

def _material_area(rows): return sum(float(k.get('area') or 0) for k in rows)
def _metrics(rows,result):
    area=_material_area(rows);strip=float(result.get('stripWidthMm') or 0);strip_area=strip*PLATE_HEIGHT_MM if strip>0 else 0
    return {'materialAreaMm2':round(area,2),'plateAreaMm2':round(PLATE_AREA_MM2,2),'geometricOccupancyPct':round(100*area/PLATE_AREA_MM2,3),'stripWidthMm':round(strip,3),'stripWidthUsagePct':round(100*strip/PLATE_WIDTH_MM,3) if strip else 0.0,'materialInsideUsedStripPct':round(100*area/strip_area,3) if strip_area else 0.0,'sparrowReportedDensityPct':round(float(result.get('solverDensity') or 0),3)}

def _interleave(orders,limit=None):
    out=[];seen=set();i=0
    while limit is None or len(out)<limit:
        progressed=False
        for rows in orders:
            if i<len(rows):
                row=rows[i];kid=row.get('kitId');progressed=True
                if kid not in seen:
                    seen.add(kid);out.append(row)
                    if limit and len(out)>=limit:return out
        if not progressed:break
        i+=1
    return out

def _rank_remaining(selected,kits):
    used={k.get('kitId') for k in selected};remain=[k for k in kits if k.get('kitId') not in used]
    return _interleave([sorted(remain,key=lambda k:(k.get('priority',999999),-k.get('area',0))),sorted(remain,key=lambda k:(-k.get('area',0),k.get('priority',999999))),sorted(remain,key=lambda k:(k.get('envelope',1e18),-k.get('solidity',0),k.get('priority',999999))),sorted(remain,key=lambda k:(k.get('area',1e18),k.get('priority',999999))),sorted(remain,key=lambda k:(-k.get('solidity',0),k.get('priority',999999)))])

def _residual_candidates(selected,kits,limit=28):
    used={k.get('kitId') for k in selected};remain=[k for k in kits if k.get('kitId') not in used]
    return _interleave([sorted(remain,key=lambda k:(k.get('envelope',1e18),k.get('area',1e18),k.get('priority',999999))),sorted(remain,key=lambda k:(k.get('area',1e18),k.get('envelope',1e18),k.get('priority',999999))),sorted(remain,key=lambda k:(-k.get('solidity',0),k.get('envelope',1e18),k.get('priority',999999))),sorted(remain,key=lambda k:(k.get('priority',999999),k.get('envelope',1e18)))],limit)

def _pair_candidates(selected,kits,limit=20):
    incoming=_residual_candidates(selected,kits,10);pairs=[]
    for i,a in enumerate(incoming):
        for b in incoming[i+1:]:
            score=(float(a.get('envelope') or 1e18)+float(b.get('envelope') or 1e18),float(a.get('area') or 1e18)+float(b.get('area') or 1e18),int(a.get('priority') or 999999)+int(b.get('priority') or 999999))
            pairs.append((score,a,b))
    pairs.sort(key=lambda row:row[0]);return [(a,b) for _,a,b in pairs[:limit]]

def _target_escape_orders(selected,kits):
    used={k.get('kitId') for k in selected};pending=[k for k in kits if k.get('kitId') not in used]
    if len(pending)!=1:return []
    p=pending[0];base_rows=list(selected)
    variants=[
        ('pendiente-primero',[p]+base_rows),
        ('pendiente-ultimo',base_rows+[p]),
        ('compactas-primero',sorted(base_rows+[p],key=lambda k:(k.get('envelope',1e18),k.get('area',1e18)))),
        ('grandes-primero',sorted(base_rows+[p],key=lambda k:(-float(k.get('area') or 0),k.get('envelope',1e18)))),
        ('densas-primero',sorted(base_rows+[p],key=lambda k:(-float(k.get('solidity') or 0),k.get('envelope',1e18)))),
    ]
    out=[];seen=set()
    for label,rows in variants:
        sig=tuple(k.get('kitId') for k in rows)
        if sig in seen:continue
        seen.add(sig);out.append((label,rows))
    return out

def _swap_variants(selected,kits,anchor_kept,limit=18):
    incoming=_residual_candidates(selected,kits,12);out=[];seen=set()
    removable=list(enumerate(selected))[max(0,anchor_kept):]
    removable=sorted(removable,key=lambda t:(-float(t[1].get('envelope') or 0),float(t[1].get('solidity') or 0),-int(t[1].get('priority') or 999999)))[:6]
    for idx,old in removable:
        for new in incoming:
            rows=list(selected);rows[idx]=new
            sig=tuple(k.get('kitId') for k in rows)
            if sig in seen:continue
            seen.add(sig);out.append((f'{old.get("figure")}→{new.get("figure")}',rows,old,new))
            if len(out)>=limit:return out
    return out

def _attempt_rows(rows,attempts,phase,label,seed,seconds,continuous):
    result=core._run_sparrow(rows,GAP_MM,seconds,seed,continuous=continuous);_attempt(attempts,phase,label,rows,result,seed,continuous);return result

def solve_v4():
    data=request.get_json(silent=True) or {};trace_id=uuid.uuid4().hex[:12];started=time.time();budget=max(60,min(240,int(data.get('budgetSeconds') or DEFAULT_BUDGET_SECONDS)));anchor_requested=max(1,min(16,int(data.get('urgentAnchorCount') or 6)))
    raw=sorted(data.get('kits') or [],key=lambda k:(core._priority(k),str(k.get('date') or ''),str(k.get('figure') or '')))[:MAX_POOL_V4]
    if not raw:return jsonify(ok=False,error='No llegaron figuras al motor',traceId=trace_id),400
    kits=[];rejected=[]
    for k in raw:
        try:kits.append(core._prep_kit(k,PLATE_WIDTH_MM,PLATE_HEIGHT_MM))
        except Exception as exc:rejected.append({'kitId':str(k.get('kitId') or ''),'figure':str(k.get('figure') or ''),'reason':str(exc)})
    if not kits:return jsonify(ok=False,error='No hay geometria SVG utilizable',traceId=trace_id,rejected=rejected[:16]),422
    attempts=[];selected=None;best_result=None;anchor_kept=0
    for count in range(min(anchor_requested,len(kits)),0,-1):
        if time.time()-started>budget-35:break
        rows=kits[:count];result=_attempt_rows(rows,attempts,'urgent-anchor',f'top-{count}',1501+count*113,8,False)
        if result.get('ok') and result.get('fits'):selected,best_result,anchor_kept=list(rows),result,count;break
    if selected is None:
        for idx,row in enumerate(kits[:16]):
            if time.time()-started>budget-25:break
            result=_attempt_rows([row],attempts,'single-fallback',str(row.get('figure') or ''),2101+idx*67,4,False)
            if result.get('ok') and result.get('fits'):selected,best_result=[row],result;anchor_kept=1 if idx==0 else 0;break
    if selected is None:return jsonify(ok=False,error='No se pudo colocar ninguna pieza valida',build=BUILD,traceId=trace_id,rejected=rejected[:16],attempts=attempts,elapsedSeconds=round(time.time()-started,2)),422
    batch_accepts=[]
    for batch_size in (8,4,2,1):
        while time.time()-started<budget-68:
            ranked=_rank_remaining(selected,kits)
            if not ranked:break
            batch=ranked[:batch_size]
            if len(batch)<batch_size and batch_size>1:break
            rows=selected+batch;remaining=budget-(time.time()-started);seconds=min(12 if batch_size>=4 else 9,max(5,int(remaining-63)));seed=4001+len(selected)*131+batch_size*43+len(attempts)*17
            result=_attempt_rows(rows,attempts,'batch-fill',f'+{len(batch)} candidatos',seed,seconds,False)
            if result.get('ok') and result.get('fits'):selected.extend(batch);best_result=result;batch_accepts.append(len(batch));continue
            break
    rescue_rounds=0;residual_attempts=0
    while time.time()-started<budget-58:
        ranked=_residual_candidates(selected,kits,28)
        if not ranked:break
        accepted=False
        for idx,cand in enumerate(ranked):
            remaining=budget-(time.time()-started)
            if remaining<54:break
            rows=selected+[cand];seeds=[7001+rescue_rounds*503+idx*89+len(selected)*29]
            if idx<8 and remaining>62:seeds.append(17011+rescue_rounds*607+idx*131+len(selected)*37)
            for seed in seeds:
                remaining=budget-(time.time()-started)
                if remaining<48:break
                result=_attempt_rows(rows,attempts,'residual-cavity-rescue',f'agregar:{cand.get("figure")}',seed,min(8,max(4,int(remaining-44))),True);residual_attempts+=1
                if result.get('ok') and result.get('fits'):selected.append(cand);best_result=result;rescue_rounds+=1;accepted=True;break
            if accepted:break
        if not accepted:break

    # PASS 3A: when only one whole kit is missing, spend a deliberate search reserve on
    # the exact target set. Different item orders + seeds are cheap compared with losing
    # one complete figure. This is specifically designed for the proven 22 -> 23 case.
    exact_plus_one_attempts=0;exact_plus_one_accepted=0;exact_plus_one_strategy=None
    if len(kits)-len(selected)==1 and time.time()-started<budget-28:
        for oidx,(label,rows) in enumerate(_target_escape_orders(selected,kits)):
            remaining=budget-(time.time()-started)
            if remaining<23:break
            seconds=min(14,max(8,int((remaining-8)/max(1,5-oidx))))
            result=_attempt_rows(rows,attempts,'exact-plus-one-escape',label,52003+oidx*1877,seconds,True);exact_plus_one_attempts+=1
            if result.get('ok') and result.get('fits'):
                selected=list(rows);best_result=result;exact_plus_one_accepted=1;exact_plus_one_strategy=label;break

    # PASS 3B: preserve the already-certified Sparrow arrangement and search its true
    # residual cavities directly for one whole pending kit.
    cavity_attempted=0;cavity_accepted=0;cavity_added=None;cavity_certified=False
    if len(selected)<len(kits) and time.time()-started<budget-14:
        remaining=budget-(time.time()-started)
        cand,new_result,diag=cavity_try_add_one(selected,kits,best_result,PLATE_WIDTH_MM,PLATE_HEIGHT_MM,GAP_MM,edge_mm=3.0,max_seconds=min(12,max(3,remaining-6)),max_candidates=14)
        cavity_attempted=int(diag.get('attempted') or 0);cavity_certified=bool(diag.get('certified'))
        if cand is not None:
            selected.append(cand);best_result=new_result;cavity_accepted=1;cavity_added=cand.get('figure')

    # PASS 4: try two pending complete figures together. Greedy +1 can miss complementary cavities.
    pair_attempts=0;pair_accepted=0
    if time.time()-started<budget-22 and len(kits)-len(selected)>=2:
        for pidx,(a,b) in enumerate(_pair_candidates(selected,kits,20)):
            remaining=budget-(time.time()-started)
            if remaining<16:break
            rows=selected+[a,b]
            result=_attempt_rows(rows,attempts,'residual-pair-rescue',f'+2:{a.get("figure")} + {b.get("figure")}',41003+pidx*271,min(7,max(4,int(remaining-11))),True);pair_attempts+=1
            if result.get('ok') and result.get('fits'):
                selected=rows;best_result=result;pair_accepted=2;break
    # PASS 5: repacking by substitution. A locally awkward kit can block two better-fitting kits.
    swap_attempts=0;swap_accepted=0
    if time.time()-started<budget-18 and len(selected)<len(kits):
        original_ids={k.get('kitId') for k in selected}
        for vidx,(label,variant,old,new) in enumerate(_swap_variants(selected,kits,anchor_kept,18)):
            remaining=budget-(time.time()-started)
            if remaining<14:break
            result=_attempt_rows(variant,attempts,'residual-swap-repack',label,23003+vidx*211,min(6,max(4,int(remaining-10))),True);swap_attempts+=1
            if not(result.get('ok') and result.get('fits')):continue
            extra=[k for k in _residual_candidates(variant,kits,12) if k.get('kitId') not in original_ids or k.get('kitId')==old.get('kitId')]
            for eidx,cand in enumerate(extra):
                remaining=budget-(time.time()-started)
                if remaining<9:break
                grown=variant+[cand];grow=_attempt_rows(grown,attempts,'swap-plus-one',f'{label} + {cand.get("figure")}',31013+vidx*307+eidx*61,min(5,max(3,int(remaining-6))),True);swap_attempts+=1
                if grow.get('ok') and grow.get('fits'):
                    selected=grown;best_result=grow;swap_accepted+=1;break
            if swap_accepted:break
    for idx,seed in enumerate((8111,10903,13217,17837)):
        remaining=budget-(time.time()-started)
        if remaining<7:break
        result=_attempt_rows(selected,attempts,'final-refine','mismo-conjunto',seed+idx*19,min(14,max(5,int(remaining-2))),True);best_result=_best_same_set(best_result,result)
    m=_metrics(selected,best_result)
    return jsonify(ok=True,build=BUILD,traceId=trace_id,engine='Sparrow best-effort multipass v4 · 1230 exact +1 escape + certified cavity',completeFigures=len(selected),placements=best_result.get('placements') or [],selectedKitIds=[k.get('kitId') for k in selected],urgentAnchorsRequested=anchor_requested,urgentAnchorsKept=anchor_kept,candidatePool=len(kits),rawPoolConsidered=len(raw),maxPool=MAX_POOL_V4,gapMm=GAP_MM,widthCm=123,heightCm=58,minimumCompleteFigures=None,minimumDensity=None,noArtificialMinimum=True,bestEffort=True,budgetSeconds=budget,batchAccepts=batch_accepts,batchAdded=sum(batch_accepts),rescueRounds=rescue_rounds,residualAttempts=residual_attempts,exactPlusOneAttempts=exact_plus_one_attempts,exactPlusOneAccepted=exact_plus_one_accepted,exactPlusOneStrategy=exact_plus_one_strategy,cavityAttempted=cavity_attempted,cavityAccepted=cavity_accepted,cavityAdded=cavity_added,cavityCertified=cavity_certified,pairAttempts=pair_attempts,pairAccepted=pair_accepted,swapAttempts=swap_attempts,swapAccepted=swap_accepted,stoppedBecause='no-more-fit-or-time-budget',rejected=rejected[:16],rejectedCount=len(rejected),attempts=attempts,elapsedSeconds=round(time.time()-started,2),**m)

@app.post('/solve-v4')
def solve_v4_route():return solve_v4()
