"""Lab-only startup smoke benchmark for TVT Revolutionary V4.

Python imports sitecustomize automatically. This file lives only on the
experimental lab branch and starts one concise V4 synthetic benchmark after
Gunicorn has booted. It does not touch production or inventory.
"""
import json
import threading
import time


def _part(kit_id, idx, width_mm, height_mm, kind='rect'):
    if kind == 'l':
        d=f'M 0 0 H {width_mm} V {height_mm*0.38:.3f} H {width_mm*0.46:.3f} V {height_mm} H 0 Z'
    elif kind == 'trap':
        d=f'M {width_mm*0.12:.3f} 0 H {width_mm*0.88:.3f} L {width_mm} {height_mm} H 0 Z'
    else:
        d=f'M 0 0 H {width_mm} V {height_mm} H 0 Z'
    svg=f'<svg xmlns="http://www.w3.org/2000/svg" width="{width_mm}mm" height="{height_mm}mm" viewBox="0 0 {width_mm} {height_mm}"><path d="{d}" fill="none" stroke="#000"/></svg>'
    return {
        'instanceId':f'{kit_id}-p{idx}',
        'name':f'pieza {idx+1}',
        'role':'base' if idx == 0 else 'tapa',
        'sourceWidthCm':width_mm/10.0,
        'sourceHeightCm':height_mm/10.0,
        'svgText':svg,
    }


def _run():
    time.sleep(10)
    try:
        import nest_sparrow as ns
        from revolutionary.ensemble_v4 import revolutionary_solve
        dims=[
            (118,88,'rect'),(126,82,'l'),(108,96,'trap'),(132,76,'rect'),
            (114,92,'l'),(124,84,'trap'),(106,98,'rect'),(136,74,'l'),
            (112,90,'trap'),(128,80,'rect'),(104,100,'l'),(134,72,'trap'),
            (116,86,'rect'),(122,88,'l'),(110,94,'trap'),(130,78,'rect'),
            (108,90,'l'),(120,82,'trap'),
        ]
        raw=[]
        for i,(w,h,kind) in enumerate(dims,1):
            kid=f'v4-smoke-{i:02d}'
            raw.append({
                'kitId':kid,'figure':f'V4 Smoke {i:02d}','priority':1,'date':'2026-08-22',
                'parts':[
                    _part(kid,0,w,h,kind),
                    _part(kid,1,max(76,w-16),max(58,h-14),'rect' if kind!='rect' else 'trap'),
                ],
            })
        prepared=[]
        for kit in raw:
            p=ns._prep_kit(kit,1220.0,580.0)
            p['date']=kit['date']
            prepared.append(p)
        result=revolutionary_solve(prepared,total_seconds=90.0,max_workers=4)
        cert=result.get('productionCertificate') or {}
        attempts=result.get('attempts') or []
        phases={}
        for a in attempts:
            ph=str(a.get('phase') or 'unknown')
            phases[ph]=phases.get(ph,0)+1
        summary={
            'ok':bool(result.get('ok')),
            'engine':result.get('engine'),
            'completeFigures':int(result.get('completeFigures') or 0),
            'initialComplete':result.get('initialComplete'),
            'probablePracticalMaximum':result.get('probablePracticalMaximum'),
            'density':round(float(result.get('density') or 0.0),2),
            'stripWidthMm':round(float(result.get('stripWidthMm') or 0.0),2),
            'minimumGapMm':result.get('minimumGapMm'),
            'collisionCount':int(cert.get('collisionCount') or 0),
            'outsidePlateCount':int(cert.get('outsidePlateCount') or 0),
            'selectionStrategy':result.get('selectionStrategy'),
            'attemptPhases':phases,
            'elapsedSeconds':result.get('elapsedSeconds'),
            'productionUntouched':True,
        }
        print('REV_V4_SMOKE '+json.dumps(summary,separators=(',',':'),ensure_ascii=False),flush=True)
    except Exception as exc:
        print('REV_V4_SMOKE '+json.dumps({'ok':False,'error':str(exc),'productionUntouched':True},separators=(',',':'),ensure_ascii=False),flush=True)

threading.Thread(target=_run,name='rev-v4-smoke',daemon=True).start()
