from __future__ import annotations
from pathlib import Path
import math, tempfile, time
from shapely.ops import nearest_points
import motor_definitivo_v1 as core
import motor_definitivo_v4 as v4


def _score(ev):
    return v4._score(ev)


def _pairs(pieces, gap):
    return v4._pairs(pieces, gap)


def _move(state, idx, dx, dy, ang=0.0):
    return v4._move(state, idx, dx, dy, ang)


def _pair_direction(state, ia, ib):
    a=state[ia].geom; b=state[ib].geom
    try:
        pa,pb=nearest_points(a,b)
        vx=pb.x-pa.x; vy=pb.y-pa.y
    except Exception:
        ca=a.centroid; cb=b.centroid
        vx=cb.x-ca.x; vy=cb.y-ca.y
    L=math.hypot(vx,vy)
    if L < 1e-9:
        ca=a.centroid; cb=b.centroid
        vx=cb.x-ca.x; vy=cb.y-ca.y; L=math.hypot(vx,vy)
    if L < 1e-9:
        return 1.0,0.0
    return vx/L,vy/L


def repair_last_pair(pieces, gap, seconds=18.0, pair_hints=None):
    """Reparacion determinista del ultimo conflicto.

    Usa el par exacto y la direccion de minima distancia entre sus siluetas.
    El resto de la placa queda congelado. Mantiene borde 0 en todo momento.
    """
    start=time.time(); best=[p.clone() for p in pieces]; best_ev=core.evaluate(best,gap)
    tested=0; rounds=0; beam=[best]; seen=set()

    while beam and time.time()-start < seconds and rounds < 8:
        rounds+=1; candidates=[]
        for state in beam:
            ps=_pairs(state,gap)
            hints=[]
            if pair_hints:
                for ia,ib in pair_hints:
                    if 0 <= ia < len(state) and 0 <= ib < len(state) and ia != ib:
                        hints.append((state[ia].geom.distance(state[ib].geom),ia,ib))
            work=(hints+ps)[:4]
            if not work:
                ev=core.evaluate(state,gap)
                if ev[1]==0 and ev[2]==0:
                    return state,ev,{'used':True,'solved':True,'rounds':rounds,'tested':tested,'seconds':round(time.time()-start,3)}
                break

            for d,ia,ib in work:
                ux,uy=_pair_direction(state,ia,ib)
                tx,ty=-uy,ux
                need=max(0.25,gap-d+0.35)
                for factor in (0.5,0.75,1.0,1.25,1.6,2.0,2.6,3.4):
                    sep=need*factor
                    for tangent in (0.0,-0.35,0.35,-0.75,0.75,-1.5,1.5,-3.0,3.0):
                        for ang_a,ang_b in ((0,0),(-0.25,0.25),(0.25,-0.25),(-0.5,0.5),(0.5,-0.5),(-1,1),(1,-1)):
                            if time.time()-start >= seconds: break
                            key=(ia,ib,round(sep,3),tangent,ang_a,ang_b,round(state[ia].geom.centroid.x,1),round(state[ib].geom.centroid.x,1))
                            if key in seen: continue
                            seen.add(key)

                            # Opcion A: repartir el empuje entre ambas piezas.
                            cand=_move(state,ia,-ux*sep/2+tx*tangent,-uy*sep/2+ty*tangent,ang_a)
                            cand=_move(cand,ib, ux*sep/2-tx*tangent, uy*sep/2-ty*tangent,ang_b)
                            tested+=1; ev=core.evaluate(cand,gap)
                            if ev[2]==0:
                                if ev[1]==0:
                                    return cand,ev,{'used':True,'solved':True,'rounds':rounds,'tested':tested,'seconds':round(time.time()-start,3),'mode':'nearest_pair_split'}
                                candidates.append((_score(ev),cand,ev))

                            # Opcion B/C: mover solo una pieza, util si la otra esta encajonada.
                            for idx,sgn in ((ia,-1.0),(ib,1.0)):
                                cand=_move(state,idx,sgn*ux*sep+tx*tangent,sgn*uy*sep+ty*tangent,ang_a if idx==ia else ang_b)
                                tested+=1; ev=core.evaluate(cand,gap)
                                if ev[2]: continue
                                if ev[1]==0:
                                    return cand,ev,{'used':True,'solved':True,'rounds':rounds,'tested':tested,'seconds':round(time.time()-start,3),'mode':'nearest_pair_single'}
                                candidates.append((_score(ev),cand,ev))

        if not candidates: break
        candidates.sort(key=lambda x:x[0])
        beam=[x[1] for x in candidates[:18]]
        if candidates[0][0] < _score(best_ev):
            best,best_ev=candidates[0][1],candidates[0][2]

    return best,best_ev,{'used':True,'solved':best_ev[1]==0 and best_ev[2]==0,'rounds':rounds,'tested':tested,'seconds':round(time.time()-start,3)}


