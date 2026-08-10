import nest_nfp2 as core
from shapely.geometry import Polygon
from shapely.ops import unary_union
import pyclipper


def _minkowski_svg_nest(stationary,moving,gap):
    # Replica el criterio usado por SVGnest/port Python: A + (-B), tomando
    # para cada par de contornos el NFP exterior principal (mayor área).
    extra=0.035
    A=stationary.buffer(gap/2.0+extra,join_style=2,resolution=2)
    B=moving.buffer(gap/2.0+extra,join_style=2,resolution=2)
    nfps=[]
    for ag in core._poly_components(A):
        Ac=core._ring_to_pc(ag.exterior.coords)
        if len(Ac)<3:continue
        for bg in core._poly_components(B):
            Braw=core._ring_to_pc(bg.exterior.coords)
            if len(Braw)<3:continue
            Bc=[(-x,-y) for x,y in Braw]
            try:
                solution=pyclipper.MinkowskiSum(Ac,Bc,True) or []
            except Exception:
                solution=[]
            best=None;best_area=-1.0
            for p in solution:
                if len(p)<3:continue
                try:area=abs(float(pyclipper.Area(p)))
                except Exception:area=0.0
                if area>best_area:
                    best_area=area;best=p
            if best:
                try:
                    poly=Polygon(core._pc_ring(best))
                    if not poly.is_valid:poly=poly.buffer(0)
                    if not poly.is_empty and poly.area>1e-6:nfps.append(poly)
                except Exception:
                    pass
    return unary_union(nfps) if nfps else Polygon()

core._minkowski_forbidden=_minkowski_svg_nest
app=core.app
