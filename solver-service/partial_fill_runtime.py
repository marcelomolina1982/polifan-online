"""Post-procesador de aprovechamiento residual.

Después de que Sparrow obtiene la mejor placa con >=10 completas, intenta agregar UNA
base o tapa de otro kit en el espacio sobrante, sin mover las piezas certificadas.
La pieza extra NO suma completeFigures y queda marcada para que el frontend registre
la contraparte faltante para el próximo corte.
"""
from flask import request, jsonify
import nest_sparrow as ns
from fixed_hole_fill import try_add_partial_fixed

LAB_GAP_MM=2.5

def _prepare_current_request():
    data=request.get_json(silent=True) or {}
    width=max(1.0,ns._n(data.get('widthCm'),122)*10)
    height=max(1.0,ns._n(data.get('heightCm'),58)*10)
    raw=sorted(data.get('kits') or [],key=lambda k:(ns._priority(k),str(k.get('date') or ''),str(k.get('figure') or '')))[:72]
    prepared=[]
    for k in raw:
        try:
            p=ns._prep_kit(k,width,height)
            p['date']=str(k.get('date') or '')
            prepared.append(p)
        except Exception:
            pass
    return prepared

def with_partial_fill(base_solver):
    def solver():
        response=base_solver()
        try:
            payload=response.get_json() if hasattr(response,'get_json') else None
        except Exception:
            payload=None
        if not isinstance(payload,dict) or not payload.get('ok') or int(payload.get('completeFigures') or 0)<10:
            return response
        try:
            prepared=_prepare_current_request()
            if not prepared:return response
            selected_ids={str(p.get('kitId') or '') for p in (payload.get('placements') or []) if p.get('kitId') and not p.get('partialExtra')}
            selected=[k for k in prepared if str(k.get('kitId') or '') in selected_ids]
            if len(selected)<10:return response
            base_result={
                'placements':list(payload.get('placements') or []),
                'density':float(payload.get('density') or 0),
                'stripWidthMm':float(payload.get('stripWidthMm') or 0),
                'fits':True,
            }
            extra=try_add_partial_fixed(selected,base_result,prepared,LAB_GAP_MM,max_candidates=30)
            if not extra:return response
            result,meta=extra
            payload['placements']=result.get('placements') or payload.get('placements') or []
            payload['density']=float(result.get('density') or payload.get('density') or 0)
            payload['stripWidthMm']=float(result.get('stripWidthMm') or payload.get('stripWidthMm') or 0)
            payload['partialExtraAllowed']=True
            payload['partialExtra']=meta
            payload['loosePartFill']=True
            payload['fixedHoleFill']=True
            payload['unusedRightMm']=max(0.0,1220.0-float(payload.get('stripWidthMm') or 1220.0))
            payload['engine']=str(payload.get('engine') or 'Sparrow')+' + relleno base/tapa residual'
            return jsonify(payload)
        except Exception as exc:
            # El relleno parcial jamás puede romper una placa completa válida.
            try:
                payload['partialFillSkipped']=str(exc)
                return jsonify(payload)
            except Exception:
                return response
    solver.__name__=getattr(base_solver,'__name__','solver')+'_partial_fill'
    solver.polifan_partial_fill=True
    return solver
