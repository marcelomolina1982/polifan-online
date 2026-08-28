"""Conservative Placa 07 regression.

Uses the real library bounding boxes for the 10 kits present on Placa 07 plus one
Mate Yuyero. Rectangles are supersets of the real paths, so fitting all 11 is a
stronger geometric test than fitting the actual irregular outlines.
"""
import json, threading, time
from clean_lab_app import app
from clean_lab_v4 import solve_v4

DIMS={
 'Osito':[(22.94792938232422,16.960835266113282),(22.9474,16.9931)],
 'Palabra Mamá':[(27.9411,9.3974),(27.962203979492188,9.469736480712891)],
 'Te amo':[(27.768591308593752,9.335147094726564),(27.878764445533108,9.658009299995445)],
 'Pelota':[(18.952,18.9521),(18.9615,18.9616)],
 'Mate con división':[(12.175360107421875,19.963909912109376),(12.175357055664064,19.963909912109376)],
 'Mate Yuyero':[(7.228263092041016,11.962400054931642),(7.22826156616211,11.962400054931642)],
}
COUNTS=[('Osito',4),('Palabra Mamá',1),('Te amo',1),('Pelota',1),('Mate con división',3),('Mate Yuyero',1)]

def rect_svg(w,h):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}cm" height="{h}cm" viewBox="0 0 {w*10} {h*10}"><rect x="0" y="0" width="{w*10}" height="{h*10}" fill="none" stroke="black"/></svg>'

def payload():
    kits=[];idx=0
    for fig,count in COUNTS:
        for _ in range(count):
            parts=[]
            for pidx,(w,h) in enumerate(DIMS[fig]):
                role='base' if pidx==0 else 'tapa'
                parts.append({'instanceId':f'p07-{idx}-p{pidx}','kitId':f'p07-{idx}','figure':fig,'name':f'{fig} {role}','role':role,'sourceWidthCm':w,'sourceHeightCm':h,'widthCm':w,'heightCm':h,'allowRotate':True,'svgText':rect_svg(w,h)})
            kits.append({'kitId':f'p07-{idx}','figure':fig,'date':'2026-09-02','priority':idx,'parts':parts});idx+=1
    return {'widthCm':123,'heightCm':58,'gapCm':.3,'kits':kits,'budgetSeconds':180,'urgentAnchorCount':4}

def run():
    time.sleep(8)
    started=time.time()
    try:
        with app.test_request_context('/solve-v4',method='POST',json=payload()): resp=solve_v4()
        status=200;body=resp
        if isinstance(resp,tuple): body,status=resp[0],int(resp[1])
        data=body.get_json(silent=True) if hasattr(body,'get_json') else body
        result={'marker':'POLIFAN_PLACA07_BBOX','httpStatus':status,'ok':bool(isinstance(data,dict) and data.get('ok')),'completeFigures':data.get('completeFigures') if isinstance(data,dict) else None,'candidatePool':data.get('candidatePool') if isinstance(data,dict) else None,'selectedKitIds':data.get('selectedKitIds') if isinstance(data,dict) else None,'batchAccepts':data.get('batchAccepts') if isinstance(data,dict) else None,'rescueRounds':data.get('rescueRounds') if isinstance(data,dict) else None,'residualAttempts':data.get('residualAttempts') if isinstance(data,dict) else None,'cavityAttempted':data.get('cavityAttempted') if isinstance(data,dict) else None,'cavityAccepted':data.get('cavityAccepted') if isinstance(data,dict) else None,'cavityAdded':data.get('cavityAdded') if isinstance(data,dict) else None,'cavityCertified':data.get('cavityCertified') if isinstance(data,dict) else None,'pairAccepted':data.get('pairAccepted') if isinstance(data,dict) else None,'swapAccepted':data.get('swapAccepted') if isinstance(data,dict) else None,'gapMm':data.get('gapMm') if isinstance(data,dict) else None,'widthCm':data.get('widthCm') if isinstance(data,dict) else None,'heightCm':data.get('heightCm') if isinstance(data,dict) else None,'attemptCount':len(data.get('attempts') or []) if isinstance(data,dict) else 0,'error':data.get('error') if isinstance(data,dict) else 'invalid','elapsedSeconds':round(time.time()-started,2)}
        print(json.dumps(result,ensure_ascii=False),flush=True)
    except Exception as exc:
        print(json.dumps({'marker':'POLIFAN_PLACA07_BBOX','ok':False,'error':str(exc),'elapsedSeconds':round(time.time()-started,2)},ensure_ascii=False),flush=True)

threading.Thread(target=run,daemon=True).start()