def _validate_detailed(svg_path, ppm=2.0):
    tree=core.ET.parse(svg_path); root=tree.getroot()
    defs=[core.copy.deepcopy(c) for c in root if core.tag(c)=='defs']
    cut=next((e for e in root.iter() if e.attrib.get('id')=='CORTE'),None)
    pieces=[]
    if cut is None:
        return {'valid':False,'piece_count':0,'conflicts':0,'border_conflicts':0,'min_gap_mm':None,'validation_ppm':ppm,'gap_required_mm':core.MIN_GAP,'conflict_pairs':[]}
    for i,g in enumerate(list(cut)):
        if g.attrib.get('data-polifan-piece')!='1': continue
        geom=core.raster_geom(root,defs,g,ppm)
        if not geom.is_empty and geom.area>.2:
            pieces.append(core.Piece(g.attrib.get('id',f'p{i}'),geom))
    ev=core.evaluate(pieces,core.MIN_GAP)
    pairs=[{'distance_mm':round(d,6),'a':i,'b':j} for d,i,j in _pairs(pieces,core.MIN_GAP)]
    return {'valid':ev[1]==0 and ev[2]==0,'piece_count':len(pieces),'conflicts':ev[1],'border_conflicts':ev[2],'min_gap_mm':ev[3],'validation_ppm':ppm,'gap_required_mm':core.MIN_GAP,'conflict_pairs':pairs}


def _export_validate(defs,sol,out,meta,expected):
    core.export(defs,sol,out,meta)
    val=_validate_detailed(out,2.0)
    return val['valid'] and val['piece_count']==expected,val


