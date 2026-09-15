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
        html='''<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>IronNest</title></head><body style="margin:0;background:#fff;color:#111;font-family:Arial,sans-serif"><main style="max-width:650px;margin:auto;padding:24px 18px"><h1>Prueba IronNest</h1><p>Placa 1230 × 580 mm · separación 2,5 mm.</p><input id="svgfile" type="file" accept=".svg,image/svg+xml" style="position:absolute;left:-10000px"><label for="svgfile" style="display:block;background:#eee;border:2px solid #222;border-radius:10px;padding:18px;text-align:center;font-size:18px;font-weight:bold">📁 ELEGIR SVG DEL CELULAR</label><div id="chosen" style="min-height:24px;margin:12px 0">Todavía no seleccionaste archivo.</div><button id="go" type="button" style="width:100%;padding:17px;background:#111;color:white;border:0;border-radius:10px;font-size:18px;font-weight:bold">PROBAR MOTOR NUEVO</button><div id="status" style="display:none;margin-top:18px;padding:16px;border-radius:10px;background:#f2f2f2;white-space:pre-wrap;word-break:break-word;font-size:14px"></div></main><script>
const f=document.getElementById('svgfile'),c=document.getElementById('chosen'),b=document.getElementById('go'),s=document.getElementById('status');
f.onchange=()=>{c.textContent=f.files&&f.files[0]?'Seleccionado: '+f.files[0].name:'Todavía no seleccionaste archivo.'};
b.onclick=async()=>{if(!f.files||!f.files[0]){s.style.display='block';s.textContent='Primero elegí el SVG.';return} b.disabled=true;b.textContent='PROCESANDO...';s.style.display='block';s.textContent='Subiendo SVG al laboratorio…\nLuego IronNest va a intentar acomodar las piezas. No cierres esta pantalla.';try{const fd=new FormData();fd.append('file',f.files[0],f.files[0].name);const r=await fetch('/upload-ironnest',{method:'POST',body:fd,cache:'no-store'});const t=await r.text();let x;try{x=JSON.parse(t)}catch(e){throw new Error('Respuesta no válida del servidor: '+t.slice(0,300))}s.textContent=(r.ok?'RESULTADO:\n':'ERROR DEL MOTOR:\n')+JSON.stringify(x,null,2)}catch(e){s.textContent='ERROR DE CONEXIÓN:\n'+e.message}finally{b.disabled=false;b.textContent='PROBAR MOTOR NUEVO'}};
</script></body></html>'''
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
