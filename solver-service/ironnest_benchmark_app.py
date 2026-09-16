import time, uuid, threading, multiprocessing, queue
from flask import jsonify, request, Response, redirect, url_for
import ironnest
import benchmark_routes as br

app=br.app
_JOBS={}
_JOB_LOCK=threading.Lock()
_SOLVE_SEMAPHORE=threading.BoundedSemaphore(1)

# IronNest budget is a SAMPLE budget, not seconds.  The previous benchmark used
# the most expensive production-quality knobs at once (24 rotations, budget 900,
# 8 restarts, separation_effort=max).  On the free lab CPU that can explode the
# amount of exact-NFP work.  This benchmark intentionally starts bounded and fast.
IRON_ROTATIONS=[0.0,90.0,180.0,270.0]
IRON_EXTRA_ROTATIONS=[0.0,45.0,90.0,135.0,180.0,225.0,270.0,315.0]
IRON_EXTRA_ROTATION_ITEMS=(4,12)
IRON_BUDGET=60
IRON_RESTARTS=2
IRON_SEPARATION_EFFORT='fast'
IRON_STRATEGY='sampling'
IRON_SIMPLIFY_MM=1.2
IRON_SOLVE_TIMEOUT_SECONDS=180
# Search clearance is intentionally wider than the required clearance. The
# validator below checks the parser geometry and rejects any shortfall.
IRON_SOLVER_GAP_MM=br.GAP_MM+IRON_SIMPLIFY_MM+0.3

def _outline(geom):
    if geom.geom_type=='MultiPolygon': geom=max(geom.geoms,key=lambda g:g.area)
    geom=geom.simplify(IRON_SIMPLIFY_MM,preserve_topology=True)
    pts=[(float(x),float(y)) for x,y in list(geom.exterior.coords)[:-1]]
    if len(pts)<3: raise ValueError('Silueta con menos de 3 vertices')
    return pts

def _solve_process(items, container, rotation_sets, result_queue):
    try:
        result_queue.put(('ok', ironnest.nest(
            items, qty=[1]*len(items), container=container, holes=[],
            min_sep=IRON_SOLVER_GAP_MM, rotations=rotation_sets, seed=1777,
            budget=IRON_BUDGET, strategy=IRON_STRATEGY, column_weight=3,
            restarts=IRON_RESTARTS, separation_effort=IRON_SEPARATION_EFFORT)))
    except Exception as exc:
        result_queue.put(('error', repr(exc)))

def _run_ironnest(kits,job_id=None):
    items=[]; ids=[]
    for k in kits:
        for p in (k.get('parts') or []):
            items.append(_outline(p['geom']))
            ids.append(str(p.get('instanceId')))
    inset=IRON_SIMPLIFY_MM+0.1
    container=[(inset,inset),(br.PLATE_WIDTH_MM-inset,inset),(br.PLATE_WIDTH_MM-inset,br.PLATE_HEIGHT_MM-inset),(inset,br.PLATE_HEIGHT_MM-inset)]
    rotation_sets=[IRON_EXTRA_ROTATIONS if i in IRON_EXTRA_ROTATION_ITEMS else IRON_ROTATIONS for i in range(len(items))]
    vertex_count=sum(len(x) for x in items)
    print(f'IRON_START job={job_id} items={len(items)} vertices={vertex_count} strategy={IRON_STRATEGY} rotations={len(IRON_ROTATIONS)} extra_items={IRON_EXTRA_ROTATION_ITEMS} extra_rotations={len(IRON_EXTRA_ROTATIONS)} budget={IRON_BUDGET} restarts={IRON_RESTARTS} effort={IRON_SEPARATION_EFFORT} simplify={IRON_SIMPLIFY_MM} solver_gap={IRON_SOLVER_GAP_MM}',flush=True)
    started=time.time()
    ctx=multiprocessing.get_context('spawn')
    result_queue=ctx.Queue(maxsize=1)
    process=ctx.Process(target=_solve_process,args=(items,container,rotation_sets,result_queue))
    try:
        process.start()
        process.join(IRON_SOLVE_TIMEOUT_SECONDS)
        if process.is_alive():
            process.terminate(); process.join(5)
            raise TimeoutError(f'IronNest supero {IRON_SOLVE_TIMEOUT_SECONDS} segundos')
        try: state,payload=result_queue.get(timeout=2)
        except queue.Empty: raise RuntimeError(f'IronNest termino sin resultado (exit={process.exitcode})')
    finally:
        result_queue.close()
    if state=='error': raise RuntimeError(payload)
    placements,unplaced=payload
    elapsed=round(time.time()-started,2)
    print(f'IRON_END job={job_id} elapsed={elapsed} placements={len(placements)} unplaced={len(unplaced)}',flush=True)
    out=[]
    for item_idx,x,y,angle in placements:
        idx=int(item_idx)
        out.append({'instanceId':ids[idx],'name':ids[idx],'xCm':float(x)/10.,'yCm':float(y)/10.,'angle':float(angle)})
    return out,[int(x) for x in unplaced],elapsed,len(items),vertex_count