def solve_file(inp,outdir,seconds3=8.,seconds25=14.):
    t0=time.time(); root,defs,pieces,collapsed=core.extract(inp,1.0)
    if not pieces:
        return {'archivo':inp.name,'status':'SIN_GEOMETRIA','seconds':round(time.time()-t0,3),'engineVersion':'V1.5'}
    base=core.compact_seed(pieces); attempts=[]

    def try_gap(final_gap,seconds):
        gap=final_gap+core.SEARCH_SAFETY; ev=core.evaluate(base,gap)
        if ev[1]==0 and ev[2]==0: return [p.clone() for p in base],ev
        best=None; best_ev=ev; per=max(.5,seconds/4)
        for s in (17,43,101,211):
            cand,cev,meta=core.anneal(base,gap,per,s)
            attempts.append({'gap':final_gap,'eval':cev,'meta':meta})
            if _score(cev)<_score(best_ev): best,best_ev=cand,cev
            if cev[1]==0 and cev[2]==0: return cand,cev
        return best,best_ev

    sol,ev=try_gap(core.PREFERRED_GAP,seconds3); used=core.PREFERRED_GAP
    if sol is None or ev[1] or ev[2]:
        sol,ev=try_gap(core.MIN_GAP,seconds25); used=core.MIN_GAP

    # Primero conserva la reparacion V1.4. Si queda exactamente un conflicto,
    # V1.5 usa la direccion geometrica real entre las dos siluetas.
    repair_meta=None; pair_meta=None
    if sol is not None and ev[2]==0 and 1 <= ev[1] <= 2:
        sol2,ev2,repair_meta=v4.repair_residual(sol,core.MIN_GAP+core.SEARCH_SAFETY,seconds=10.0,max_pairs=2)
        attempts.append({'repair_v14':repair_meta,'eval':ev2})
        if _score(ev2)<_score(ev) or (ev2[1]==0 and ev2[2]==0): sol,ev=sol2,ev2

    if sol is not None and ev[2]==0 and ev[1]==1:
        ps=_pairs(sol,core.MIN_GAP+core.SEARCH_SAFETY)
        hints=[(ps[0][1],ps[0][2])] if ps else None
        sol2,ev2,pair_meta=repair_last_pair(sol,core.MIN_GAP+core.SEARCH_SAFETY,seconds=18.0,pair_hints=hints)
        attempts.append({'repair_last_pair':pair_meta,'eval':ev2})
        if _score(ev2)<_score(ev) or (ev2[1]==0 and ev2[2]==0): sol,ev=sol2,ev2

    if sol is None or ev[1] or ev[2]:
        return {'archivo':inp.name,'status':'NO_RESUELTO','pieces':len(pieces),'collapsed_internal':collapsed,'conflicts':ev[1],'border_conflicts':ev[2],'min_gap_mm':ev[3],'attempts':attempts,'repair':repair_meta,'pairRepair':pair_meta,'seconds':round(time.time()-t0,3),'engineVersion':'V1.5'}

    out=outdir/(inp.stem+'__POLIFAN_OK.svg')
    meta={'engine':'Motor Polifan Definitivo V1.5','source':inp.name,'plate_mm':[core.PLATE_W,core.PLATE_H],'target_gap_used_mm':used,'scale':'1:1','piece_count':len(pieces),'collapsed_internal_details':collapsed}
    ok,val=_export_validate(defs,sol,out,meta,len(pieces))

    # Si el raster final detecta un conflicto, ahora sabemos exactamente que par es.
    export_repairs=[]
    for guard_round in range(3):
        if ok or val.get('border_conflicts',0): break
        rpairs=val.get('conflict_pairs') or []
        if not rpairs: break
        hints=[(int(p['a']),int(p['b'])) for p in rpairs[:2]]
        # 4 mm vectoriales dan margen frente a cuantizacion de 0,5 mm/pixel.
        sol2,ev2,meta_rep=repair_last_pair(sol,4.0,seconds=14.0,pair_hints=hints)
        export_repairs.append({'round':guard_round+1,'pairs':rpairs[:2],'repair':meta_rep,'eval':ev2})
        if ev2[2]: break
        sol=sol2
        ok,val=_export_validate(defs,sol,out,meta,len(pieces))

    status='CERTIFICADO' if ok else 'EXPORT_RECHAZADO'
    return {'archivo':inp.name,'status':status,'pieces':len(pieces),'collapsed_internal':collapsed,'search_gap_used_mm':used,'search_min_gap_mm':ev[3],'validation':val,'output':str(out),'attempts':attempts,'repair':repair_meta,'pairRepair':pair_meta,'exportRepairs':export_repairs,'seconds':round(time.time()-t0,3),'engineVersion':'V1.5'}


def solve_svg_text(svg_text:str,filename:str='placa.svg',seconds3:float=8.,seconds25:float=14.):
    with tempfile.TemporaryDirectory(prefix='polifan_def_') as td:
        base=Path(td); safe=Path(filename or 'placa.svg').name
        if not safe.lower().endswith('.svg'): safe+='.svg'
        inp=base/safe; outdir=base/'out'; outdir.mkdir(); inp.write_text(svg_text,encoding='utf-8')
        result=solve_file(inp,outdir,seconds3,seconds25); txt=None; path=result.get('output')
        if path and Path(path).exists(): txt=Path(path).read_text(encoding='utf-8')
        result=dict(result); result.pop('output',None); result['svgText']=txt
        result['engineVersion']='V1.5'; result['certificationStrategy']='adaptive_2ppm_exact_raster_pair_repair'
        return result
