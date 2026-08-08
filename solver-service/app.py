import json, math, re, time
from xml.etree import ElementTree as ET

from shapely.geometry import Polygon, Point, box
from shapely.ops import unary_union
from shapely.affinity import translate
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
                steps=max(2,min(80,int(math.ceil(L/3.0))))
                for i in range(steps):
                    z=seg.point(i/steps); pts.append(_apply((z.real,z.imag),transform))
            z=sub[-1].end; pts.append(_apply((z.real,z.imag),transform))
            if len(pts)>=4: out.append(pts)
    except Exception:
        pass
    return out


def svg_to_geometry(svg_text, width_cm, height_cm):
    root=ET.fromstring(svg_text)
    vb=[_n(x) for x in re.split(r'[ ,]+',root.attrib.get('viewBox','').strip()) if x!='']
    if len(vb)!=4: vb=[0,0,max(1,width_cm*100),max(1,height_cm*100)]
    vx,vy,vw,vh=vb
    sx=width_cm*10.0/max(vw,1e-9); sy=height_cm*10.0/max(vh,1e-9)
    polys=[]

    def walk(el,parent_m=(1,0,0,1,0,0)):
        local=_mat_mul(parent_m,_transform_matrix(el.attrib.get('transform')))
        tag=el.tag.split('}')[-1].lower()
        rings=[]
        if tag=='path': rings=_sample_path(el.attrib.get('d',''),local)
        elif tag in ('polygon','polyline'):
            pts=[_apply(p,local) for p in _points_attr(el.attrib.get('points',''))]
            if tag=='polygon' and len(pts)>=3: rings=[pts+[pts[0]]]
        elif tag=='rect':
            x=_n(el.attrib.get('x')); y=_n(el.attrib.get('y')); w=_n(el.attrib.get('width')); h=_n(el.attrib.get('height'))
            if w>0 and h>0:
                pts=[(x,y),(x+w,y),(x+w,y+h),(x,y+h),(x,y)]
                rings=[[_apply(q,local) for q in pts]]
        elif tag=='circle':
            cx=_n(el.attrib.get('cx'));cy=_n(el.attrib.get('cy'));r=_n(el.attrib.get('r'))
            if r>0:
                pts=[(cx+r*math.cos(i*2*math.pi/64),cy+r*math.sin(i*2*math.pi/64)) for i in range(65)]
                rings=[[_apply(q,local) for q in pts]]
        elif tag=='ellipse':
            cx=_n(el.attrib.get('cx'));cy=_n(el.attrib.get('cy'));rx=_n(el.attrib.get('rx'));ry=_n(el.attrib.get('ry'))
            if rx>0 and ry>0:
                pts=[(cx+rx*math.cos(i*2*math.pi/64),cy+ry*math.sin(i*2*math.pi/64)) for i in range(65)]
                rings=[[_apply(q,local) for q in pts]]
        for ring in rings:
            physical=[((x-vx)*sx,(y-vy)*sy) for x,y in ring]
            try:
                poly=Polygon(physical)
                if not poly.is_valid: poly=poly.buffer(0)
                if not poly.is_empty and poly.area>0.2: polys.append(poly)
            except: pass
        for ch in list(el): walk(ch,local)
    walk(root)
    if not polys: raise ValueError('SVG sin contorno cerrado utilizable')
    geom=unary_union(polys)
    if not geom.is_valid: geom=geom.buffer(0)
    # Fill interior holes deliberately: user requested interior blocked for nesting safety.
    if geom.geom_type=='Polygon': geom=Polygon(geom.exterior)
    elif geom.geom_type=='MultiPolygon': geom=unary_union([Polygon(g.exterior) for g in geom.geoms])
    minx,miny,maxx,maxy=geom.bounds
    geom=translate(geom,xoff=-minx,yoff=-miny)
    # tiny simplification, far below cutting tolerance, to keep solver fast
    geom=geom.simplify(0.08,preserve_topology=True)
    return geom, minx, miny


def geom_parts(geom):
    if geom.geom_type=='Polygon': return [geom]
    if geom.geom_type=='MultiPolygon': return list(geom.geoms)
    ps=[g for g in getattr(geom,'geoms',[]) if g.geom_type=='Polygon']
    return ps


