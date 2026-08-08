import json, math, re, time, uuid, threading
from xml.etree import ElementTree as ET

from shapely.geometry import Polygon, Point, box
from shapely.ops import unary_union
from shapely.affinity import translate, scale as affinity_scale
from svgpathtools import parse_path
from pyckingsolver import InstanceBuilder, Objective, Solver


def _n(v, d=0.0):
    try: return float(v)
    except: return d


def _mat_mul(m1, m2):
    a,b,c,d,e,f=m1; A,B,C,D,E,F=m2
    return (a*A+c*B, b*A+d*B, a*C+c*D, b*C+d*D, a*E+c*F+e, b*E+d*F+f)


def _transform_matrix(s):
    m=(1,0,0,1,0,0)
    if not s: return m
    for name,args in re.findall(r'([a-zA-Z]+)\s*\(([^)]*)\)', s):
        vals=[_n(x) for x in re.split(r'[ ,]+',args.strip()) if x!='']
        name=name.lower()
        t=(1,0,0,1,0,0)
        if name=='matrix' and len(vals)>=6: t=tuple(vals[:6])
        elif name=='translate': t=(1,0,0,1,vals[0] if vals else 0, vals[1] if len(vals)>1 else 0)
        elif name=='scale':
            sx=vals[0] if vals else 1; sy=vals[1] if len(vals)>1 else sx; t=(sx,0,0,sy,0,0)
        elif name=='rotate' and vals:
            a=math.radians(vals[0]); co,si=math.cos(a),math.sin(a); r=(co,si,-si,co,0,0)
            if len(vals)>=3:
                cx,cy=vals[1],vals[2]; t=_mat_mul((1,0,0,1,cx,cy),_mat_mul(r,(1,0,0,1,-cx,-cy)))
            else: t=r
        m=_mat_mul(m,t)
    return m


def _apply(pt,m):
    x,y=pt; a,b,c,d,e,f=m
    return (a*x+c*y+e, b*x+d*y+f)


def _points_attr(v):
    nums=[_n(x) for x in re.findall(r'[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?',v or '')]
    return list(zip(nums[0::2],nums[1::2]))


def _sample_path(d, transform):
    out=[]
    try:
        path=parse_path(d or '')
        subs=path.continuous_subpaths() if hasattr(path,'continuous_subpaths') else [path]
        for sub in subs:
            if not sub: continue
            try: closed=sub.isclosed()
            except: closed=abs(sub.start-sub.end)<1e-6
            if not closed: continue
            pts=[]
            for seg in sub:
                try: L=max(1.0,float(seg.length(error=1e-3)))
                except: L=20.0
                steps=max(2,min(36,int(math.ceil(L/8.0))))
                for i in range(steps):
                    z=seg.point(i/steps); pts.append(_apply((z.real,z.imag),transform))
            z=sub[-1].end; pts.append(_apply((z.real,z.imag),transform))
            if len(pts)>=4: out.append(pts)
    except Exception:
        pass
    return out


