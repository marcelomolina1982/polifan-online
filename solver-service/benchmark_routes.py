from copy import deepcopy
from xml.etree import ElementTree as ET
import re, time, uuid

from flask import jsonify, request, Response
from shapely.affinity import rotate as shp_rotate, translate as shp_translate
from clean_lab_app import app, core

SVG_NS='http://www.w3.org/2000/svg'
ET.register_namespace('',SVG_NS)
_BENCH_RESULTS={}

# Benchmark historico congelado. No heredar 1230 del runtime de laboratorio.
PLATE_WIDTH_MM=1220.0
PLATE_HEIGHT_MM=580.0
GAP_MM=3.0
ABSOLUTE_MIN_GAP_MM=2.5


def _source_size_mm(root):
    vb=[float(x) for x in re.split(r'[ ,]+',str(root.attrib.get('viewBox') or '').strip()) if x]
    if len(vb)==4 and vb[2]>0 and vb[3]>0:
        # Los SVG historicos usan viewBox en unidades fisicas mm (ej. 0 0 1230 580).
        return float(vb[2]),float(vb[3])
    return PLATE_WIDTH_MM,PLATE_HEIGHT_MM


def _kit_from_geom(geom,idx,prefix='legacy'):
    minx,miny,maxx,maxy=geom.bounds
    geom=shp_translate(geom,xoff=-minx,yoff=-miny)
    kid=f'{prefix}_{idx:03d}'
    area=float(geom.area or 0); envelope=max(1.0,(maxx-minx)*(maxy-miny))
    part={'instanceId':kid,'kitId':kid,'figure':kid,'name':kid,'role':'simple','geom':geom,'shape':core._shape(geom),'trimXmm':float(minx),'trimYmm':float(miny),'area':area,'envelope':envelope}
    return {'kitId':kid,'figure':kid,'priority':idx,'parts':[part],'area':area,'envelope':envelope,'solidity':area/envelope}


def _extract_tagged_kits(svg_text,root):
    kits=[]
    for g in root.iter():
        gid=str(g.attrib.get('id') or '')
        if not gid.startswith('pieza_') or g.attrib.get('data-polifan-piece')!='1':
            continue
        piece=deepcopy(g); piece.attrib.pop('transform',None)
        wrapper=ET.Element(f'{{{SVG_NS}}}svg',{'width':f'{PLATE_WIDTH_MM:.0f}mm','height':f'{PLATE_HEIGHT_MM:.0f}mm','viewBox':f'0 0 {PLATE_WIDTH_MM:.0f} {PLATE_HEIGHT_MM:.0f}'})
        wrapper.append(piece)
        piece_svg=ET.tostring(wrapper,encoding='unicode')
        geom,trimx,trimy=core.svg_to_geometry(piece_svg,PLATE_WIDTH_MM/10.0,PLATE_HEIGHT_MM/10.0,solver_tolerance_mm=.18,max_vertices=360)
        if geom.is_empty or geom.area<=0: continue
        industrial=next((c for c in piece.iter() if c.attrib.get('data-industrial-piece') is not None),None)
        figure=str((industrial.attrib.get('data-kit') if industrial is not None else '') or gid)
        instance=str((industrial.attrib.get('data-instance') if industrial is not None else '') or gid)
        minx,miny,maxx,maxy=geom.bounds; area=float(geom.area or 0); envelope=max(1.0,(maxx-minx)*(maxy-miny))
        part={'instanceId':instance,'kitId':gid,'figure':figure,'name':gid,'role':'simple','geom':geom,'shape':core._shape(geom),'trimXmm':float(trimx),'trimYmm':float(trimy),'area':area,'envelope':envelope}
        kits.append({'kitId':gid,'figure':figure,'priority':len(kits)+1,'parts':[part],'area':area,'envelope':envelope,'solidity':area/envelope})
    return kits


