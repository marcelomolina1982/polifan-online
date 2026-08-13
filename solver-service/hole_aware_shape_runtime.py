"""Parche experimental SOLO para pruebas internas.
Preserva anillos interiores al convertir geometría Shapely al formato Sparrow.
No se importa en producción ni en Motor Lab visible todavía.
"""
import nest_sparrow as ns
from shapely.geometry import Polygon, MultiPolygon


def _ring_coords(ring):
    pts=[[float(x),float(y)] for x,y in list(ring.coords)]
    if len(pts)>1 and pts[0]==pts[-1]: pts=pts[:-1]
    return pts


def _poly_payload(poly):
    return {
        'outer': _ring_coords(poly.exterior),
        'inner': [_ring_coords(r) for r in poly.interiors if len(r.coords) >= 4],
    }


def hole_aware_shape(geom):
    if isinstance(geom, Polygon):
        if len(geom.interiors)==0:
            return {'type':'simple_polygon','data':_ring_coords(geom.exterior)}
        return {'type':'multi_polygon','data':[_poly_payload(geom)]}
    if isinstance(geom, MultiPolygon):
        data=[_poly_payload(g) for g in geom.geoms if not g.is_empty and g.area>0]
        if not data: raise ValueError('multipolígono vacío')
        return {'type':'multi_polygon','data':data}
    geoms=[g for g in getattr(geom,'geoms',[]) if isinstance(g,Polygon) and not g.is_empty]
    if len(geoms)==1:
        return hole_aware_shape(geoms[0])
    if geoms:
        return {'type':'multi_polygon','data':[_poly_payload(g) for g in geoms]}
    raise ValueError('geometría no soportada por Sparrow')


ns._shape=hole_aware_shape
