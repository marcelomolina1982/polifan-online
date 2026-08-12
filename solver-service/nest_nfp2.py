from nest_nfp import app, _priority, _prep_kit, _used_bounds, _state_score, _placements
from extended_app import _kit_valid_for_plate
from app import _n
from flask import request, jsonify
from shapely.affinity import rotate as shp_rotate, translate as shp_translate
from shapely.geometry import Polygon, MultiPolygon, box
from shapely.ops import unary_union
import pyclipper
import time, math

MIN_COMPLETE=10
HIGH_DENSITY_COMPLETE=9
HIGH_DENSITY_MIN=72.0
MAX_COMPLETE=14
TOTAL_BUDGET_SECONDS=225
STATE_BEAM=18
PART_BEAM=12
KIT_CANDIDATES=18
ANGLE_SET=tuple(range(0,360,15))
PC_SCALE=1000.0


def _poly_components(geom):
    if geom.is_empty:
        return []
    if isinstance(geom,Polygon):
        return [geom]
    if isinstance(geom,MultiPolygon):
        return [g for g in geom.geoms if not g.is_empty]
    return [g for g in getattr(geom,'geoms',[]) if isinstance(g,Polygon) and not g.is_empty]


def _ring_to_pc(coords,max_points=140):
    pts=list(coords)[:-1]
    if len(pts)>max_points:
        step=max(1,math.ceil(len(pts)/max_points))
        pts=pts[::step]
    return [(int(round(x*PC_SCALE)),int(round(y*PC_SCALE))) for x,y in pts]


def _pc_ring(path):
    return [(x/PC_SCALE,y/PC_SCALE) for x,y in path]


def _polytree_to_geom(tree):
    polys=[]
    def visit(node):
        for child in getattr(node,'Childs',[]):
            if not getattr(child,'IsHole',False) and len(getattr(child,'Contour',[]))>=3:
                shell=_pc_ring(child.Contour)
                holes=[]
                for h in getattr(child,'Childs',[]):
                    if getattr(h,'IsHole',False) and len(getattr(h,'Contour',[]))>=3:
                        holes.append(_pc_ring(h.Contour))
                try:
                    p=Polygon(shell,holes)
                    if not p.is_valid:p=p.buffer(0)
                    if not p.is_empty and p.area>1e-6:polys.append(p)
                except Exception:
                    pass
            visit(child)
    visit(tree)
    return unary_union(polys) if polys else Polygon()


def _minkowski_forbidden(stationary,moving,gap):
    # SVGnest offsets both shapes half the requested spacing. The NFP of the
    # expanded shapes therefore represents all translations closer than gap.
    extra=0.035
    A=stationary.buffer(gap/2.0+extra,join_style=2,resolution=2)
    B=moving.buffer(gap/2.0+extra,join_style=2,resolution=2)
    sums=[]
    for ag in _poly_components(A):
        ap=_ring_to_pc(ag.exterior.coords)
        if len(ap)<3:continue
        for bg in _poly_components(B):
            bp=_ring_to_pc(bg.exterior.coords)
            if len(bp)<3:continue
            pattern=[(-x,-y) for x,y in bp]
            try:
                sums.extend(pyclipper.MinkowskiSum(pattern,ap,True) or [])
            except Exception:
                continue
    sums=[p for p in sums if len(p)>=3]
    if not sums:return Polygon()
    try:
        pc=pyclipper.Pyclipper()
        pc.AddPaths(sums,pyclipper.PT_SUBJECT,True)
        tree=pc.Execute2(pyclipper.CT_UNION,pyclipper.PFT_NONZERO,pyclipper.PFT_NONZERO)
        return _polytree_to_geom(tree)
    except Exception:
        fallback=[]
        for p in sums:
            try:
                q=Polygon(_pc_ring(p))
                if not q.is_valid:q=q.buffer(0)
                if not q.is_empty:fallback.append(q)
            except Exception:pass
        return unary_union(fallback) if fallback else Polygon()