def _extract_legacy_kits(svg_text,root):
    # Compatibilidad para los 197 SVG originales de Inkscape, sin metadata Polifan.
    # svg_to_geometry une contornos internos de una misma silueta y conserva como
    # componentes separados las piezas fisicamente desconectadas. Luego cada
    # componente se normaliza individualmente para Sparrow. No se escala a 1220:
    # primero se respeta 1:1 del viewBox original y 1220 solo actua como limite de placa.
    source_w,source_h=_source_size_mm(root)
    geom,_,_=core.svg_to_geometry(svg_text,source_w/10.0,source_h/10.0,solver_tolerance_mm=.18,max_vertices=360)
    if geom.geom_type=='Polygon': components=[geom]
    elif geom.geom_type=='MultiPolygon': components=list(geom.geoms)
    else: components=[g for g in getattr(geom,'geoms',[]) if g.geom_type=='Polygon']
    components=[g for g in components if not g.is_empty and g.area>0.2]
    components.sort(key=lambda g:(round(g.bounds[1],3),round(g.bounds[0],3)))
    return [_kit_from_geom(g,i+1) for i,g in enumerate(components)]


def _extract_piece_kits(svg_text):
    root=ET.fromstring(svg_text)
    tagged=_extract_tagged_kits(svg_text,root)
    if tagged: return tagged,'polifan-tagged'
    legacy=_extract_legacy_kits(svg_text,root)
    return legacy,'historical-connected-components'


def _metrics(kits,result):
    area=sum(float(k.get('area') or 0) for k in kits); strip=float(result.get('stripWidthMm') or 0); strip_area=strip*PLATE_HEIGHT_MM if strip>0 else 0
    return {'materialAreaMm2':round(area,2),'plateAreaMm2':round(PLATE_WIDTH_MM*PLATE_HEIGHT_MM,2),'geometricOccupancyPct':round(100.0*area/(PLATE_WIDTH_MM*PLATE_HEIGHT_MM),3),'stripWidthMm':round(strip,3),'stripWidthUsagePct':round(100.0*strip/PLATE_WIDTH_MM,3) if strip else 0.0,'materialInsideUsedStripPct':round(100.0*area/strip_area,3) if strip_area else 0.0,'sparrowReportedDensityPct':round(float(result.get('solverDensity') or 0),3)}


def _run_exact(kits,budget=185):
    started=time.time(); attempts=[]; best=None
    for seed,continuous,seconds in [(1777,True,42),(3911,True,36),(907,True,34),(5119,True,34),(10429,True,28),(907,False,18)]:
        remaining=budget-(time.time()-started)
        if remaining<12: break
        seconds=min(seconds,max(8,int(remaining-6)))
        result=core._run_sparrow(kits,GAP_MM,seconds,seed,continuous=continuous); m=_metrics(kits,result) if result.get('ok') else {}
        attempts.append({'seed':seed,'rotation':'continua' if continuous else '15deg','seconds':seconds,'fits':bool(result.get('fits')),'stripWidthMm':m.get('stripWidthMm'),'stripWidthUsagePct':m.get('stripWidthUsagePct'),'geometricOccupancyPct':m.get('geometricOccupancyPct'),'materialInsideUsedStripPct':m.get('materialInsideUsedStripPct'),'error':result.get('error')})
        if result.get('ok') and result.get('fits'):
            score=(-float(result.get('stripWidthMm') or 1e18),float(result.get('solverDensity') or 0))
            if best is None or score>best[0]: best=(score,result)
    return (None,attempts,round(time.time()-started,2)) if best is None else (best[1],attempts,round(time.time()-started,2))


def _part_map(kits): return {str(p.get('instanceId')):p for k in kits for p in (k.get('parts') or [])}


def _placed_geometries(kits,placements):
    pm=_part_map(kits); rows=[]
    for p in placements:
        part=pm.get(str(p.get('instanceId')))
        if not part: continue
        g=shp_rotate(part['geom'],float(p.get('angle') or 0),origin=(0,0),use_radians=False)
        g=shp_translate(g,xoff=float(p.get('xCm') or 0)*10.0,yoff=float(p.get('yCm') or 0)*10.0); rows.append((p,g))
    return rows