def _execute(svg_text,job_id=None):
    kits,parser=br._extract_piece_kits(svg_text)
    if not kits:return {'ok':False,'error':'No se detectaron siluetas cerradas utilizables'},422
    trace=uuid.uuid4().hex[:12]
    try:
        placements,unplaced,elapsed,item_count,vertex_count=_run_ironnest(kits,job_id)
    except Exception as exc:
        print(f'IRON_ERROR job={job_id} error={exc!r}',flush=True)
        return {'ok':False,'engine':'IronNest hard-bound','traceId':trace,'pieceCount':len(kits),'parser':parser,'error':str(exc)},422
    validation_kits=kits
    validation_detail='parser'
    if parser=='historical-connected-components':
        expanded=br._expand_uses(svg_text) if '<use' in svg_text else svg_text
        validation_kits=br._extract_legacy_kits(expanded,br.ET.fromstring(expanded),solver_tolerance_mm=.02,max_vertices=5000,curve_step_mm=1.0)
        validation_detail='historical-connected-components-dense-curves-1mm'
        if len(validation_kits)!=len(kits):
            return {'ok':False,'parser':parser,'pieceCount':len(kits),'validationPieceCount':len(validation_kits),'error':'El parser de alta precision detecto otra cantidad de piezas'},422
        for original,detailed in zip(kits,validation_kits):
            a=original['parts'][0]; b=detailed['parts'][0]
            if abs(a['trimXmm']-b['trimXmm'])>1 or abs(a['trimYmm']-b['trimYmm'])>1:
                return {'ok':False,'parser':parser,'error':'No se pudo emparejar una pieza con su contorno de alta precision'},422
    validation,rows=br._validate_layout(validation_kits,placements)
    strict_outside=[]
    for placement,geom in rows:
        x0,y0,x1,y1=geom.bounds
        if x0 < -0.001 or y0 < -0.001 or x1 > br.PLATE_WIDTH_MM+0.001 or y1 > br.PLATE_HEIGHT_MM+0.001:
            strict_outside.append(str(placement.get('instanceId')))
    if strict_outside:
        validation['ok']=False
        validation['strictOutsidePlate']=strict_outside
    validation['geometryDetail']=validation_detail
    # Parser kits are the business pieces used by the validator.  itemCount is
    # also returned explicitly so a kit/part cardinality mismatch cannot hide.
    all_placed=(len(placements)==item_count and not unplaced)
    valid=bool(all_placed and validation.get('ok'))
    preview=None
    if rows:
        br._BENCH_RESULTS[trace]=br._svg_preview(rows)
        preview=f'/benchmark-result/{trace}.svg'
    return {
      'ok':valid,'engine':'IronNest hard-bound sampling','traceId':trace,'parser':parser,
      'pieceCount':len(kits),'itemCount':item_count,'vertexCount':vertex_count,
      'validationVertexCount':sum(len(p['geom'].exterior.coords)-1 for k in validation_kits for p in k['parts']),
      'placedCount':len(placements),'unplacedCount':len(unplaced),'unplacedItemIndexes':unplaced,
      'workspaceMm':[br.PLATE_WIDTH_MM,br.PLATE_HEIGHT_MM],'gapMm':br.GAP_MM,
      'elapsedSeconds':elapsed,'layoutValidation':validation,
      'placements':placements if valid else [],'previewSvgUrl':preview,
      'settings':{'strategy':IRON_STRATEGY,'budget':IRON_BUDGET,'rotations':IRON_ROTATIONS,'extraRotationItems':IRON_EXTRA_ROTATION_ITEMS,'extraRotations':IRON_EXTRA_ROTATIONS,'restarts':IRON_RESTARTS,'separationEffort':IRON_SEPARATION_EFFORT,'simplifyMm':IRON_SIMPLIFY_MM,'solverGapMm':IRON_SOLVER_GAP_MM,'timeoutSeconds':IRON_SOLVE_TIMEOUT_SECONDS},
      'error':None if valid else 'IronNest no logro colocar y validar todas las piezas dentro del limite duro'
    },200 if valid else 422

