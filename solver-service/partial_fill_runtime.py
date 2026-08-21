"""Post-procesador residual Sparrow V1.13 / Caso 10.

Después de obtener la mejor placa certificada con >=10 completas, intenta primero
agregar figuras COMPLETAS en los huecos residuales sin mover ninguna pieza de la
placa base. Sólo si no entra ninguna completa y todavía falta ocupación, conserva
el relleno residual de bases/tapas sueltas existente.
"""
from flask import request, jsonify
import nest_sparrow as ns
from fixed_hole_fill import try_add_complete_fixed
from residual_fill_v13 import try_iterative_residual_fill

LAB_GAP_MM=2.5
COMPLETE_GAP_MM=3.0
TARGET_DENSITY=70.0
MAX_COMPLETE_RESIDUAL=3


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
            base_result={'placements':list(payload.get('placements') or []),'density':float(payload.get('density') or 0),'stripWidthMm':float(payload.get('stripWidthMm') or 0),'fits':True}

            # CASO 10: antes de aceptar piezas sueltas, buscar kits enteros en los
            # huecos existentes. La placa ya resuelta NO se mueve ni se recompone.
            complete_added=[]
            while len(complete_added)<MAX_COMPLETE_RESIDUAL and float(base_result.get('density') or 0)<TARGET_DENSITY:
                grown=try_add_complete_fixed(selected,base_result,prepared,COMPLETE_GAP_MM,max_candidates=24)
                if not grown:break
                selected,base_result,kit=grown
                complete_added.append({'kitId':kit.get('kitId'),'figure':kit.get('figure')})

            if complete_added:
                payload['placements']=list(base_result.get('placements') or [])
                payload['density']=float(base_result.get('density') or payload.get('density') or 0)
                payload['stripWidthMm']=float(base_result.get('stripWidthMm') or payload.get('stripWidthMm') or 0)
                payload['completeFigures']=len(selected)
                payload['completeResidualFill']=True
                payload['completeResidualAdded']=complete_added
                payload['completeResidualCount']=len(complete_added)
                payload['fixedHoleFill']=True
                payload['unusedRightMm']=max(0.0,1220.0-float(payload.get('stripWidthMm') or 1220.0))
                payload['engine']=str(payload.get('engine') or 'Sparrow')+f' + Complete Residual Fill ({len(complete_added)} completa(s))'

            # Si una o más completas ya llevaron la placa al objetivo, terminamos.
            # Si no, mantenemos el residual suelto preexistente como último recurso.
            if float(base_result.get('density') or 0)>=TARGET_DENSITY:
                return jsonify(payload)

            extra=try_iterative_residual_fill(selected,base_result,prepared,LAB_GAP_MM,max_extras=3,target_density=TARGET_DENSITY,max_candidates=48)
            if not extra:
                return jsonify(payload) if complete_added else response
            result,metas=extra
            payload['placements']=result.get('placements') or payload.get('placements') or []
            payload['density']=float(result.get('density') or payload.get('density') or 0)
            payload['stripWidthMm']=float(result.get('stripWidthMm') or payload.get('stripWidthMm') or 0)
            payload['completeFigures']=len(selected)
            payload['partialExtraAllowed']=True
            payload['partialExtras']=metas
            payload['partialExtra']=metas[0] if metas else None
            payload['partialExtraCount']=len(metas)
            payload['loosePartFill']=True
            payload['fixedHoleFill']=True
            payload['residualFillV13']=True
            payload['unusedRightMm']=max(0.0,1220.0-float(payload.get('stripWidthMm') or 1220.0))
            payload['engine']=str(payload.get('engine') or 'Sparrow')+f' + Residual Fill V1.13 ({len(metas)} extras)'
            return jsonify(payload)
        except Exception as exc:
            try:
                payload['partialFillSkipped']=str(exc)
                return jsonify(payload)
            except Exception:
                return response
    solver.__name__=getattr(base_solver,'__name__','solver')+'_partial_fill'
    solver.polifan_partial_fill=True
    solver.polifan_residual_fill='v1.13-complete-first'
    solver.polifan_complete_residual=True
    return solver
