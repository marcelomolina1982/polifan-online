import time, uuid
from flask import jsonify, request, Response
import ironnest
import benchmark_routes as br

app=br.app

def _outline(geom):
    if geom.geom_type=='MultiPolygon': geom=max(geom.geoms,key=lambda g:g.area)
    pts=[(float(x),float(y)) for x,y in list(geom.exterior.coords)[:-1]]
    if len(pts)<3: raise ValueError('Silueta con menos de 3 vertices')
    return pts

def _run_ironnest(kits):
    items=[]; ids=[]
    for k in kits:
        for p in (k.get('parts') or []): items.append(_outline(p['geom'])); ids.append(str(p.get('instanceId')))
    container=[(0.,0.),(br.PLATE_WIDTH_MM,0.),(br.PLATE_WIDTH_MM,br.PLATE_HEIGHT_MM),(0.,br.PLATE_HEIGHT_MM)]
    started=time.time()
    placements,unplaced=ironnest.nest(items,qty=[1]*len(items),container=container,holes=[],min_sep=br.GAP_MM,rotations=[float(x) for x in range(0,360,15)],seed=1777,budget=900,strategy='nfp',column_weight=3,restarts=8,separation_effort='max')
    out=[]
    for item_idx,x,y,angle in placements:
        idx=int(item_idx); out.append({'instanceId':ids[idx],'name':ids[idx],'xCm':float(x)/10.,'yCm':float(y)/10.,'angle':float(angle)})
    return out,[int(x) for x in unplaced],round(time.time()-started,2)

def _execute(svg_text):
    kits,parser=br._extract_piece_kits(svg_text)
    if not kits:return {'ok':False,'error':'No se detectaron siluetas cerradas utilizables'},422
    trace=uuid.uuid4().hex[:12]
    try: placements,unplaced,elapsed=_run_ironnest(kits)
    except Exception as exc:return {'ok':False,'engine':'IronNest hard-bound','traceId':trace,'pieceCount':len(kits),'parser':parser,'error':str(exc)},422
    validation,rows=br._validate_layout(kits,placements); all_placed=(len(placements)==len(kits) and not unplaced); valid=bool(all_placed and validation.get('ok')); preview=None
    if rows: br._BENCH_RESULTS[trace]=br._svg_preview(rows); preview=f'/benchmark-result/{trace}.svg'
    return {'ok':valid,'engine':'IronNest hard-bound NFP','traceId':trace,'parser':parser,'pieceCount':len(kits),'placedCount':len(placements),'unplacedCount':len(unplaced),'unplacedItemIndexes':unplaced,'workspaceMm':[br.PLATE_WIDTH_MM,br.PLATE_HEIGHT_MM],'gapMm':br.GAP_MM,'elapsedSeconds':elapsed,'layoutValidation':validation,'placements':placements if valid else [],'previewSvgUrl':preview,'error':None if valid else 'IronNest no logro colocar y validar las piezas dentro del limite duro'},200 if valid else 422

@app.get('/ironnest-health',endpoint='ironnest_health')
def ironnest_health(): return jsonify(ok=True,engine='IronNest hard-bound NFP',workspaceMm=[1230,580],gapMm=2.5)

@app.route('/upload-ironnest',methods=['GET','POST'],endpoint='ironnest_upload')
def ironnest_upload():
    if request.method=='GET':
        html='''<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>IronNest formulario</title></head><body style="margin:0;background:#fff;color:#111;font-family:Arial,sans-serif"><main style="max-width:650px;margin:auto;padding:24px 18px"><h1>Prueba IronNest</h1><p>Placa 1230 × 580 mm · separación 2,5 mm.</p><form method="POST" action="/upload-ironnest" enctype="multipart/form-data"><div style="border:2px solid #222;border-radius:12px;padding:16px;background:#f3f3f3"><label for="svgfile" style="display:block;font-weight:bold;font-size:17px;margin-bottom:10px">1. Seleccioná pedido 08-08-2.svg</label><input id="svgfile" name="file" type="file" required style="display:block;width:100%;font-size:16px;background:#fff;border:1px solid #777;padding:12px;box-sizing:border-box"></div><button type="submit" style="margin-top:16px;width:100%;padding:18px;background:#111;color:#fff;border:0;border-radius:10px;font-size:18px;font-weight:bold">2. PROBAR MOTOR NUEVO</button></form><p style="margin-top:18px;font-size:13px;color:#666">Versión FORMULARIO v5 · sin JavaScript. Al tocar PROBAR MOTOR el navegador envía el archivo directamente al servidor.</p></main></body></html>'''
        return Response(html,200,content_type='text/html; charset=utf-8',headers={'Cache-Control':'no-store, no-cache, must-revalidate, max-age=0','Pragma':'no-cache'})
    up=request.files.get('file')
    if not up:return jsonify(ok=False,error='Falta archivo SVG'),400
    try:
        data=up.read()
        if not data:return jsonify(ok=False,error='El archivo esta vacio'),422
        text=data.decode('utf-8-sig')
        if '<svg' not in text.lower():return jsonify(ok=False,error='El archivo seleccionado no contiene un SVG valido'),422
        result,status=_execute(text); return jsonify(result),status
    except Exception as exc:return jsonify(ok=False,error=f'No se pudo procesar el SVG: {exc}'),422
