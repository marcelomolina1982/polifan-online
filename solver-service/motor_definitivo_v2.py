from __future__ import annotations
from pathlib import Path
import math, tempfile, time
from shapely import affinity
import motor_definitivo_v1 as core


def _conflict_pairs(pieces, gap):
    out=[]
    for i,a in enumerate(pieces):
        for j in range(i+1,len(pieces)):
            d=a.geom.distance(pieces[j].geom)
            if d < gap-1e-9:
                out.append((d,i,j))
    return sorted(out)


def _move_piece(state, idx, dx, dy, ang):
    out=[p.clone() for p in state]
    old=out[idx]
    q=old.clone(); c=q.geom.centroid
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


def repair_single_conflict(pieces, gap, seconds=6.0):
    """LNS final: sólo mueve el par implicado cuando queda 1 conflicto y 0 bordes."""
    start=time.time()
    best=[p.clone() for p in pieces]
    best_ev=core.evaluate(best,gap)
    pairs=_conflict_pairs(best,gap)
    if len(pairs)!=1 or best_ev[2]!=0:
        return best,best_ev,{'used':False,'reason':'not_single_conflict'}

    _,ia,ib=pairs[0]
    beam=[best]
    radii=(0.35,0.6,0.9,1.2,1.6,2.2,3.0,4.0,5.5,7.0,9.0)
    angles=(0.0,-0.25,0.25,-0.5,0.5,-1.0,1.0,-2.0,2.0)
    dirs=tuple(math.radians(a) for a in range(0,360,30))
    seen=set(); rounds=0; tested=0

    while beam and time.time()-start < seconds and rounds < 3:
        rounds+=1; candidates=[]
        for state in beam:
            # Recalcular el conflicto por si cambió después de una mejora parcial.
            ps=_conflict_pairs(state,gap)
            movers={ia,ib}
            if ps:
                movers.update((ps[0][1],ps[0][2]))
            for idx in movers:
                for r in radii:
                    for th in dirs:
                        dx=r*math.cos(th);dy=r*math.sin(th)
                        for ang in angles:
                            if time.time()-start >= seconds: break
                            key=(idx,round(dx,3),round(dy,3),ang,round(state[idx].geom.centroid.x,2),round(state[idx].geom.centroid.y,2))
                            if key in seen: continue
                            seen.add(key); tested+=1
                            cand=_move_piece(state,idx,dx,dy,ang)
                            ev=core.evaluate(cand,gap)
                            if ev[2]: continue
                            if ev[1]==0:
                                return cand,ev,{'used':True,'solved':True,'tested':tested,'rounds':rounds,'seconds':round(time.time()-start,3)}
                            candidates.append((ev[1],ev[0],-(ev[3] or 0.0),cand,ev))
        if not candidates: break
        candidates.sort(key=lambda x:(x[0],x[1],x[2]))
        beam=[x[3] for x in candidates[:10]]
        if (candidates[0][0],candidates[0][1]) < (best_ev[1],best_ev[0]):
            best,best_ev=candidates[0][3],candidates[0][4]

    return best,best_ev,{'used':True,'solved':best_ev[1]==0 and best_ev[2]==0,'tested':tested,'rounds':rounds,'seconds':round(time.time()-start,3)}


def solve_file(inp,outdir,seconds3=8.,seconds25=14.):
    t0=time.time();root,defs,pieces,collapsed=core.extract(inp,1.0)
    if not pieces:
        return {'archivo':inp.name,'status':'SIN_GEOMETRIA','seconds':round(time.time()-t0,3)}
    base=core.compact_seed(pieces);attempts=[]

    def try_gap(final_gap,seconds):
        gap=final_gap+core.SEARCH_SAFETY;ev=core.evaluate(base,gap)
        if ev[1]==0 and ev[2]==0:return [p.clone() for p in base],ev
        best=None;best_ev=ev;per=max(.5,seconds/4)
        for s in (17,43,101,211):
            cand,cev,meta=core.anneal(base,gap,per,s);attempts.append({'gap':final_gap,'eval':cev,'meta':meta})
            if (cev[1]+cev[2],cev[0])<(best_ev[1]+best_ev[2],best_ev[0]):best,best_ev=cand,cev
            if cev[1]==0 and cev[2]==0:return cand,cev
        return best,best_ev

    sol,ev=try_gap(core.PREFERRED_GAP,seconds3);used=core.PREFERRED_GAP
    if sol is None or ev[1] or ev[2]:
        sol,ev=try_gap(core.MIN_GAP,seconds25);used=core.MIN_GAP

    # Revolución local: si sólo queda un conflicto y ningún borde, congelar el resto.
    repair_meta=None
    if sol is not None and ev[1]==1 and ev[2]==0:
        sol2,ev2,repair_meta=repair_single_conflict(sol,core.MIN_GAP+core.SEARCH_SAFETY,seconds=7.0)
        attempts.append({'gap':core.MIN_GAP,'repair_single_conflict':repair_meta,'eval':ev2})
        if (ev2[1]+ev2[2],ev2[0]) < (ev[1]+ev[2],ev[0]) or (ev2[1]==0 and ev2[2]==0):
            sol,ev=sol2,ev2

    if sol is None or ev[1] or ev[2]:
        return {'archivo':inp.name,'status':'NO_RESUELTO','pieces':len(pieces),'collapsed_internal':collapsed,'conflicts':ev[1],'border_conflicts':ev[2],'min_gap_mm':ev[3],'attempts':attempts,'repair':repair_meta,'seconds':round(time.time()-t0,3)}

    out=outdir/(inp.stem+'__POLIFAN_OK.svg')
    core.export(defs,sol,out,{'engine':'Motor Polifan Definitivo V1.2','source':inp.name,'plate_mm':[core.PLATE_W,core.PLATE_H],'target_gap_used_mm':used,'scale':'1:1','piece_count':len(pieces),'collapsed_internal_details':collapsed})
    val=core.validate(out,4.0)
    status='CERTIFICADO' if val['valid'] and val['piece_count']==len(pieces) else 'EXPORT_RECHAZADO'
    return {'archivo':inp.name,'status':status,'pieces':len(pieces),'collapsed_internal':collapsed,'search_gap_used_mm':used,'search_min_gap_mm':ev[3],'validation':val,'output':str(out),'attempts':attempts,'repair':repair_meta,'seconds':round(time.time()-t0,3)}


def solve_svg_text(svg_text:str,filename:str='placa.svg',seconds3:float=8.,seconds25:float=14.):
    with tempfile.TemporaryDirectory(prefix='polifan_def_') as td:
        base=Path(td);safe=Path(filename or 'placa.svg').name
        if not safe.lower().endswith('.svg'):safe+='.svg'
        inp=base/safe;outdir=base/'out';outdir.mkdir();inp.write_text(svg_text,encoding='utf-8')
        result=solve_file(inp,outdir,seconds3,seconds25);txt=None;path=result.get('output')
        if path and Path(path).exists():txt=Path(path).read_text(encoding='utf-8')
        result=dict(result);result.pop('output',None);result['svgText']=txt;return result
