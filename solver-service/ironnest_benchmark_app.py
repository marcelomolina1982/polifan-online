import time, uuid
from flask import jsonify, request
import ironnest
import benchmark_routes as br

app = br.app


def _outline(geom):
    # IronNest consumes one simple exterior outline per item. The historical
    # benchmark parser already yields the 26 connected exterior silhouettes.
    if geom.geom_type == 'MultiPolygon':
        geom = max(geom.geoms, key=lambda g: g.area)
    pts = [(float(x), float(y)) for x, y in list(geom.exterior.coords)[:-1]]
    if len(pts) < 3:
        raise ValueError('Silueta con menos de 3 vertices')
    return pts


def _run_ironnest(kits):
    items=[]; ids=[]
    for k in kits:
        for p in (k.get('parts') or []):
            items.append(_outline(p['geom']))
            ids.append(str(p.get('instanceId')))
    container=[(0.0,0.0),(br.PLATE_WIDTH_MM,0.0),(br.PLATE_WIDTH_MM,br.PLATE_HEIGHT_MM),(0.0,br.PLATE_HEIGHT_MM)]
    started=time.time()
    placements,unplaced=ironnest.nest(
        items,
        qty=[1]*len(items),
        container=container,
        holes=[],
        min_sep=br.GAP_MM,
        rotations=[0.0,15.0,30.0,45.0,60.0,75.0,90.0,105.0,120.0,135.0,150.0,165.0,180.0,195.0,210.0,225.0,240.0,255.0,270.0,285.0,300.0,315.0,330.0,345.0],
        seed=1777,
        budget=900,
        strategy='nfp',
        column_weight=3,
        restarts=8,
        separation_effort='max',
    )
    out=[]
    for item_idx,x,y,angle in placements:
        idx=int(item_idx)
        out.append({'instanceId':ids[idx],'name':ids[idx],'xCm':float(x)/10.0,'yCm':float(y)/10.0,'angle':float(angle)})
    return out,[int(x) for x in unplaced],round(time.time()-started,2)


def _execute(svg_text):
    kits,parser=br._extract_piece_kits(svg_text)
    if not kits:
        return {'ok':False,'error':'No se detectaron siluetas cerradas utilizables'},422
    trace=uuid.uuid4().hex[:12]
    try:
        placements,unplaced,elapsed=_run_ironnest(kits)
    except Exception as exc:
        return {'ok':False,'engine':'IronNest hard-bound','traceId':trace,'pieceCount':len(kits),'parser':parser,'error':str(exc)},422
    validation,rows=br._validate_layout(kits,placements)
    all_placed=(len(placements)==len(kits) and not unplaced)
    valid=bool(all_placed and validation.get('ok'))
    preview=None
    if rows:
        br._BENCH_RESULTS[trace]=br._svg_preview(rows)
        preview=f'/benchmark-result/{trace}.svg'
    return {
        'ok':valid,
        'engine':'IronNest hard-bound NFP',
        'traceId':trace,
        'parser':parser,
        'pieceCount':len(kits),
        'placedCount':len(placements),
        'unplacedCount':len(unplaced),
        'unplacedItemIndexes':unplaced,
        'workspaceMm':[br.PLATE_WIDTH_MM,br.PLATE_HEIGHT_MM],
        'gapMm':br.GAP_MM,
        'rotationsStepDeg':15,
        'strategy':'nfp',
        'restarts':8,
        'budget':900,
        'separationEffort':'max',
        'elapsedSeconds':elapsed,
        'layoutValidation':validation,
        'placements':placements if valid else [],
        'previewSvgUrl':preview,
        'error':None if valid else 'IronNest no logro colocar y validar las 26 piezas dentro del limite duro'
    },200 if valid else 422


@app.get('/ironnest-health')
def health():
    return jsonify(ok=True,engine='IronNest hard-bound NFP',workspaceMm=[1230,580],gapMm=2.5,supabase=False,vercel=False)


@app.route('/upload-ironnest',methods=['GET','POST'])
def upload():
    if request.method=='GET':
        return '''<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>IronNest Lab</title><body style="font-family:Arial;max-width:720px;margin:24px auto;padding:18px"><h2>IronNest · límite duro 1230×580</h2><p>26/26 piezas · separación 2,5 mm · NFP · rotaciones cada 15°.</p><form method="post" enctype="multipart/form-data"><input type="file" name="file" required style="display:block;margin:18px 0"><button style="padding:12px 18px;font-size:16px">Probar motor nuevo</button></form></body>'''
    up=request.files.get('file')
    if not up:return jsonify(ok=False,error='Falta archivo SVG'),400
    try:
        if up.filename and not str(up.filename).lower().endswith('.svg'):return jsonify(ok=False,error='El archivo no es SVG'),422
        return jsonify(*_execute(up.read().decode('utf-8-sig')))
    except Exception as exc:return jsonify(ok=False,error=f'No se pudo procesar el SVG: {exc}'),422
