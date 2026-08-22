from flask import request, jsonify
import time
import nest_sparrow as ns

# EMERGENCIA: priorizar una placa cortable certificada antes de gastar todo el
# presupuesto intentando reconstruir exactamente 10.
_original_solver = ns.nest_sparrow
MIN_FALLBACK_SIZE = 6
MAX_FALLBACK_SECONDS = 105
MAX_VARIANTS_PER_SIZE = 6


def _try_smaller_plate():
    started=time.time(); data=request.get_json(silent=True) or {}
    width_mm=max(1.0,ns._n(data.get('widthCm'),122)*10)
    height_mm=max(1.0,ns._n(data.get('heightCm'),58)*10)
    gap=max(3.0,ns._n(data.get('gapCm'),.3)*10)
    raw=sorted(data.get('kits') or [],key=lambda k:(ns._priority(k),str(k.get('date') or ''),str(k.get('figure') or '')))[:40]
    kits=[]; rejected=[]
    for k in raw:
        try:kits.append(ns._prep_kit(k,width_mm,height_mm))
        except Exception as exc:rejected.append({'kitId':str(k.get('kitId') or ''),'figure':str(k.get('figure') or ''),'reason':str(exc)})
    if len(kits)<MIN_FALLBACK_SIZE:return None
    attempts=[]
    for size in range(min(9,len(kits)),MIN_FALLBACK_SIZE-1,-1):
        variants=[]; seen=set()
        try:rows=ns._candidate_selections(kits,size)
        except Exception:rows=[]
        for label,selected in rows:
            sig=tuple(k.get('kitId') for k in selected)
            if sig in seen:continue
            seen.add(sig);variants.append((label,selected))
            if len(variants)>=MAX_VARIANTS_PER_SIZE:break
        if not variants and len(kits)>=size:variants=[('prioridad directa',kits[:size])]
        for idx,(label,selected) in enumerate(variants):
            remaining=MAX_FALLBACK_SECONDS-(time.time()-started)
            if remaining<9:return None
            seconds=18 if size==9 and idx<3 else 12
            seconds=max(7,min(seconds,int(remaining-3)))
            seed=(41,429,701,235,1059,1701)[idx%6]+size*17
            result=ns._run_sparrow(selected,gap,seconds,seed,continuous=False)
            attempts.append({'size':size,'label':label,'seed':seed,'fits':result.get('fits'),'placedParts':result.get('placedParts'),'expectedParts':result.get('expectedParts'),'stripWidthMm':result.get('stripWidthMm'),'density':round(float(result.get('density') or 0),1)})
            if result.get('ok') and result.get('fits'):
                response=ns._result_payload(selected,f'EMERGENCIA CORTE · placa valida de {size}',result,kits,rejected,attempts,started,None)
                payload=response.get_json();payload.update({'engine':'Sparrow emergencia corte · fallback primero','emergencyFallback':True,'reachedMinimum':size>=10,'completeCount':size,'completeFigures':size,'minimumGapMm':gap,'message':f'Produccion de emergencia: placa valida de {size} figuras completas.'})
                return jsonify(payload)
    return None


def emergency_cut_solver():
    smaller=_try_smaller_plate()
    if smaller is not None:return smaller
    return _original_solver()

ns.nest_sparrow=emergency_cut_solver
if 'nest_sparrow' in ns.app.view_functions:ns.app.view_functions['nest_sparrow']=emergency_cut_solver