def solve_prefix(kits, target, width_mm, height_mm, spacing_mm, seconds, rotation_step=15):
    """
    Resuelve EXACTAMENTE los primeros `target` kits dentro de UNA placa fija.
    Cada kit conserva tapa+base como requisito lógico: la solución sólo se
    acepta si entraron todos sus componentes.
    """
    selected=kits[:target]

    # Para una placa física fija corresponde BIN_PACKING, no OPEN_DIMENSION_X.
    builder=InstanceBuilder(Objective.BIN_PACKING)
    builder.set_item_item_minimum_spacing(spacing_mm)
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

            geom,trimx,trimy=svg_to_geometry(part['svgText'],wcm,hcm)
            shapes=geom_parts(geom)
            if not shapes:
                raise ValueError(f"Sin polígono: {part.get('name','pieza')}")

            minx,miny,maxx,maxy=geom.bounds
            gw=maxx-minx; gh=maxy-miny
            diagnostics.append({
                "name":part.get("name","pieza"),
                "kit":kit.get("figure",""),
                "wMm":round(gw,3),
                "hMm":round(gh,3),
            })
            # Ninguna rotación puede salvar una pieza que excede ambas dimensiones.
            if min(gw,gh)>min(width_mm,height_mm) or max(gw,gh)>max(width_mm,height_mm):
                raise ValueError(
                    f"{part.get('name','pieza')} mide aprox. {gw/10:.1f} x {gh/10:.1f} cm "
                    f"y no puede entrar en una placa de {width_mm/10:.1f} x {height_mm/10:.1f} cm"
                )

            if part.get('allowRotate',True):
                step=max(5,min(90,int(rotation_step or 15)))
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
                'geom':geom,
                'kitIndex':kit_index,
            }
            expected+=1

    if expected==0:
        return None

    solver=Solver()
    solution=solver.solve(
        builder.build(),
        time_limit=max(1,float(seconds)),
        verbosity_level=0,
        optimization_mode='Anytime',
        use_tree_search=True,
        use_sequential_single_knapsack=True,
        use_sequential_value_correction=True,
        use_column_generation=False,
        use_dichotomic_search=False,
        anchor=True,
        anchor_x_weight=1.0,
        anchor_y_weight=1.0,
    )

    items=solution.all_items()
    bins=solution.total_bins_used()
    count=solution.total_item_count()

    # Sólo es una "figura completa" si entraron TODOS los componentes esperados.
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

        # La respuesta del wrapper ya trae las shapes en coordenadas absolutas.
        # Derivamos la traslación comparando centroides tras aplicar la rotación.
        cx,cy=src.centroid.x,src.centroid.y
        a=math.radians(angle)
        rcx=cx*math.cos(a)-cy*math.sin(a)
        rcy=cx*math.sin(a)+cy*math.cos(a)
        tx=placed.centroid.x-rcx
        ty=placed.centroid.y-rcy

        placements.append({
            'instanceId':meta.get('instanceId'),
            'kitId':meta.get('kitId'),
            'figure':meta.get('figure'),
            'name':meta.get('name'),
            'role':meta.get('role'),
            'xCm':tx/10.0,
            'yCm':ty/10.0,
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
        usedw=max(0,bx[2]-bx[0])
        usedh=max(0,bx[3]-bx[1])
        envelope=usedw*usedh
        compact=(item_area/envelope*100.0) if envelope>0 else 0.0
    else:
        usedw=usedh=compact=0

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
    }


from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

@app.get("/")
@app.get("/health")
def health():
    return jsonify(ok=True, engine="PackingSolver C++", version="22.0.2", status="ready")

@app.post("/nest")
def nest():
    started=time.time()
    try:
        data=request.get_json(silent=True) or {}
        kits=data.get("kits") or []
        if not kits:
            raise ValueError("No llegaron figuras completas al motor industrial")

        width_mm=_n(data.get("widthCm"),122)*10
        height_mm=_n(data.get("heightCm"),58)*10
        spacing_mm=max(0,_n(data.get("gapCm"),.2)*10)

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

        pool=kits[:min(18,len(kits))]
        total=len(pool)
        attempts=[]
        best=None

        # 1) Prueba de integración: una figura completa debe poder resolverse rápido.
        first=solve_prefix(pool,1,width_mm,height_mm,spacing_mm,8,rotation_step=15)
        attempts.append({
            "target":1,
            "rotationStep":15,
            "ok":bool(first and first.get("feasible")),
            "placed":(first or {}).get("placedCount", len((first or {}).get("placements",[]))),
        })
        if first and first.get("feasible"):
            best=first
        else:
            diag=(first or {}).get("diagnostics",[])
            metrics=(first or {}).get("metrics",{})
            raise RuntimeError(
                "PackingSolver no pudo colocar ni una figura completa. "
                f"Diagnóstico: componentes={diag[:4]}, métricas={metrics}"
            )

        # 2) Buscar rápidamente hasta el mínimo de 10, sin perder nunca el mejor resultado.
        minimum=min(10,total)
        if minimum>1:
            # Crecimiento progresivo: evita pedirle 20 componentes complejos de golpe.
            targets=[]
            for t in [2,4,6,8,10]:
                if 1<t<=minimum and t not in targets:
                    targets.append(t)
            if minimum not in targets:
                targets.append(minimum)

            for target in targets:
                if time.time()-started>95:
                    break
                r=solve_prefix(pool,target,width_mm,height_mm,spacing_mm,12,rotation_step=15)
                ok=bool(r and r.get("feasible"))
                attempts.append({
                    "target":target,
                    "rotationStep":15,
                    "ok":ok,
                    "placed":(r or {}).get("placedCount",len((r or {}).get("placements",[]))),
                })
                if ok:
                    best=r
                else:
                    # Si N no entra, tampoco asumimos que N+2 vaya a entrar.
                    break

        # 3) Si alcanzamos el mínimo, intentar agregar más figuras por prioridad.
        if best and best["target"]>=minimum and best["target"]<total:
            lo=best["target"]+1
            hi=total
            while lo<=hi and time.time()-started<120:
                mid=(lo+hi)//2
                r=solve_prefix(pool,mid,width_mm,height_mm,spacing_mm,10,rotation_step=15)
                ok=bool(r and r.get("feasible"))
                attempts.append({
                    "target":mid,
                    "rotationStep":15,
                    "ok":ok,
                    "placed":(r or {}).get("placedCount",len((r or {}).get("placements",[]))),
                })
                if ok:
                    best=r
                    lo=mid+1
                else:
                    hi=mid-1

        # 4) Refinamiento final a 5° sobre LA MISMA cantidad ya demostrada factible.
        # Nunca descarta la solución anterior si el refinamiento tarda o falla.
        if best and time.time()-started<132:
            refined=solve_prefix(
                pool,
                best["target"],
                width_mm,
                height_mm,
                spacing_mm,
                min(15,max(5,145-(time.time()-started))),
                rotation_step=5,
            )
            rok=bool(refined and refined.get("feasible"))
            attempts.append({
                "target":best["target"],
                "rotationStep":5,
                "ok":rok,
                "placed":(refined or {}).get("placedCount",len((refined or {}).get("placements",[]))),
            })
            if rok:
                # Preferimos el refinado si compacta mejor o igual.
                if refined.get("compactness",0)>=best.get("compactness",0):
                    best=refined

        if not best:
            raise RuntimeError("PackingSolver no encontró ninguna figura completa")

        return jsonify(
            ok=True,
            engine="PackingSolver C++ · placa fija",
            completeFigures=best["target"],
            placements=best["placements"],
            density=best["density"],
            compactness=best["compactness"],
            usedWidthMm=best["usedWidthMm"],
            usedHeightMm=best["usedHeightMm"],
            attempts=attempts,
            partial=best["target"]<minimum,
            minimumTarget=minimum,
            elapsedSeconds=round(time.time()-started,2),
            rotationStep=best.get("rotationStep"),
        )

    except Exception as e:
        return jsonify(
            ok=False,
            error=str(e),
            elapsedSeconds=round(time.time()-started,2),
        ),500


if __name__ == "__main__":
    app.run(host="0.0.0.0",port=int(__import__("os").environ.get("PORT","10000")))
