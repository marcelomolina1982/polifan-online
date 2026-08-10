from __future__ import annotations
from pathlib import Path
import math, tempfile, time
from shapely import affinity
import motor_definitivo_v1 as core
import motor_definitivo_v3 as v3  # activa validacion adaptativa 2 ppm


def _pairs(pieces, gap):
    out=[]
    for i,a in enumerate(pieces):
        for j in range(i+1,len(pieces)):
            d=a.geom.distance(pieces[j].geom)
            if d < gap-1e-9:
                out.append((d,i,j))
    return sorted(out)


def _move(state, idx, dx, dy, ang):
    out=[p.clone() for p in state]
    q=out[idx].clone(); c=q.geom.centroid
    M=core.np.eye(3)
    if ang:
        q.geom=affinity.rotate(q.geom,ang,origin=(c.x,c.y))
        M=core.T_rotate(ang,c.x,c.y)@M
    if dx or dy:
        q.geom=affinity.translate(q.geom,dx,dy)
        M=core.T_translate(dx,dy)@M
    q.matrix=M@q.matrix
    out[idx]=core.project_inside(q)
    return out


def _score(ev):
    # Primero seguridad geometrica; despues penalidad y finalmente mayor distancia minima.
    return (ev[1]+ev[2], ev[1], ev[2], ev[0], -(ev[3] or 0.0))


def repair_residual(pieces, gap, seconds=12.0, max_pairs=6):
    """LNS focalizado para 1..max_pairs conflictos, congelando el resto de la placa."""
    start=time.time(); best=[p.clone() for p in pieces]; best_ev=core.evaluate(best,gap)
    initial=_pairs(best,gap)
    if best_ev[2] or not initial or len(initial)>max_pairs:
        return best,best_ev,{'used':False,'reason':'outside_scope','pairs':len(initial)}

    beam=[best]; seen=set(); tested=0; rounds=0
    radii=(0.35,0.6,0.9,1.25,1.7,2.3,3.1,4.2,5.7,7.5,10.0,13.0)
    angles=(0.0,-0.25,0.25,-0.5,0.5,-1.0,1.0,-1.5,1.5,-2.5,2.5,-4.0,4.0)
    dirs=tuple(math.radians(a) for a in range(0,360,30))

    while beam and time.time()-start < seconds and rounds < 5:
        rounds+=1; candidates=[]
        for state in beam:
            ps=_pairs(state,gap)
            if not ps:
                ev=core.evaluate(state,gap)
                return state,ev,{'used':True,'solved':True,'tested':tested,'rounds':rounds,'seconds':round(time.time()-start,3)}
            active=set()
            for _,i,j in ps[:max_pairs]: active.update((i,j))

            # Movimientos individuales sobre las unicas piezas implicadas.
            for idx in active:
                c0=state[idx].geom.centroid
                for r in radii:
                    for th in dirs:
                        dx=r*math.cos(th); dy=r*math.sin(th)
                        for ang in angles:
                            if time.time()-start >= seconds: break
                            key=(idx,round(c0.x,1),round(c0.y,1),round(dx,2),round(dy,2),ang)
                            if key in seen: continue
                            seen.add(key); tested+=1
                            cand=_move(state,idx,dx,dy,ang)
                            ev=core.evaluate(cand,gap)
                            if ev[2]: continue
                            if ev[1]==0:
                                return cand,ev,{'used':True,'solved':True,'tested':tested,'rounds':rounds,'seconds':round(time.time()-start,3)}
                            candidates.append((_score(ev),cand,ev))

            # Empuje coordinado del peor par: abre espacio sin desplazar toda la composicion.
            if ps:
                _,ia,ib=ps[0]
                ca=state[ia].geom.centroid; cb=state[ib].geom.centroid
                vx=ca.x-cb.x; vy=ca.y-cb.y; L=math.hypot(vx,vy) or 1.0
                ux,uy=vx/L,vy/L
                for r in (0.5,1.0,1.5,2.0,3.0,4.5,6.0,8.0):
                    if time.time()-start >= seconds: break
                    cand=_move(state,ia,ux*r,uy*r,0.0)
                    cand=_move(cand,ib,-ux*r,-uy*r,0.0)
                    tested+=1; ev=core.evaluate(cand,gap)
                    if ev[2]: continue
                    if ev[1]==0:
                        return cand,ev,{'used':True,'solved':True,'tested':tested,'rounds':rounds,'seconds':round(time.time()-start,3),'coordinated':True}
                    candidates.append((_score(ev),cand,ev))

        if not candidates: break
        candidates.sort(key=lambda x:x[0])
        beam=[x[1] for x in candidates[:14]]
        if candidates[0][0] < _score(best_ev):
            best,best_ev=candidates[0][1],candidates[0][2]

    return best,best_ev,{'used':True,'solved':best_ev[1]==0 and best_ev[2]==0,'tested':tested,'rounds':rounds,'seconds':round(time.time()-start,3),'pairs_initial':len(initial)}