def _normalize_rotated(part,angle):
    g=shp_rotate(part['geom'],angle,origin=(0,0),use_radians=False)
    minx,miny,maxx,maxy=g.bounds
    g=shp_translate(g,xoff=-minx,yoff=-miny)
    return g,float(-minx),float(-miny)


def _valid(cand,placed,width_mm,height_mm,gap):
    b=cand.bounds
    if b[0] < -0.02 or b[1] < -0.02 or b[2] > width_mm+0.02 or b[3] > height_mm+0.02:
        return False
    for p in placed:
        other=p['geom']
        if cand.intersects(other):return False
        if cand.distance(other)<gap-0.04:return False
    return True


def _allowed_region(moving,placed,width_mm,height_mm,gap):
    minx,miny,maxx,maxy=moving.bounds
    w=maxx-minx;h=maxy-miny
    if w>width_mm+1e-6 or h>height_mm+1e-6:return Polygon()
    # Inner Fit Polygon for a rectangular bin, expressed as translation space.
    allowed=box(0.0,0.0,max(0.0,width_mm-w),max(0.0,height_mm-h))
    if not placed:return allowed
    forbidden=[]
    for pm in placed:
        f=_minkowski_forbidden(pm['geom'],moving,gap)
        if not f.is_empty:forbidden.append(f)
    if not forbidden:return allowed
    try:
        blocked=unary_union(forbidden)
        free=allowed.difference(blocked)
        if not free.is_valid:free=free.buffer(0)
        return free
    except Exception:
        return Polygon()


