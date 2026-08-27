from copy import deepcopy
from xml.etree import ElementTree as ET
import time, uuid

from flask import jsonify, request, Response
from shapely.affinity import rotate as shp_rotate, translate as shp_translate
from clean_lab_app import app, core, GAP_MM, PLATE_WIDTH_MM, PLATE_HEIGHT_MM, _metrics

SVG_NS='http://www.w3.org/2000/svg'
ET.register_namespace('',SVG_NS)
_BENCH_RESULTS={}

def _extract_piece_kits(svg_text):
    root=ET.fromstring(svg_text);kits=[]
    for g in root.iter():
        gid=str(g.attrib.get('id') or '')
        if not gid.startswith('pieza_') or g.attrib.get('data-polifan-piece')!='1':continue
        piece=deepcopy(g);piece.attrib.pop('transform',None)
        wrapper=ET.Element(f'{{{SVG_NS}}}svg',{'width':f'{PLATE_WIDTH_MM:.0f}mm','height':f'{PLATE_HEIGHT_MM:.0f}mm','viewBox':f'0 0 {PLATE_WIDTH_MM:.0f} {PLATE_HEIGHT_MM:.0f}'})
        wrapper.append(piece);piece_svg=ET.tostring(wrapper,encoding='unicode');ET.fromstring(piece_svg)
        geom,trimx,trimy=core.svg_to_geometry(piece_svg,PLATE_WIDTH_MM/10.0,PLATE_HEIGHT_MM/10.0,solver_tolerance_mm=.18,max_vertices=360)
        if geom.is_empty or geom.area<=0:continue
        industrial=None
        for child in piece.iter():
            if child.attrib.get('data-industrial-piece') is not None:industrial=child;break
        figure=str((industrial.attrib.get('data-kit') if industrial is not None else '') or gid);instance=str((industrial.attrib.get('data-instance') if industrial is not None else '') or gid)
        part={'instanceId':instance,'kitId':gid,'figure':figure,'name':gid,'role':'simple','geom':geom,'shape':core._shape(geom),'trimXmm':float(trimx),'trimYmm':float(trimy),'area':float(geom.area or 0),'envelope':max(1.0,(geom.bounds[2]-geom.bounds[0])*(geom.bounds[3]-geom.bounds[1]))}
        kits.append({'kitId':gid,'figure':figure,'priority':len(kits)+1,'parts':[part],'area':part['area'],'envelope':part['envelope'],'solidity':part['area']/max(1.0,part['envelope'])})
    return kits

def _run_exact(kits,budget=185):
    started=time.time();attempts=[];best=None
    runs=[(1777,True,42),(3911,True,36),(907,True,34),(5119,True,34),(10429,True,28),(907,False,18)]
    for seed,continuous,seconds in runs:
        remaining=budget-(time.time()-started)
        if remaining<12:break
        seconds=min(seconds,max(8,int(remaining-6)));result=core._run_sparrow(kits,GAP_MM,seconds,seed,continuous=continuous);m=_metrics(kits,result) if result.get('ok') else {}
        attempts.append({'seed':seed,'rotation':'continua' if continuous else '15deg','seconds':seconds,'fits':bool(result.get('fits')),'stripWidthMm':m.get('stripWidthMm'),'stripWidthUsagePct':m.get('stripWidthUsagePct'),'geometricOccupancyPct':m.get('geometricOccupancyPct'),'materialInsideUsedStripPct':m.get('materialInsideUsedStripPct'),'error':result.get('error')})
        if result.get('ok') and result.get('fits'):
            score=(-float(result.get('stripWidthMm') or 1e18),float(result.get('solverDensity') or 0))
            if best is None or score>best[0]:best=(score,result)
    return (None,attempts,round(time.time()-started,2)) if best is None else (best[1],attempts,round(time.time()-started,2))

def _part_map(kits):
    out={}
    for kit in kits:
        for part in kit.get('parts') or []:out[str(part.get('instanceId'))]=part
    return out

def _placed_geometries(kits,placements):
    pm=_part_map(kits);rows=[]
    for p in placements:
        part=pm.get(str(p.get('instanceId')))
        if not part:continue
        g=shp_rotate(part['geom'],float(p.get('angle') or 0),origin=(0,0),use_radians=False);g=shp_translate(g,xoff=float(p.get('xCm') or 0)*10.0,yoff=float(p.get('yCm') or 0)*10.0);rows.append((p,g))
    return rows