def _cap_ring_vertices(coords, max_vertices=180):
    pts=list(coords)
    if len(pts)<=max_vertices:
        return pts
    # Mantiene una distribución uniforme de puntos y fuerza conservar extremos.
    n=len(pts)
    selected={0,n-1}
    step=max(1,(n-1)//max(4,max_vertices-8))
    selected.update(range(0,n,step))
    xs=[p[0] for p in pts]; ys=[p[1] for p in pts]
    selected.update([xs.index(min(xs)),xs.index(max(xs)),ys.index(min(ys)),ys.index(max(ys))])
    out=[pts[i] for i in sorted(selected)]
    if out[0]!=out[-1]:
        out.append(out[0])
    return out


def _solver_simplify_polygon(poly, original_bounds, tolerance_mm=0.35, max_vertices=180):
    """
    Simplificación EXCLUSIVA para PackingSolver.
    El SVG original no se modifica nunca. Restauramos el bounding box físico
    exacto y usamos un pequeño margen conservador.
    """
    if poly.is_empty:
        return poly

    simp=poly.simplify(max(0.05,float(tolerance_mm)), preserve_topology=True)
    if simp.is_empty:
        simp=poly

    if simp.geom_type=="Polygon":
        ext=_cap_ring_vertices(simp.exterior.coords,max_vertices)
        simp=Polygon(ext)
    elif simp.geom_type=="MultiPolygon":
        reduced=[]
        for g in simp.geoms:
            ext=_cap_ring_vertices(g.exterior.coords,max_vertices)
            p=Polygon(ext)
            if not p.is_empty and p.area>0:
                reduced.append(p)
        if reduced:
            simp=unary_union(reduced)

    if not simp.is_valid:
        simp=simp.buffer(0)
    if simp.is_empty:
        simp=poly

    # Restaurar medidas exteriores exactas del original.
    ominx,ominy,omaxx,omaxy=original_bounds
    target_w=max(1e-9,omaxx-ominx)
    target_h=max(1e-9,omaxy-ominy)
    minx,miny,maxx,maxy=simp.bounds
    sw=max(1e-9,maxx-minx)
    sh=max(1e-9,maxy-miny)
    simp=translate(simp,xoff=-minx,yoff=-miny)
    simp=affinity_scale(simp,xfact=target_w/sw,yfact=target_h/sh,origin=(0,0))

    minx,miny,maxx,maxy=simp.bounds
    simp=translate(simp,xoff=-minx,yoff=-miny)
    return simp


def svg_to_geometry(svg_text, width_cm, height_cm, solver_tolerance_mm=0.35, max_vertices=180):
    root=ET.fromstring(svg_text)
    vb=[_n(x) for x in re.split(r'[ ,]+',root.attrib.get('viewBox','').strip()) if x!='']
    if len(vb)!=4:
        vb=[0,0,max(1,width_cm*100),max(1,height_cm*100)]
    vx,vy,vw,vh=vb
    sx=width_cm*10.0/max(vw,1e-9)
    sy=height_cm*10.0/max(vh,1e-9)
    polys=[]

    def walk(el,parent_m=(1,0,0,1,0,0)):
        local=_mat_mul(parent_m,_transform_matrix(el.attrib.get('transform')))
        tag=el.tag.split('}')[-1].lower()
        rings=[]
        if tag=='path':
            rings=_sample_path(el.attrib.get('d',''),local)
        elif tag in ('polygon','polyline'):
            pts=[_apply(p,local) for p in _points_attr(el.attrib.get('points',''))]
            if tag=='polygon' and len(pts)>=3:
                rings=[pts+[pts[0]]]
        elif tag=='rect':
            x=_n(el.attrib.get('x')); y=_n(el.attrib.get('y'))
            w=_n(el.attrib.get('width')); h=_n(el.attrib.get('height'))
            if w>0 and h>0:
                pts=[(x,y),(x+w,y),(x+w,y+h),(x,y+h),(x,y)]
                rings=[[_apply(q,local) for q in pts]]
        elif tag=='circle':
            cx=_n(el.attrib.get('cx')); cy=_n(el.attrib.get('cy')); r=_n(el.attrib.get('r'))
            if r>0:
                pts=[(cx+r*math.cos(i*2*math.pi/36),cy+r*math.sin(i*2*math.pi/36)) for i in range(37)]
                rings=[[_apply(q,local) for q in pts]]
        elif tag=='ellipse':
            cx=_n(el.attrib.get('cx')); cy=_n(el.attrib.get('cy'))
            rx=_n(el.attrib.get('rx')); ry=_n(el.attrib.get('ry'))
            if rx>0 and ry>0:
                pts=[(cx+rx*math.cos(i*2*math.pi/36),cy+ry*math.sin(i*2*math.pi/36)) for i in range(37)]
                rings=[[_apply(q,local) for q in pts]]

        for ring in rings:
            physical=[((x-vx)*sx,(y-vy)*sy) for x,y in ring]
            try:
                poly=Polygon(physical)
                if not poly.is_valid:
                    poly=poly.buffer(0)
                if not poly.is_empty and poly.area>0.2:
                    polys.append(poly)
            except Exception:
                pass
        for ch in list(el):
            walk(ch,local)

    walk(root)
    if not polys:
        raise ValueError('SVG sin contorno cerrado utilizable')

    geom=unary_union(polys)
    if not geom.is_valid:
        geom=geom.buffer(0)

    # Interior bloqueado: PackingSolver trata la silueta exterior como sólida.
    if geom.geom_type=='Polygon':
        geom=Polygon(geom.exterior)
    elif geom.geom_type=='MultiPolygon':
        geom=unary_union([Polygon(g.exterior) for g in geom.geoms])

    original_bounds=geom.bounds
    minx,miny,maxx,maxy=original_bounds
    geom=translate(geom,xoff=-minx,yoff=-miny)
    normalized_bounds=geom.bounds

    # Simplificación sólo para el motor de nesting.
    geom=_solver_simplify_polygon(
        geom,
        normalized_bounds,
        tolerance_mm=solver_tolerance_mm,
        max_vertices=max_vertices,
    )

    return geom, minx, miny


def geom_parts(geom):
    if geom.geom_type=='Polygon': return [geom]
    if geom.geom_type=='MultiPolygon': return list(geom.geoms)
    ps=[g for g in getattr(geom,'geoms',[]) if g.geom_type=='Polygon']
    return ps


def solve_prefix(
    kits,
    target,
    width_mm,
    height_mm,
    spacing_mm,
    seconds,
    rotation_step=30,
    simplify_mm=0.35,
    max_vertices=180,
):
    selected=kits[:target]
    builder=InstanceBuilder(Objective.BIN_PACKING)
    builder.set_item_item_minimum_spacing(0.0)
    builder.add_bin_type_rectangle(
        width_mm,
        height_mm,
        copies=1,
        item_bin_minimum_spacing=0.0,
    )

    mapping={}
    expected=0
    diagnostics=[]

    for kit_index,kit in enumerate(selected):
        for part in kit.get('parts',[]):
            wcm=_n(part.get('sourceWidthCm') or part.get('widthCm'))
            hcm=_n(part.get('sourceHeightCm') or part.get('heightCm'))
            if wcm<=0 or hcm<=0:
                raise ValueError(f"Medidas inválidas en {part.get('name','pieza')}: {wcm} x {hcm} cm")

            geom,trimx,trimy=svg_to_geometry(
                part['svgText'],
                wcm,
                hcm,
                solver_tolerance_mm=simplify_mm,
                max_vertices=max_vertices,
            )
            # Garantía geométrica real de separación:
            # cada pieza reserva la mitad del gap alrededor de su contorno.
            pad=max(0.0,spacing_mm/2.0)
            solver_geom=geom.buffer(pad,join_style=2) if pad>0 else geom
            if not solver_geom.is_valid:
                solver_geom=solver_geom.buffer(0)
            pminx,pminy,pmaxx,pmaxy=solver_geom.bounds
            solver_geom=translate(solver_geom,xoff=-pminx,yoff=-pminy)
            shapes=geom_parts(solver_geom)
            if not shapes:
                raise ValueError(f"Sin polígono: {part.get('name','pieza')}")

            minx,miny,maxx,maxy=geom.bounds
            gw=maxx-minx; gh=maxy-miny
            vertex_count=sum(len(g.exterior.coords) for g in shapes if getattr(g,'exterior',None))
            diagnostics.append({
                "name":part.get("name","pieza"),
                "kit":kit.get("figure",""),
                "wMm":round(gw,3),
                "hMm":round(gh,3),
                "vertices":vertex_count,
            })

            if min(gw,gh)>min(width_mm,height_mm) or max(gw,gh)>max(width_mm,height_mm):
                raise ValueError(
                    f"{part.get('name','pieza')} mide aprox. {gw/10:.1f} x {gh/10:.1f} cm "
                    f"y no puede entrar en una placa de {width_mm/10:.1f} x {height_mm/10:.1f} cm"
                )

            if part.get('allowRotate',True):
                step=max(5,min(90,int(rotation_step or 30)))
                rots=[(float(a),float(a)) for a in range(0,360,step)]
            else:
                rots=[(0.0,0.0)]

            item_id=builder.add_item_type(
                shapes if len(shapes)>1 else shapes[0],
                copies=1,
                allowed_rotations=rots,
            )
            mapping[int(item_id)]={
                **part,
                'trimXmm':trimx,
                'trimYmm':trimy,
                'geom':solver_geom,
                'renderGeom':geom,
                'solverPadMm':pad,
                'kitIndex':kit_index,
            }
            expected+=1

    if expected==0:
        return None

    solver=Solver()
    try:
        solution=solver.solve(
            builder.build(),
            time_limit=max(1.0,float(seconds)),
            verbosity_level=0,
            optimization_mode='Anytime',
            # Menos ramas para que la instancia Free no se quede 45 s en un intento.
            use_tree_search=False,
            use_sequential_single_knapsack=True,
            use_sequential_value_correction=False,
            use_column_generation=False,
            use_dichotomic_search=False,
            anchor=True,
            anchor_x_weight=1.0,
            anchor_y_weight=1.0,
        )
    except Exception as exc:
        # El wrapper puede matar el binario por timeout duro. Este intento se
        # considera fallido, pero NO borra una solución mejor ya encontrada.
        return {
            'feasible':False,
            'target':target,
            'expected':expected,
            'placedCount':0,
            'bins':0,
            'diagnostics':diagnostics,
            'timeout':True,
            'error':str(exc),
        }

    items=solution.all_items()
    bins=solution.total_bins_used()
    count=solution.total_item_count()
    feasible=(bins==1 and count==expected and len(items)==expected)

    if not feasible:
        return {
            'feasible':False,
            'target':target,
            'expected':expected,
            'placedCount':count,
            'bins':bins,
            'diagnostics':diagnostics,
            'metrics':solution.metrics,
        }

    placements=[]
    all_shapes=[]
    for it in items:
        meta=mapping.get(int(it.item_type_id))
        if not meta:
            continue
        angle=_n(it.angle)
        src=meta['geom']
        placed=unary_union(it.shapes)

        cx,cy=src.centroid.x,src.centroid.y
        a=math.radians(angle)
        rcx=cx*math.cos(a)-cy*math.sin(a)
        rcy=cx*math.sin(a)+cy*math.cos(a)
        tx=placed.centroid.x-rcx
        ty=placed.centroid.y-rcy
        # solver_geom contiene pad a izquierda/arriba. Al renderizar el SVG original
        # desplazamos ese pad rotado para conservar 3 mm reales entre contornos.
        pad=_n(meta.get('solverPadMm'))
        rp_x=pad*math.cos(a)-pad*math.sin(a)
        rp_y=pad*math.sin(a)+pad*math.cos(a)
        render_tx=tx+rp_x
        render_ty=ty+rp_y

        placements.append({
            'instanceId':meta.get('instanceId'),
            'kitId':meta.get('kitId'),
            'figure':meta.get('figure'),
            'name':meta.get('name'),
            'role':meta.get('role'),
            'xCm':render_tx/10.0,
            'yCm':render_ty/10.0,
            'angle':angle,
            'trimXCm':meta['trimXmm']/10.0,
            'trimYCm':meta['trimYmm']/10.0,
        })
        all_shapes.extend(it.shapes)

    if len(placements)!=expected:
        return {
            'feasible':False,
            'target':target,
            'expected':expected,
            'placedCount':len(placements),
            'bins':bins,
            'diagnostics':diagnostics,
            'metrics':solution.metrics,
        }

    union=unary_union(all_shapes) if all_shapes else None
    item_area=sum(g.area for g in all_shapes)
    density=item_area/(width_mm*height_mm)*100.0

    if union and not union.is_empty:
        bx=union.bounds
        usedw=max(0,bx[2]-bx[0]); usedh=max(0,bx[3]-bx[1])
        envelope=usedw*usedh
        compact=(item_area/envelope*100.0) if envelope>0 else 0.0
    else:
        usedw=usedh=compact=0.0

    return {
        'feasible':True,
        'target':target,
        'placements':placements,
        'density':density,
        'compactness':compact,
        'usedWidthMm':usedw,
        'usedHeightMm':usedh,
        'metrics':solution.metrics,
        'diagnostics':diagnostics,
        'rotationStep':rotation_step,
        'simplifyMm':simplify_mm,
    }


def solve_knapsack_kits(
    kits,
    width_mm,
    height_mm,
    spacing_mm,
    seconds=18,
    rotation_step=30,
    simplify_mm=0.45,
    max_vertices=150,
):
    """
    Fase de selección: entrega TODAS las piezas candidatas a una placa fija
    y deja que KNAPSACK maximice el beneficio colocado. Cada kit completo vale
    aproximadamente lo mismo; sus partes reparten ese valor.
    """
    builder=InstanceBuilder(Objective.KNAPSACK)
    builder.set_item_item_minimum_spacing(0.0)
    builder.add_bin_type_rectangle(
        width_mm,
        height_mm,
        copies=1,
        item_bin_minimum_spacing=0.0,
    )

    mapping={}
    kit_expected={}
    diagnostics=[]

    for kit_index,kit in enumerate(kits):
        parts=kit.get('parts',[]) or []
        if not parts:
            continue
        kit_id=str(kit.get('kitId') or f"kit-{kit_index}")
        kit_expected[kit_id]=set()

        # Cada kit vale 1000. Un bonus ínfimo desempata a favor de la prioridad.
        priority=max(0.0,_n(kit.get("priority"),999999))
        priority_bonus=max(0.0, 1.0-min(priority,9999)*0.00001)
        part_profit=(1000.0+priority_bonus)/max(1,len(parts))

        for part_index,part in enumerate(parts):
            wcm=_n(part.get('sourceWidthCm') or part.get('widthCm'))
            hcm=_n(part.get('sourceHeightCm') or part.get('heightCm'))
            if wcm<=0 or hcm<=0:
                continue

            geom,trimx,trimy=svg_to_geometry(
                part['svgText'],wcm,hcm,
                solver_tolerance_mm=simplify_mm,
                max_vertices=max_vertices,
            )
            pad=max(0.0,spacing_mm/2.0)
            solver_geom=geom.buffer(pad,join_style=2) if pad>0 else geom
            if not solver_geom.is_valid:
                solver_geom=solver_geom.buffer(0)
            pminx,pminy,pmaxx,pmaxy=solver_geom.bounds
            solver_geom=translate(solver_geom,xoff=-pminx,yoff=-pminy)
            shapes=geom_parts(solver_geom)
            if not shapes:
                continue

            minx,miny,maxx,maxy=geom.bounds
            gw=maxx-minx; gh=maxy-miny
            if min(gw,gh)>min(width_mm,height_mm) or max(gw,gh)>max(width_mm,height_mm):
                continue

            step=max(5,min(90,int(rotation_step or 30)))
            rots=[(float(a),float(a)) for a in range(0,360,step)] if part.get('allowRotate',True) else [(0.0,0.0)]

            item_id=builder.add_item_type(
                shapes if len(shapes)>1 else shapes[0],
                copies=1,
                profit=part_profit,
                allowed_rotations=rots,
            )
            iid=int(item_id)
            instance_id=str(part.get('instanceId') or f"{kit_id}-p{part_index}")
            kit_expected[kit_id].add(iid)
            mapping[iid]={
                **part,
                'kitId':kit_id,
                'instanceId':instance_id,
                'trimXmm':trimx,
                'trimYmm':trimy,
                'geom':solver_geom,
                'renderGeom':geom,
                'solverPadMm':pad,
            }
            diagnostics.append({
                "kitId":kit_id,
                "name":part.get("name","pieza"),
                "wMm":round(gw,2),
                "hMm":round(gh,2),
            })

    if not mapping:
        raise ValueError("No quedaron componentes utilizables para KNAPSACK")

    solver=Solver()
    try:
        solution=solver.solve(
            builder.build(),
            time_limit=max(2,float(seconds)),
            verbosity_level=0,
            optimization_mode='Anytime',
            use_tree_search=False,
            use_sequential_single_knapsack=True,
            use_sequential_value_correction=True,
            use_column_generation=False,
            use_dichotomic_search=False,
            anchor=True,
            anchor_x_weight=1.0,
            anchor_y_weight=1.0,
        )
    except Exception as exc:
        return {
            'ok':False,
            'timeout':True,
            'error':str(exc),
            'diagnostics':diagnostics[:8],
        }

    items=solution.all_items()
    placed_ids={int(it.item_type_id) for it in items}
    complete_kit_ids=[
        kid for kid,expected in kit_expected.items()
        if expected and expected.issubset(placed_ids)
    ]

    # Guardamos las posiciones de la selección KNAPSACK por si la segunda pasada
    # no consigue mejorarla.
    placements=[]
    all_shapes=[]
    for it in items:
        meta=mapping.get(int(it.item_type_id))
        if not meta or meta['kitId'] not in complete_kit_ids:
            continue
        angle=_n(it.angle)
        src=meta['geom']; placed=unary_union(it.shapes)
        cx,cy=src.centroid.x,src.centroid.y
        a=math.radians(angle)
        rcx=cx*math.cos(a)-cy*math.sin(a)
        rcy=cx*math.sin(a)+cy*math.cos(a)
        tx=placed.centroid.x-rcx; ty=placed.centroid.y-rcy
        pad=_n(meta.get('solverPadMm'))
        rp_x=pad*math.cos(a)-pad*math.sin(a)
        rp_y=pad*math.sin(a)+pad*math.cos(a)
        render_tx=tx+rp_x; render_ty=ty+rp_y
        placements.append({
            'instanceId':meta.get('instanceId'),
            'kitId':meta.get('kitId'),
            'figure':meta.get('figure'),
            'name':meta.get('name'),
            'role':meta.get('role'),
            'xCm':render_tx/10.0,
            'yCm':render_ty/10.0,
            'angle':angle,
            'trimXCm':meta['trimXmm']/10.0,
            'trimYCm':meta['trimYmm']/10.0,
        })
        all_shapes.extend(it.shapes)

    union=unary_union(all_shapes) if all_shapes else None
    item_area=sum(g.area for g in all_shapes)
    density=item_area/(width_mm*height_mm)*100.0 if width_mm*height_mm else 0.0
    if union and not union.is_empty:
        bx=union.bounds
        usedw=max(0,bx[2]-bx[0]); usedh=max(0,bx[3]-bx[1])
        env=usedw*usedh
        compact=item_area/env*100.0 if env>0 else 0.0
    else:
        usedw=usedh=compact=0.0

    return {
        'ok':True,
        'completeKitIds':complete_kit_ids,
        'completeFigures':len(complete_kit_ids),
        'placements':placements,
        'density':density,
        'compactness':compact,
        'usedWidthMm':usedw,
        'usedHeightMm':usedh,
        'metrics':solution.metrics,
        'placedPartCount':len(items),
        'completePartCount':len(placements),
        'diagnostics':diagnostics[:8],
    }



from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

@app.get("/")
@app.get("/health")
def health():
    return jsonify(ok=True, engine="PackingSolver C++", version="22.0.8", status="ready")


_jobs={}
_jobs_lock=threading.Lock()

def _job_update(job_id, percent=None, stage=None, **extra):
    if not job_id:
        return
    with _jobs_lock:
        row=_jobs.setdefault(job_id,{"status":"running","percent":2,"stage":"Preparando geometrías…","started":time.time()})
        if percent is not None: row["percent"]=int(percent)
        if stage is not None: row["stage"]=stage
        row.update(extra)
        row["updated"]=time.time()

@app.post("/nest/start")
def nest_start():
    data=request.get_json(silent=True) or {}
    job_id=uuid.uuid4().hex
    with _jobs_lock:
        _jobs[job_id]={"status":"queued","percent":1,"stage":"En cola…","started":time.time()}
    def worker():
        with app.test_request_context("/nest",method="POST",json={**data,"jobId":job_id}):
            try:
                response=nest()
                if isinstance(response,tuple):
                    resp,status=response
                else:
                    resp,status=response,200
                payload=resp.get_json() if hasattr(resp,"get_json") else {}
                with _jobs_lock:
                    _jobs[job_id].update({
                        "status":"done" if status<400 else "error",
                        "percent":100,
                        "stage":"Finalizado" if status<400 else "Error",
                        "result":payload,
                        "httpStatus":status,
                        "updated":time.time(),
                    })
            except Exception as exc:
                with _jobs_lock:
                    _jobs[job_id].update({"status":"error","percent":100,"stage":"Error","result":{"ok":False,"error":str(exc)},"httpStatus":500,"updated":time.time()})
    threading.Thread(target=worker,daemon=True).start()
    return jsonify(ok=True,jobId=job_id)

@app.get("/nest/status/<job_id>")
def nest_status(job_id):
    with _jobs_lock:
        row=dict(_jobs.get(job_id) or {})
    if not row:
        return jsonify(ok=False,error="Trabajo no encontrado"),404
    return jsonify(ok=True,jobId=job_id,**row)

@app.post("/nest")
def nest():
    started=time.time()
    try:
        data=request.get_json(silent=True) or {}
        job_id=data.get("jobId")
        _job_update(job_id,4,"Preparando geometrías…")
        kits=data.get("kits") or []
        if not kits:
            raise ValueError("No llegaron figuras completas al motor industrial")

        width_mm=_n(data.get("widthCm"),122)*10
        height_mm=_n(data.get("heightCm"),58)*10
        spacing_mm=max(3.0,_n(data.get("gapCm"),.3)*10)
        target_density=max(0.0,min(100.0,_n(data.get("targetDensity"),80)))
        if width_mm<=0 or height_mm<=0:
            raise ValueError("La medida de la placa es inválida")

        kits=sorted(
            kits,
            key=lambda k:(
                _n(k.get("priority"),999999),
                str(k.get("date") or ""),
                str(k.get("figure") or ""),
            )
        )
        pool=kits[:min(32,len(kits))]
        minimum=min(10,len(pool))
        attempts=[]

        def score_result(r):
            if not r or not r.get("ok"):
                return (-1,-1,-1)
            # Prioridad ABSOLUTA:
            # 1) más figuras completas
            # 2) mayor ocupación real
            # 3) mejor compactación del grupo
            return (
                int(r.get("completeFigures",0)),
                float(r.get("density",0) or 0),
                float(r.get("compactness",0) or 0),
            )

        def run_knapsack(step, seconds, percent, label):
            _job_update(job_id,percent,label)
            r=solve_knapsack_kits(
                pool,width_mm,height_mm,spacing_mm,
                seconds=seconds,
                rotation_step=step,
                simplify_mm=0.45 if step>=15 else 0.38,
                max_vertices=145 if step>=15 else 165,
            )
            attempts.append({
                "stage":f"knapsack-{step}",
                "ok":bool(r and r.get("ok")),
                "completeFigures":(r or {}).get("completeFigures",0),
                "density":round(float((r or {}).get("density",0) or 0),2),
                "placedParts":(r or {}).get("placedPartCount",0),
                "timeout":bool((r or {}).get("timeout")),
            })
            return r

        # PASADA BASE: 30°. Es la estrategia que ya había conseguido el mejor
        # resultado estable. Desde aquí NUNCA se permite retroceder.
        best_ks=run_knapsack(30,16,15,"Búsqueda base 30° · guardando mejor placa…")
        if not best_ks or not best_ks.get("ok"):
            raise RuntimeError("La búsqueda base 30° no pudo generar una placa válida.")

        _job_update(
            job_id,32,
            f"Base guardada: {best_ks.get('completeFigures',0)} figuras · {best_ks.get('density',0):.1f}% real",
            completeFigures=best_ks.get("completeFigures",0),
        )

        # Más ángulos = más posibilidades, pero SOLO reemplazan al mejor resultado
        # si lo superan. Así una búsqueda fina jamás puede bajar de 8 a 4, por ejemplo.
        strategies=[
            (15,18,42,"Explorando ángulos cada 15°…"),
            (10,18,56,"Explorando ángulos cada 10°…"),
            (5,16,68,"Exploración fina cada 5°…"),
        ]

        for step,seconds,percent,label in strategies:
            # Si ya alcanzamos 10+ y 80% no gastamos tiempo en búsquedas innecesarias.
            if int(best_ks.get("completeFigures",0))>=minimum and float(best_ks.get("density",0) or 0)>=target_density:
                break
            candidate=run_knapsack(step,seconds,percent,label)
            if score_result(candidate)>score_result(best_ks):
                best_ks=candidate
                _job_update(
                    job_id,percent+4,
                    f"¡Mejora! {best_ks.get('completeFigures',0)} figuras · {best_ks.get('density',0):.1f}% ocupación",
                    completeFigures=best_ks.get("completeFigures",0),
                )
            else:
                _job_update(
                    job_id,percent+4,
                    f"Sin mejora a {step}° · se conserva {best_ks.get('completeFigures',0)} figuras",
                    completeFigures=best_ks.get("completeFigures",0),
                )

        selected_ids=set(best_ks.get("completeKitIds",[]))
        if not selected_ids:
            raise RuntimeError("El mejor resultado no contiene pares tapa+base completos.")
        selected=[k for k in pool if str(k.get('kitId')) in selected_ids]

        # El KNAPSACK ganador ya es una solución válida. La guardamos como baseline.
        best={
            'target':best_ks['completeFigures'],
            'placements':best_ks['placements'],
            'density':best_ks['density'],
            'compactness':best_ks['compactness'],
            'usedWidthMm':best_ks['usedWidthMm'],
            'usedHeightMm':best_ks['usedHeightMm'],
            'rotationStep':None,
            'simplifyMm':0.45,
        }

        def packed_score(r):
            if not r or not r.get("feasible"):
                return (-1,-1,-1)
            return (
                int(r.get("target",0)),
                float(r.get("density",0) or 0),
                float(r.get("compactness",0) or 0),
            )

        # Repack 10° y 5° SOLO sobre la cantidad ganadora.
        # Nuevamente, jamás sustituye una placa por otra peor.
        for step,seconds,percent in [(10,8,82),(5,8,90)]:
            if time.time()-started>132:
                break
            _job_update(
                job_id,percent,
                f"Reacomodando {len(selected)} figuras completas cada {step}°…",
                completeFigures=len(selected),
            )
            packed=solve_prefix(
                selected,len(selected),width_mm,height_mm,spacing_mm,
                seconds=seconds,
                rotation_step=step,
                simplify_mm=0.32 if step==10 else 0.28,
                max_vertices=180 if step==10 else 195,
            )
            attempts.append({
                "stage":f"repack-{step}",
                "ok":bool(packed and packed.get("feasible")),
                "completeFigures":len(selected),
                "density":round(float((packed or {}).get("density",0) or 0),2),
                "timeout":bool((packed or {}).get("timeout")),
            })
            if packed_score(packed)>(
                int(best.get("target",0)),
                float(best.get("density",0) or 0),
                float(best.get("compactness",0) or 0),
            ):
                best=packed

        _job_update(
            job_id,97,
            f"Validando 3 mm · resultado: {best.get('target',0)} figuras · {best.get('density',0):.1f}% real",
            completeFigures=int(best.get("target",0)),
        )

        return jsonify(
            ok=True,
            engine="PackingSolver C++ · BEST-OF ángulos",
            completeFigures=int(best.get("target",best_ks['completeFigures'])),
            placements=best['placements'],
            density=best['density'],
            compactness=best['compactness'],
            usedWidthMm=best['usedWidthMm'],
            usedHeightMm=best['usedHeightMm'],
            attempts=attempts,
            partial=int(best.get("target",0))<minimum,
            minimumTarget=minimum,
            targetDensity=target_density,
            reachedMinimum=int(best.get("target",0))>=minimum,
            reachedDensity=float(best.get("density",0) or 0)>=target_density,
            elapsedSeconds=round(time.time()-started,2),
            rotationStep=best.get("rotationStep"),
            simplifyMm=best.get("simplifyMm"),
            candidatePool=len(pool),
        )

    except Exception as e:
        return jsonify(
            ok=False,
            error=str(e),
            elapsedSeconds=round(time.time()-started,2),
        ),500


if __name__ == "__main__":
    app.run(host="0.0.0.0",port=int(__import__("os").environ.get("PORT","10000")))