def _validate_layout(kits,placements):
    rows=_placed_geometries(kits,placements); tol=.35; outside=[]; min_gap=None; gap_violations=[]
    for p,g in rows:
        minx,miny,maxx,maxy=g.bounds
        if minx < -tol or miny < -tol or maxx > PLATE_WIDTH_MM+tol or maxy > PLATE_HEIGHT_MM+tol: outside.append({'piece':p.get('name'),'boundsMm':[round(minx,2),round(miny,2),round(maxx,2),round(maxy,2)]})
    for i in range(len(rows)):
        for j in range(i+1,len(rows)):
            d=float(rows[i][1].distance(rows[j][1])); min_gap=d if min_gap is None else min(min_gap,d)
            if d<ABSOLUTE_MIN_GAP_MM-0.001: gap_violations.append({'a':rows[i][0].get('name'),'b':rows[j][0].get('name'),'gapMm':round(d,3)})
    return {'ok':not outside and not gap_violations and len(rows)==len(placements),'checkedPieces':len(rows),'outsidePlate':outside[:12],'gapViolations':gap_violations[:12],'minimumMeasuredGapMm':round(min_gap,3) if min_gap is not None else None,'preferredGapMm':GAP_MM,'absoluteMinimumGapMm':ABSOLUTE_MIN_GAP_MM,'workspaceMm':[PLATE_WIDTH_MM,PLATE_HEIGHT_MM]},rows


def _rings(geom):
    if geom.geom_type=='Polygon': return [geom]
    if geom.geom_type=='MultiPolygon': return list(geom.geoms)
    return [g for g in getattr(geom,'geoms',[]) if g.geom_type=='Polygon']


def _svg_preview(rows):
    chunks=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{PLATE_WIDTH_MM:.0f}mm" height="{PLATE_HEIGHT_MM:.0f}mm" viewBox="0 0 {PLATE_WIDTH_MM:.0f} {PLATE_HEIGHT_MM:.0f}">',f'<rect x="0" y="0" width="{PLATE_WIDTH_MM:.0f}" height="{PLATE_HEIGHT_MM:.0f}" fill="white" stroke="black" stroke-width="1"/>']
    for p,g in rows:
        for poly in _rings(g):
            pts=list(poly.exterior.coords)
            if pts:
                d='M '+' L '.join(f'{x:.3f},{y:.3f}' for x,y in pts)+' Z'; chunks.append(f'<path d="{d}" fill="none" stroke="black" stroke-width="0.7" data-piece="{p.get("name","")}"/>')
    chunks.append('</svg>'); return ''.join(chunks)


@app.get('/benchmark-result/<trace_id>.svg')
def benchmark_result_svg(trace_id):
    svg=_BENCH_RESULTS.get(trace_id)
    if not svg: return Response('resultado no encontrado',status=404,mimetype='text/plain')
    return Response(svg,mimetype='image/svg+xml',headers={'Content-Disposition':f'inline; filename="placa-{trace_id}.svg"'})


@app.route('/upload-benchmark',methods=['GET','POST'])
def upload_benchmark():
    if request.method=='GET': return '''<!doctype html><html><body><h2>Prueba historica real · 1220×580 · 1:1</h2><form method="post" enctype="multipart/form-data"><input type="file" name="file" accept=".svg,image/svg+xml" required><button type="submit">Buscar y validar placa</button></form></body></html>'''
    uploaded=request.files.get('file')
    if not uploaded: return jsonify(ok=False,error='Falta archivo SVG'),400
    try: svg_text=uploaded.read().decode('utf-8-sig'); kits,parser=_extract_piece_kits(svg_text)
    except Exception as exc: return jsonify(ok=False,error=f'No se pudo leer el SVG: {exc}'),422
    if not kits: return jsonify(ok=False,error='No se detectaron siluetas cerradas utilizables'),422
    result,attempts,elapsed=_run_exact(kits,185); trace_id=uuid.uuid4().hex[:12]
    if result is None: return jsonify(ok=False,error='No se pudo reacomodar el conjunto completo',traceId=trace_id,pieceCount=len(kits),parser=parser,gapMm=GAP_MM,workspaceMm=[PLATE_WIDTH_MM,PLATE_HEIGHT_MM],attempts=attempts,elapsedSeconds=elapsed),422
    placements=result.get('placements') or []; validation,rows=_validate_layout(kits,placements); preview_url=None
    if rows: _BENCH_RESULTS[trace_id]=_svg_preview(rows); preview_url=f'/benchmark-result/{trace_id}.svg'
    return jsonify(ok=bool(validation.get('ok')),engine='Sparrow historical-SVG compatibility + hard validation',traceId=trace_id,pieceCount=len(kits),parser=parser,placements=placements,gapMm=GAP_MM,widthCm=PLATE_WIDTH_MM/10.0,heightCm=PLATE_HEIGHT_MM/10.0,attempts=attempts,elapsedSeconds=elapsed,layoutValidation=validation,previewSvgUrl=preview_url,**_metrics(kits,result))