def _validate_layout(kits,placements):
    rows=_placed_geometries(kits,placements);tol=.35;outside=[];min_gap=None;gap_violations=[]
    for p,g in rows:
        minx,miny,maxx,maxy=g.bounds
        if minx < -tol or miny < -tol or maxx > PLATE_WIDTH_MM+tol or maxy > PLATE_HEIGHT_MM+tol:outside.append({'piece':p.get('name'),'boundsMm':[round(minx,2),round(miny,2),round(maxx,2),round(maxy,2)]})
    for i in range(len(rows)):
        for j in range(i+1,len(rows)):
            d=float(rows[i][1].distance(rows[j][1]));min_gap=d if min_gap is None else min(min_gap,d)
            if d<GAP_MM-.35:gap_violations.append({'a':rows[i][0].get('name'),'b':rows[j][0].get('name'),'gapMm':round(d,3)})
    return {'ok':not outside and not gap_violations and len(rows)==len(placements),'checkedPieces':len(rows),'outsidePlate':outside[:12],'gapViolations':gap_violations[:12],'minimumMeasuredGapMm':round(min_gap,3) if min_gap is not None else None,'requiredGapMm':GAP_MM,'workspaceMm':[PLATE_WIDTH_MM,PLATE_HEIGHT_MM]},rows

def _rings(geom):
    if geom.geom_type=='Polygon':return [geom]
    if geom.geom_type=='MultiPolygon':return list(geom.geoms)
    return [g for g in getattr(geom,'geoms',[]) if g.geom_type=='Polygon']

def _svg_preview(rows):
    chunks=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{PLATE_WIDTH_MM:.0f}mm" height="{PLATE_HEIGHT_MM:.0f}mm" viewBox="0 0 {PLATE_WIDTH_MM:.0f} {PLATE_HEIGHT_MM:.0f}">',f'<rect x="0" y="0" width="{PLATE_WIDTH_MM:.0f}" height="{PLATE_HEIGHT_MM:.0f}" fill="white" stroke="black" stroke-width="1"/>']
    for p,g in rows:
        for poly in _rings(g):
            pts=list(poly.exterior.coords)
            if not pts:continue
            d='M '+' L '.join(f'{x:.3f},{y:.3f}' for x,y in pts)+' Z';chunks.append(f'<path d="{d}" fill="none" stroke="black" stroke-width="0.7" data-piece="{p.get("name","")}"/>')
    chunks.append('</svg>');return ''.join(chunks)

@app.get('/benchmark-result/<trace_id>.svg')
def benchmark_result_svg(trace_id):
    svg=_BENCH_RESULTS.get(trace_id)
    if not svg:return Response('resultado no encontrado',status=404,mimetype='text/plain')
    return Response(svg,mimetype='image/svg+xml',headers={'Content-Disposition':f'inline; filename="placa-{trace_id}.svg"'})

@app.route('/upload-benchmark',methods=['GET','POST'])
def upload_benchmark():
    if request.method=='GET':return '''<!doctype html><html><body><h2>Prueba real de placa · 1230×580</h2><form method="post" enctype="multipart/form-data"><input type="file" name="file" accept=".svg,image/svg+xml" required><button type="submit">Buscar y validar placa</button></form></body></html>'''
    uploaded=request.files.get('file')
    if not uploaded:return jsonify(ok=False,error='Falta archivo SVG'),400
    try:svg_text=uploaded.read().decode('utf-8-sig');kits=_extract_piece_kits(svg_text)
    except Exception as exc:return jsonify(ok=False,error=f'No se pudo leer el SVG: {exc}'),422
    if not kits:return jsonify(ok=False,error='No se detectaron piezas data-polifan-piece en el SVG'),422
    result,attempts,elapsed=_run_exact(kits,185);trace_id=uuid.uuid4().hex[:12]
    if result is None:return jsonify(ok=False,error='No se pudo reacomodar el conjunto completo',traceId=trace_id,pieceCount=len(kits),gapMm=GAP_MM,attempts=attempts,elapsedSeconds=elapsed),422
    placements=result.get('placements') or [];validation,rows=_validate_layout(kits,placements);preview_url=None
    if rows:_BENCH_RESULTS[trace_id]=_svg_preview(rows);preview_url=f'/benchmark-result/{trace_id}.svg'
    m=_metrics(kits,result)
    return jsonify(ok=bool(validation.get('ok')),engine='Sparrow deep real-SVG multipass + hard validation',traceId=trace_id,pieceCount=len(kits),placements=placements,gapMm=GAP_MM,widthCm=PLATE_WIDTH_MM/10.0,heightCm=PLATE_HEIGHT_MM/10.0,attempts=attempts,elapsedSeconds=elapsed,layoutValidation=validation,previewSvgUrl=preview_url,**m)
