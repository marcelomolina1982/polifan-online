import json, os, subprocess, tempfile, time
import nest_sparrow as ns

EDGE_MARGIN_MM = 3.0
INNER_WIDTH_MM = ns.PLATE_WIDTH_MM - EDGE_MARGIN_MM * 2.0
INNER_HEIGHT_MM = ns.PLATE_HEIGHT_MM - EDGE_MARGIN_MM * 2.0

_original_result_payload = ns._result_payload


def _run_sparrow_v18(selected, gap_mm, seconds, seed, continuous=False, extra_part=None):
    started=time.time(); items=[]; idmap={}; item_id=0
    for kit in selected:
        for part in kit['parts']:
            row={'id':item_id,'demand':1,'shape':part['shape']}
            if not continuous: row['allowed_orientations']=ns.ANGLES_15
            items.append(row); idmap[item_id]=(part,False); item_id+=1
    if extra_part is not None:
        row={'id':item_id,'demand':1,'shape':extra_part['shape']}
        if not continuous: row['allowed_orientations']=ns.ANGLES_15
        items.append(row); idmap[item_id]=(extra_part,True); item_id+=1

    # V1.8: Sparrow anida solamente dentro del rectángulo interior.
    # Los 3 mm de borde se agregan luego a las coordenadas finales.
    instance={'name':'polifan-v18','items':items,'strip_height':INNER_HEIGHT_MM}
    with tempfile.TemporaryDirectory(prefix='polifan-sparrow-v18-') as td:
        inp=os.path.join(td,'input.json')
        with open(inp,'w',encoding='utf-8') as f: json.dump(instance,f,separators=(',',':'))
        cmd=[ns.SPARROW_BIN,'-i',inp,'-t',str(int(seconds)),'--min-item-separation',str(float(gap_mm)),'--workers','1','-s',str(int(seed))]
        try:
            proc=subprocess.run(cmd,cwd=td,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=seconds+20)
        except subprocess.TimeoutExpired as exc:
            return {'ok':False,'error':'Sparrow excedió su tiempo interno','log':(exc.stdout or '')[-1600:] if isinstance(exc.stdout,str) else ''}
        outpath=os.path.join(td,'output','final_polifan-v18.json')
        if not os.path.exists(outpath):
            # Sparrow usa el nombre del instance para el archivo. Dejamos fallback por compatibilidad.
            outpath=os.path.join(td,'output','final_polifan.json')
        if proc.returncode!=0 or not os.path.exists(outpath):
            return {'ok':False,'error':f'Sparrow terminó con código {proc.returncode}','log':(proc.stdout or '')[-2000:]}
        with open(outpath,'r',encoding='utf-8') as f: result=json.load(f)

    sol=result.get('solution') or {}
    strip_width=float(sol.get('strip_width') or 1e18)
    placed=((sol.get('layout') or {}).get('placed_items') or [])
    placements=[]
    for row in placed:
        mapped=idmap.get(int(row.get('item_id')))
        if not mapped: continue
        part,is_partial=mapped
        tr=row.get('transformation') or {}
        tx,ty=(tr.get('translation') or [0,0])[:2]
        placements.append({
            'instanceId':part['instanceId'],'kitId':part['kitId'],'figure':part['figure'],
            'name':part['name'],'role':part['role'],
            'xCm':(float(tx)+EDGE_MARGIN_MM)/10.0,
            'yCm':(float(ty)+EDGE_MARGIN_MM)/10.0,
            'angle':float(tr.get('rotation') or 0),
            'trimXCm':part['trimXmm']/10.0,'trimYCm':part['trimYmm']/10.0,
            'partialExtra':bool(is_partial)
        })

    density=ns._selection_density(selected,extra_part)
    fits=len(placements)==len(items) and strip_width<=INNER_WIDTH_MM+0.5
    return {
        'ok':True,'fits':fits,
        'stripWidthMm':strip_width+EDGE_MARGIN_MM,
        'innerStripWidthMm':strip_width,
        'edgeMarginMm':EDGE_MARGIN_MM,
        'density':density,'placements':placements,
        'elapsedSeconds':round(time.time()-started,2),
        'solverDensity':float(sol.get('density') or 0)*100.0,
        'runTimeSec':sol.get('run_time_sec'),
        'placedParts':len(placements),'expectedParts':len(items),
        'continuousRotation':bool(continuous),'hasPartialExtra':extra_part is not None
    }


def _result_payload_v18(selected,label,result,kits,rejected,attempts,started,extra_part=None):
    response=_original_result_payload(selected,label,result,kits,rejected,attempts,started,extra_part)
    payload=response.get_json(silent=True) or {}
    payload['engine']='Sparrow base garantizada + crecimiento + V1.8'
    payload['edgeMarginMm']=EDGE_MARGIN_MM
    payload['innerPlateMm']={'width':INNER_WIDTH_MM,'height':INNER_HEIGHT_MM}
    return ns.jsonify(**payload)


ns._run_sparrow = _run_sparrow_v18
ns._result_payload = _result_payload_v18
