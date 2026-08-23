"""Hotfix del benchmark exacto: normaliza namespaces SVG antes de reprocesar cada pieza."""
from copy import deepcopy
from xml.etree import ElementTree as ET
import clean_lab_app as base
import nest_sparrow as core

app = base.app


def _strip_namespaces(el):
    if isinstance(el.tag, str) and '}' in el.tag:
        el.tag = el.tag.split('}', 1)[1]
    # No necesitamos declaraciones xmlns en subárboles internos para svg_to_geometry.
    for key in list(el.attrib):
        if key == 'xmlns' or key.startswith('{http://www.w3.org/2000/xmlns/}'):
            el.attrib.pop(key, None)
    for child in list(el):
        _strip_namespaces(child)
    return el


def _fixed_exact_piece_kits_from_plate_svg(svg_text):
    root = ET.fromstring(svg_text)
    pieces = []
    for g in root.iter():
        gid = str(g.attrib.get('id') or '')
        if not gid.startswith('pieza_') or g.attrib.get('data-polifan-piece') != '1':
            continue
        piece = _strip_namespaces(deepcopy(g))
        piece.attrib.pop('transform', None)
        wrapper = ET.Element('svg', {
            'width': '1220mm',
            'height': '580mm',
            'viewBox': '0 0 1220 580',
        })
        wrapper.append(piece)
        piece_svg = ET.tostring(wrapper, encoding='unicode')
        # Validación explícita antes de pasar al conversor geométrico.
        ET.fromstring(piece_svg)
        geom, trimx, trimy = core.svg_to_geometry(
            piece_svg, 122, 58, solver_tolerance_mm=.18, max_vertices=360
        )
        if geom.is_empty or geom.area <= 0:
            continue
        industrial = None
        for child in piece.iter():
            if child.attrib.get('data-industrial-piece') is not None:
                industrial = child
                break
        kit_name = ''
        instance = gid
        if industrial is not None:
            kit_name = str(industrial.attrib.get('data-kit') or '')
            instance = str(industrial.attrib.get('data-instance') or gid)
        part = {
            'instanceId': instance,
            'kitId': gid,
            'figure': kit_name or gid,
            'name': gid,
            'role': 'simple',
            'geom': geom,
            'shape': core._shape(geom),
            'trimXmm': float(trimx),
            'trimYmm': float(trimy),
            'area': float(geom.area or 0),
            'envelope': max(1.0, (geom.bounds[2]-geom.bounds[0])*(geom.bounds[3]-geom.bounds[1])),
        }
        pieces.append({
            'kitId': gid,
            'figure': kit_name or gid,
            'priority': len(pieces) + 1,
            'parts': [part],
            'area': part['area'],
            'envelope': part['envelope'],
            'solidity': part['area'] / max(1.0, part['envelope']),
        })
    return pieces


base._exact_piece_kits_from_plate_svg = _fixed_exact_piece_kits_from_plate_svg