def _export_and_validate(defs,sol,out,meta,expected):
    core.export(defs,sol,out,meta)
    val=core.validate(out,2.0)
    ok=val['valid'] and val['piece_count']==expected
    return ok,val


def solve_file(inp,outdir,seconds3=8.,seconds25=14.):
    t0=time.time(); root,defs,pieces,collapsed=core.extract(inp,1.0)
    if not pieces:
        return {'archivo':inp.name,'status':'SIN_GEOMETRIA','seconds':round(time.time()-t0,3)}
    base=core.compact_seed(pieces); attempts=[]

    def try_gap(final_gap,seconds):
        gap=final_gap+core.SEARCH_SAFETY; ev=core.evaluate(base,gap)
        if ev[1]==0 and ev[2]==0:return [p.clone() for p in base],ev
        best=None; best_ev=ev; per=max(.5,seconds/4)
        for s in (17,43,101,211):
            cand,cev,meta=core.anneal(base,gap,per,s)
            attempts.append({'gap':final_gap,'eval':cev,'meta':meta})
            if _score(cev)<_score(best_ev): best,best_ev=cand,cev
            if cev[1]==0 and cev[2]==0:return cand,cev
        return best,best_ev

    sol,ev=try_gap(core.PREFERRED_GAP,seconds3); used=core.PREFERRED_GAP
    if sol is None or ev[1] or ev[2]:
        sol,ev=try_gap(core.MIN_GAP,seconds25); used=core.MIN_GAP

    # V1.4: reparar hasta 2 conflictos de busqueda (admite hasta 6 en guardia).
    repair_meta=None
    if sol is not None and ev[2]==0 and 1 <= ev[1] <= 2:
        sol2,ev2,repair_meta=repair_residual(sol,core.MIN_GAP+core.SEARCH_SAFETY,seconds=12.0,max_pairs=2)
        attempts.append({'gap':core.MIN_GAP,'repair_residual':repair_meta,'eval':ev2})
        if _score(ev2)<_score(ev) or (ev2[1]==0 and ev2[2]==0): sol,ev=sol2,ev2

    if sol is None or ev[1] or ev[2]:
        return {'archivo':inp.name,'status':'NO_RESUELTO','pieces':len(pieces),'collapsed_internal':collapsed,'conflicts':ev[1],'border_conflicts':ev[2],'min_gap_mm':ev[3],'attempts':attempts,'repair':repair_meta,'seconds':round(time.time()-t0,3),'engineVersion':'V1.4'}

    out=outdir/(inp.stem+'__POLIFAN_OK.svg')
    meta={'engine':'Motor Polifan Definitivo V1.4','source':inp.name,'plate_mm':[core.PLATE_W,core.PLATE_H],'target_gap_used_mm':used,'scale':'1:1','piece_count':len(pieces),'collapsed_internal_details':collapsed}
    ok,val=_export_and_validate(defs,sol,out,meta,len(pieces))

    # Guardia de exportacion: si rasterizar revela clearance insuficiente, abrir espacio local
    # con un objetivo geometrico mas conservador antes de volver a certificar.
    export_repair=None
    if not ok and val.get('border_conflicts',0)==0:
        guard_gap=core.MIN_GAP+1.25  # 3.75 mm internos para absorber cuantizacion raster
        sol2,ev2,export_repair=repair_residual(sol,guard_gap,seconds=14.0,max_pairs=6)
        attempts.append({'export_guard_gap':guard_gap,'repair':export_repair,'eval':ev2})
        if ev2[1]==0 and ev2[2]==0:
            sol=sol2
            ok,val=_export_and_validate(defs,sol,out,meta,len(pieces))

    status='CERTIFICADO' if ok else 'EXPORT_RECHAZADO'
    return {'archivo':inp.name,'status':status,'pieces':len(pieces),'collapsed_internal':collapsed,'search_gap_used_mm':used,'search_min_gap_mm':ev[3],'validation':val,'output':str(out),'attempts':attempts,'repair':repair_meta,'exportRepair':export_repair,'seconds':round(time.time()-t0,3),'engineVersion':'V1.4'}


def solve_svg_text(svg_text:str,filename:str='placa.svg',seconds3:float=8.,seconds25:float=14.):
    with tempfile.TemporaryDirectory(prefix='polifan_def_') as td:
        base=Path(td); safe=Path(filename or 'placa.svg').name
        if not safe.lower().endswith('.svg'): safe+='.svg'
        inp=base/safe; outdir=base/'out'; outdir.mkdir(); inp.write_text(svg_text,encoding='utf-8')
        result=solve_file(inp,outdir,seconds3,seconds25); txt=None; path=result.get('output')
        if path and Path(path).exists(): txt=Path(path).read_text(encoding='utf-8')
        result=dict(result); result.pop('output',None); result['svgText']=txt
        result['engineVersion']='V1.4'; result['certificationStrategy']='adaptive_2ppm_plus_export_guard'
        return result
