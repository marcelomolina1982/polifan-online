from __future__ import annotations
import math, random, time
import motor_definitivo_v1 as core
import motor_definitivo_v5 as v5

_ORIGINAL_LAST_PAIR = v5.repair_last_pair


def _deep_last_pair(pieces, gap, seconds=18.0, pair_hints=None):
    """Rescate V1.6: solo se usa cuando V1.5 deja un unico conflicto.

    Primero conserva el reparador V1.5. Si no alcanza, congela el resto de la
    placa y hace una busqueda local mas profunda sobre el par conflictivo,
    permitiendo pasos tangenciales y rotaciones finas mas amplias sin aceptar
    borde ni crear mas conflictos que el estado de partida.
    """
    start=time.time()
    base=[p.clone() for p in pieces]
    base_ev=core.evaluate(base,gap)

    first_budget=min(max(4.0,seconds*0.35),10.0)
    cand,cev,meta0=_ORIGINAL_LAST_PAIR(base,gap,seconds=first_budget,pair_hints=pair_hints)
    if cev[1]==0 and cev[2]==0:
        meta0=dict(meta0); meta0['v16']=False
        return cand,cev,meta0

    best=[p.clone() for p in cand]
    best_ev=cev
    remaining=max(10.0,seconds-first_budget)
    deadline=time.time()+remaining
    rng=random.Random(160613)
    beam=[best]
    tested=0
    rounds=0

    def score(ev):
        return (ev[2],ev[1],ev[0],-(ev[3] or 0.0))

    while beam and time.time()<deadline and rounds<12:
        rounds+=1
        pool=[]
        for state in beam:
            ps=v5._pairs(state,gap)
            hints=[]
            if pair_hints:
                for ia,ib in pair_hints:
                    if 0<=ia<len(state) and 0<=ib<len(state) and ia!=ib:
                        hints.append((state[ia].geom.distance(state[ib].geom),ia,ib))
            work=(hints+ps)[:3]
            if not work:
                ev=core.evaluate(state,gap)
                if ev[1]==0 and ev[2]==0:
                    return state,ev,{'used':True,'solved':True,'v16':True,'mode':'deep_pair','tested':tested,'rounds':rounds,'seconds':round(time.time()-start,3)}
                continue

            for d,ia,ib in work:
                ux,uy=v5._pair_direction(state,ia,ib)
                tx,ty=-uy,ux
                need=max(0.35,gap-d+0.45)

                # Barrido determinista amplio: permite sacar una pieza de un callejon.
                for sep_mul in (0.7,1.0,1.35,1.8,2.4,3.2,4.2,5.5,7.0):
                    sep=need*sep_mul
                    for tan_mul in (0,-0.5,0.5,-1,1,-2,2,-4,4,-7,7,-11,11):
                        tangent=need*tan_mul
                        for ang in (0,-0.25,0.25,-0.5,0.5,-1,1,-2,2,-3.5,3.5,-5,5,-7.5,7.5,-10,10):
                            if time.time()>=deadline: break
                            # Mover cada una por separado. La otra queda completamente congelada.
                            for idx,sgn in ((ia,-1.0),(ib,1.0)):
                                a=ang if idx==ia else -ang
                                nxt=v5._move(state,idx,sgn*ux*sep+tx*tangent,sgn*uy*sep+ty*tangent,a)
                                tested+=1
                                ev=core.evaluate(nxt,gap)
                                if ev[2]:
                                    continue
                                if ev[1]==0:
                                    return nxt,ev,{'used':True,'solved':True,'v16':True,'mode':'deep_single','tested':tested,'rounds':rounds,'seconds':round(time.time()-start,3)}
                                if ev[1] <= max(1,base_ev[1]):
                                    pool.append((score(ev),nxt,ev))

                # Exploracion aleatoria fina alrededor de los mejores estados.
                for _ in range(450):
                    if time.time()>=deadline: break
                    idx=ia if rng.random()<0.5 else ib
                    sgn=-1.0 if idx==ia else 1.0
                    sep=need*rng.uniform(0.5,8.0)
                    tangent=need*rng.uniform(-12.0,12.0)
                    ang=rng.uniform(-12.0,12.0)
                    nxt=v5._move(state,idx,sgn*ux*sep+tx*tangent,sgn*uy*sep+ty*tangent,ang)
                    tested+=1
                    ev=core.evaluate(nxt,gap)
                    if ev[2]:
                        continue
                    if ev[1]==0:
                        return nxt,ev,{'used':True,'solved':True,'v16':True,'mode':'deep_random','tested':tested,'rounds':rounds,'seconds':round(time.time()-start,3)}
                    if ev[1] <= max(1,base_ev[1]):
                        pool.append((score(ev),nxt,ev))

        if not pool:
            break
        pool.sort(key=lambda x:x[0])
        beam=[x[1] for x in pool[:28]]
        if score(pool[0][2]) < score(best_ev):
            best,best_ev=pool[0][1],pool[0][2]

    return best,best_ev,{'used':True,'solved':best_ev[1]==0 and best_ev[2]==0,'v16':True,'mode':'deep_exhausted','tested':tested,'rounds':rounds,'seconds':round(time.time()-start,3)}


# V1.5 consulta su funcion global en tiempo de ejecucion. Sustituimos solo el
# rescate del ultimo par; todo el resto del solver queda identico.
v5.repair_last_pair = _deep_last_pair


def solve_svg_text(svg_text:str,filename:str='placa.svg',seconds3:float=8.,seconds25:float=14.):
    result=v5.solve_svg_text(svg_text,filename,seconds3,seconds25)
    result=dict(result)
    result['engineVersion']='V1.6'
    result['certificationStrategy']='v15_plus_deep_single_conflict_rescue'
    return result