def _worker(job_id,svg_text):
    with _SOLVE_SEMAPHORE:
        with _JOB_LOCK:_JOBS[job_id]={'state':'running','startedAt':time.time()}
        print(f'IRON_UPLOAD_RECEIVED job={job_id} bytes={len(svg_text.encode("utf-8"))}',flush=True)
        try:
            result,status=_execute(svg_text,job_id)
            with _JOB_LOCK:_JOBS[job_id]={'state':'done','httpStatus':status,'result':result,'finishedAt':time.time()}
        except Exception as exc:
            print(f'IRON_WORKER_ERROR job={job_id} error={exc!r}',flush=True)
            with _JOB_LOCK:_JOBS[job_id]={'state':'failed','httpStatus':500,'result':{'ok':False,'error':str(exc)},'finishedAt':time.time()}

@app.get('/ironnest-health',endpoint='ironnest_health')
def ironnest_health():
    return jsonify(ok=True,engine='IronNest hard-bound',strategy=IRON_STRATEGY,workspaceMm=[1230,580],gapMm=2.5,budget=IRON_BUDGET,rotations=IRON_ROTATIONS,restarts=IRON_RESTARTS,separationEffort=IRON_SEPARATION_EFFORT,solverGapMm=IRON_SOLVER_GAP_MM,timeoutSeconds=IRON_SOLVE_TIMEOUT_SECONDS)

@app.route('/upload-ironnest',methods=['GET','POST'],endpoint='ironnest_upload')
def ironnest_upload():
    if request.method=='GET':
        html='''<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>IronNest bounded</title></head><body style="margin:0;background:#fff;color:#111;font-family:Arial,sans-serif"><main style="max-width:650px;margin:auto;padding:24px 18px"><h1>Prueba IronNest</h1><p>Placa 1230 × 580 mm · separación 2,5 mm.</p><form method="POST" action="/upload-ironnest" enctype="multipart/form-data"><div style="border:2px solid #222;border-radius:12px;padding:16px;background:#f3f3f3"><label for="svgfile" style="display:block;font-weight:bold;font-size:17px;margin-bottom:10px">1. Seleccioná pedido 08-08-2.svg</label><input id="svgfile" name="file" type="file" required style="display:block;width:100%;font-size:16px;background:#fff;border:1px solid #777;padding:12px;box-sizing:border-box"></div><button type="submit" style="margin-top:16px;width:100%;padding:18px;background:#111;color:#fff;border:0;border-radius:10px;font-size:18px;font-weight:bold">2. SUBIR Y PROBAR MOTOR</button></form><p style="margin-top:18px;font-size:13px;color:#666">Versión BOUNDED v8 · búsqueda medida. La subida termina inmediatamente y el cálculo continúa separado.</p></main></body></html>'''
        return Response(html,200,content_type='text/html; charset=utf-8',headers={'Cache-Control':'no-store, no-cache, must-revalidate, max-age=0','Pragma':'no-cache'})
    up=request.files.get('file')
    if not up:return jsonify(ok=False,error='Falta archivo SVG'),400
    try:
        data=up.read()
        if not data:return jsonify(ok=False,error='El archivo esta vacio'),422
        text=data.decode('utf-8-sig')
        if '<svg' not in text.lower():return jsonify(ok=False,error='El archivo seleccionado no contiene un SVG valido'),422
    except Exception as exc:return jsonify(ok=False,error=f'No se pudo leer el SVG: {exc}'),422
    job_id=uuid.uuid4().hex[:12]
    with _JOB_LOCK:_JOBS[job_id]={'state':'queued','createdAt':time.time()}
    threading.Thread(target=_worker,args=(job_id,text),daemon=True).start()
    return redirect(url_for('ironnest_job_page',job_id=job_id),code=303)

@app.get('/ironnest-job/<job_id>',endpoint='ironnest_job_page')
def ironnest_job_page(job_id):
    with _JOB_LOCK:job=_JOBS.get(job_id)
    if not job:return Response('<h2>Trabajo no encontrado.</h2>',404,content_type='text/html; charset=utf-8')
    html=f'''<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="5"><title>IronNest {job_id}</title></head><body style="font-family:Arial,sans-serif;padding:24px;max-width:700px;margin:auto"><h1>Archivo recibido ✓</h1><p>Trabajo: <b>{job_id}</b></p><p>Estado actual: <b>{job.get('state')}</b></p><p>Esta página se actualiza sola cada 5 segundos.</p><p><a href="/ironnest-result/{job_id}">Ver estado/resultados</a></p></body></html>'''
    return Response(html,200,content_type='text/html; charset=utf-8',headers={'Cache-Control':'no-store'})

@app.get('/ironnest-result/<job_id>',endpoint='ironnest_job_result')
def ironnest_job_result(job_id):
    with _JOB_LOCK:job=_JOBS.get(job_id)
    if not job:return jsonify(ok=False,error='Trabajo no encontrado'),404
    if job.get('state') not in ('done','failed'):return jsonify(ok=True,jobId=job_id,state=job.get('state')),202
    return jsonify(job),200