def _region_points(region,max_points=260):
    if region.is_empty:return []
    geoms=_poly_components(region)
    pts=[]
    for g in geoms:
        rings=[g.exterior]+list(g.interiors)
        for ring in rings:
            coords=list(ring.coords)[:-1]
            if len(coords)>90:
                step=max(1,len(coords)//90)
                coords=coords[::step]
            pts.extend(coords)
        try:
            rp=g.representative_point();pts.append((rp.x,rp.y))
        except Exception:pass
    # SVGnest evaluates NFP vertices. Keep unique vertices, preferring left/bottom.
    uniq={}
    for x,y in pts:
        key=(round(x,3),round(y,3));uniq[key]=(float(x),float(y))
    vals=list(uniq.values())
    vals.sort(key=lambda p:(p[0]*2+p[1],p[0],p[1]))
    return vals[:max_points]


def _placement_variants(state,part,width_mm,height_mm,gap):
    variants=[]
    for angle in ANGLE_SET:
        rg,sx,sy=_normalize_rotated(part,angle)
        region=_allowed_region(rg,state['placed'],width_mm,height_mm,gap)
        if region.is_empty:continue
        for x,y in _region_points(region):
            cand=shp_translate(rg,xoff=x,yoff=y)
            if not _valid(cand,state['placed'],width_mm,height_mm,gap):
                # Numerical boundary fallback: move a hair toward free space.
                passed=False
                for dx,dy in ((.08,.08),(.08,0),(0,.08),(-.08,0),(0,-.08)):
                    c2=shp_translate(rg,xoff=x+dx,yoff=y+dy)
                    if _valid(c2,state['placed'],width_mm,height_mm,gap):
                        cand=c2;x+=dx;y+=dy;passed=True;break
                if not passed:continue
            meta={'geom':cand,'instanceId':part['instanceId'],'kitId':part['kitId'],'figure':part['figure'],
                  'name':part['name'],'role':part['role'],'angle':angle,'xMm':x+sx,'yMm':y+sy,
                  'trimXmm':part['trimXmm'],'trimYmm':part['trimYmm'],'area':part['area']}
            newp=state['placed']+[meta]
            bb=_used_bounds(newp)
            envelope=max(1.0,(bb[2]-bb[0])*(bb[3]-bb[1]))
            width=bb[2]-bb[0];height=bb[3]-bb[1]
            score=(width*2.0+height,envelope,y,x)
            variants.append((score,meta))
    variants.sort(key=lambda z:z[0])
    out=[];seen=set()
    for _,m in variants:
        c=m['geom'].centroid
        key=(round(c.x/6),round(c.y/6),m['angle']//15)
        if key in seen:continue
        seen.add(key);out.append(m)
        if len(out)>=PART_BEAM:break
    return out


def _add_kit(state,kit,width_mm,height_mm,gap):
    orders=[kit['parts']]
    if len(kit['parts'])>1:orders.append(list(reversed(kit['parts'])))
    finals=[]
    for order in orders:
        partial=[{'placed':state['placed'],'kits':state['kits'],'area':state['area']}]
        for part in order:
            nxt=[]
            for st in partial:
                for pm in _placement_variants(st,part,width_mm,height_mm,gap):
                    nxt.append({'placed':st['placed']+[pm],'kits':st['kits'],'area':st['area']+part['area']})
            if not nxt:
                partial=[];break
            # During a kit, choose compact partial layouts, not count (count is unchanged).
            def pscore(s):
                bb=_used_bounds(s['placed']);w=bb[2]-bb[0];h=bb[3]-bb[1]
                return (-(w*2+h),-w*h,s['area'])
            partial=sorted(nxt,key=pscore,reverse=True)[:PART_BEAM]
        finals.extend(partial)
    out=[{'placed':st['placed'],'kits':state['kits']+[kit],'area':st['area']} for st in finals]
    out.sort(key=lambda s:_state_score(s,width_mm,height_mm),reverse=True)
    return out[:PART_BEAM]


def _signature(st):
    spatial=tuple(sorted((p['kitId'],p['role'],round(p['geom'].centroid.x/8),round(p['geom'].centroid.y/8),p['angle']//15) for p in st['placed']))
    return (tuple(sorted(k['kitId'] for k in st['kits'])),spatial)


def _payload(st,width_mm,height_mm,started,ready,reason,rejected,pool_count):
    bb=_used_bounds(st['placed'])
    area_density=100.0*st['area']/(width_mm*height_mm)
    envelope_density=0.0
    if st['placed']:
        envelope_density=100.0*((bb[2]-bb[0])*(bb[3]-bb[1]))/(width_mm*height_mm)
    return {'ok':ready,'engine':'Motor NFP2 · SVGnest-style union/difference + V1.7',
            'completeFigures':len(st['kits']),'placements':_placements(st),'density':area_density,
            'envelopeOccupancy':envelope_density,'usedWidthMm':max(0,bb[2]-bb[0]),'usedHeightMm':max(0,bb[3]-bb[1]),
            'rotationStep':15,'source':'nfp2-union-difference','selectionStrategy':'NFP completo / union / diferencia',
            'productionReady':ready,'reachedMinimum':len(st['kits'])>=MIN_COMPLETE,
            'highDensityException':len(st['kits'])==9 and area_density>=HIGH_DENSITY_MIN,
            'resultReason':reason,'bestDiagnosticComplete':len(st['kits']),'bestDiagnosticDensity':round(area_density,1),
            'candidatePool':pool_count,'rejectedCount':len(rejected),'rejected':rejected[:8],
            'elapsedSeconds':round(time.time()-started,2)}


@app.get('/nest-nfp2/health')
def nest_nfp2_health():
    return jsonify(ok=True,engine='Motor NFP2 SVGnest-style',method='inner-fit minus union outer-NFP',certifier='V1.7')


@app.post('/nest-nfp2')
def nest_nfp2():
    started=time.time();data=request.get_json(silent=True) or {}
    try:
        width_mm=max(1.0,_n(data.get('widthCm'),122)*10);height_mm=max(1.0,_n(data.get('heightCm'),58)*10)
        gap=max(2.5,_n(data.get('gapCm'),.3)*10)
        raw=sorted(data.get('kits') or [],key=lambda k:(_priority(k),str(k.get('date') or ''),str(k.get('figure') or '')))[:32]
        if not raw:return jsonify(ok=False,error='No llegaron figuras al Motor NFP2'),400
        kits=[];rejected=[]
        for k in raw:
            valid,detail=_kit_valid_for_plate(k,width_mm,height_mm)
            if not valid:
                rejected.append({'kitId':str(k.get('kitId') or ''),'figure':str(k.get('figure') or ''),'reason':str(detail)});continue
            try:kits.append(_prep_kit(k))
            except Exception as exc:rejected.append({'kitId':str(k.get('kitId') or ''),'figure':str(k.get('figure') or ''),'reason':str(exc)})
        if not kits:return jsonify(ok=False,error='No hay kits geométricos utilizables',rejected=rejected[:8]),422

        # SVGnest seeds large parts first, while we preserve urgency in the candidate pool.
        urgent=kits[:22]
        by_area=sorted(kits,key=lambda k:(-k['area'],k['priority']))[:18]
        compact=sorted(kits,key=lambda k:(k['area'],k['priority']))[:12]
        pool=[];seen=set()
        for k in urgent+by_area+compact:
            if k['kitId'] not in seen:seen.add(k['kitId']);pool.append(k)

        beam=[{'placed':[],'kits':[],'area':0.0}];best=beam[0];depth=0
        while beam and depth<MAX_COMPLETE and time.time()-started<TOTAL_BUDGET_SECONDS:
            depth+=1;nxt=[]
            for st in beam:
                used={k['kitId'] for k in st['kits']}
                remain=[k for k in pool if k['kitId'] not in used]
                # First-fit-decreasing with urgency as tie breaker, like SVGnest's seed.
                remain=sorted(remain,key=lambda k:(-k['area'],k['priority']))[:KIT_CANDIDATES]
                # Ensure some very urgent and some compact alternatives survive every depth.
                alt=sorted([k for k in pool if k['kitId'] not in used],key=lambda k:(k['priority'],k['area']))[:6]
                alt+=sorted([k for k in pool if k['kitId'] not in used],key=lambda k:(k['area'],k['priority']))[:5]
                ordered=[];ids=set()
                for k in remain+alt:
                    if k['kitId'] not in ids:ids.add(k['kitId']);ordered.append(k)
                for kit in ordered:
                    if time.time()-started>=TOTAL_BUDGET_SECONDS:break
                    nxt.extend(_add_kit(st,kit,width_mm,height_mm,gap))
            if not nxt:break
            uniq={}
            for st in nxt:
                sig=_signature(st)
                if sig not in uniq or _state_score(st,width_mm,height_mm)>_state_score(uniq[sig],width_mm,height_mm):uniq[sig]=st
            beam=sorted(uniq.values(),key=lambda s:_state_score(s,width_mm,height_mm),reverse=True)[:STATE_BEAM]
            if _state_score(beam[0],width_mm,height_mm)>_state_score(best,width_mm,height_mm):best=beam[0]
            if len(best['kits'])>=MAX_COMPLETE:break

        n=len(best['kits']);density=100.0*best['area']/(width_mm*height_mm)
        ready=n>=MIN_COMPLETE or (n==HIGH_DENSITY_COMPLETE and density>=HIGH_DENSITY_MIN)
        reason=(f'{n} completas con NFP completo' if n>=MIN_COMPLETE else (f'9 completas con {density:.1f}% mediante NFP completo' if ready else f'Mejor parcial NFP2: {n} completas con {density:.1f}%'))
        payload=_payload(best,width_mm,height_mm,started,ready,reason,rejected,len(pool))
        if not ready:payload['error']=reason
        return jsonify(**payload),(200 if ready else 422)
    except Exception as exc:
        return jsonify(ok=False,error=str(exc),engine='Motor NFP2 SVGnest-style'),500
