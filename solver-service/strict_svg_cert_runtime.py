from flask import request, jsonify
import tempfile, time, re
from pathlib import Path
from xml.etree import ElementTree as ET
import motor_definitivo_v1 as core
from extended_app import app

STRICT_GAP_MM=3.0
VALIDATION_PPM=4.0
SVG_NS='http://www.w3.org/2000/svg'
XLINK_NS='http://www.w3.org/1999/xlink'
ET.register_namespace('',SVG_NS)
ET.register_namespace('xlink',XLINK_NS)


def _id_stats(svg_text):
    root=ET.fromstring(svg_text)
    ids=[e.attrib.get('id') for e in root.iter() if e.attrib.get('id')]
    unique=len(set(ids))
    return {'idCount':len(ids),'uniqueIdCount':unique,'duplicateIdCount':len(ids)-unique,'idsUnique':len(ids)==unique}


def _rewrite_local_refs(scope,mapping):
    if not mapping:return
    for elem in scope.iter():
        for key,value in list(elem.attrib.items()):
            nv=str(value)
            for old,new in mapping.items():
                nv=nv.replace(f'url(#{old})',f'url(#{new})')
                if nv==f'#{old}':nv=f'#{new}'
            if nv!=value:elem.set(key,nv)


def _make_piece_ids_unique(svg_text):
    """Renombra sólo IDs repetidos y sus referencias, sin tocar geometría.

    composeIndustrialSvg envuelve cada fuente en data-industrial-piece. Se usa ese
    grupo como ámbito para que una referencia local a defs1/clipPath/gradient siga
    apuntando al recurso de SU pieza después del renombrado.
    """
    root=ET.fromstring(svg_text)
    used=set();renamed=0
    scopes=[e for e in root.iter() if e.attrib.get('data-industrial-piece') is not None]
    if not scopes:scopes=[root]
    for scope_index,scope in enumerate(scopes):
        mapping={}
        for elem in scope.iter():
            old=elem.attrib.get('id')
            if not old:continue
            new=old
            if new in used:
                base=f'{old}__p{scope_index}'
                new=base;serial=2
                while new in used:
                    new=f'{base}_{serial}';serial+=1
                elem.set('id',new);mapping[old]=new;renamed+=1
            used.add(new)
        _rewrite_local_refs(scope,mapping)
    cleaned=ET.tostring(root,encoding='unicode')
    stats=_id_stats(cleaned)
    stats['renamedIdCount']=renamed
    return cleaned,stats


def _validate_svg_text(svg_text, filename='placa.svg'):
    started=time.time()
    sanitized,id_stats=_make_piece_ids_unique(svg_text)
    if not id_stats.get('idsUnique'):
        return {
            'status':'EXPORT_RECHAZADO',
            'validation':{'valid':False,'piece_count':0,'conflicts':0,'border_conflicts':0,'min_gap_mm':None,'gap_required_mm':STRICT_GAP_MM,**id_stats},
            'svgText':None,'seconds':round(time.time()-started,3),'engineVersion':'V1.7-strict-3mm-validator-only'
        }
    with tempfile.TemporaryDirectory(prefix='polifan_cert_') as td:
        inp=Path(td)/(Path(filename or 'placa.svg').name or 'placa.svg')
        if not inp.name.lower().endswith('.svg'):
            inp=inp.with_suffix('.svg')
        inp.write_text(sanitized,encoding='utf-8')
        root,defs,pieces,collapsed=core.extract(inp,VALIDATION_PPM)
        if not pieces:
            return {
                'status':'SIN_GEOMETRIA','validation':{'valid':False,'piece_count':0,'conflicts':0,'border_conflicts':0,'min_gap_mm':None,'gap_required_mm':STRICT_GAP_MM,**id_stats},
                'seconds':round(time.time()-started,3)
            }
        ev=core.evaluate(pieces,STRICT_GAP_MM)
        valid=(ev[1]==0 and ev[2]==0 and ev[3] is not None and float(ev[3])>=STRICT_GAP_MM and id_stats.get('idsUnique'))
        validation={
            'valid':valid,
            'piece_count':len(pieces),
            'collapsed_internal':collapsed,
            'conflicts':int(ev[1]),
            'border_conflicts':int(ev[2]),
            'min_gap_mm':None if ev[3] is None else round(float(ev[3]),9),
            'gap_required_mm':STRICT_GAP_MM,
            'validation_ppm':VALIDATION_PPM,
            'geometry_unchanged':True,
            **id_stats,
        }
        return {
            'status':'CERTIFICADO' if valid else 'EXPORT_RECHAZADO',
            'pieces':len(pieces),
            'validation':validation,
            'svgText':sanitized if valid else None,
            'seconds':round(time.time()-started,3),
            'engineVersion':'V1.7-strict-3mm-validator-only',
            'certificationStrategy':'unique_piece_ids_then_validate_exact_svg_without_repacking_strict_3mm',
        }


def strict_motor_definitivo_svg():
    data=request.get_json(silent=True) or {}
    svg_text=data.get('svgText') or ''
    if not svg_text.strip():
        return jsonify(ok=False,error='Falta svgText'),400
    if len(svg_text)>8_000_000:
        return jsonify(ok=False,error='SVG demasiado grande para el modo de prueba'),413
    filename=str(data.get('filename') or 'placa.svg')
    try:
        result=_validate_svg_text(svg_text,filename)
        certified=result.get('status')=='CERTIFICADO'
        return jsonify(ok=certified,engine='Certificador exacto V1.7 · IDs únicos · 3 mm duros · sin reacomodar',**result),(200 if certified else 422)
    except Exception as exc:
        return jsonify(ok=False,error=str(exc),engine='Certificador exacto V1.7 · IDs únicos · 3 mm duros'),500


def strict_motor_definitivo_health():
    return jsonify(ok=True,engine='Certificador exacto V1.7',mode='test',preferredGapMm=3.0,absoluteMinGapMm=3.0,repacking=False,uniqueSvgIds=True)

# Sustituir las rutas antiguas ya registradas por extended_app sin crear endpoints duplicados.
if 'motor_definitivo_svg' in app.view_functions:
    app.view_functions['motor_definitivo_svg']=strict_motor_definitivo_svg
if 'motor_definitivo_health' in app.view_functions:
    app.view_functions['motor_definitivo_health']=strict_motor_definitivo_health
