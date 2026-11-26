"""Real IronNest 0/90/180/270 vs 45-degree rotation benchmark.

No Supabase, Render, customer SVG, or network calls. Shapes are synthetic;
the production dense-SVG geometry validator is NOT replaced by this benchmark.
"""
import json, multiprocessing, queue, time
from shapely.geometry import Polygon
import ironnest

PLATE_W=1230
PLATE_H=580
GAP=4.5
FOUR=[0.,90.,180.,270.]
EIGHT=[float(i) for i in range(0,360,45)]

def fixture_shapes():
    # 10 synthetic base/cap pairs with mildly concave outlines, similar in
    # complexity (not contours) to actual XPS business pieces.
    items=[]
    for i in range(10):
        w=190+(i%4)*18
        h=88+(i%3)*14
        if i%3==0:
            poly=[(0,0),(w,0),(w,h),(w*.65,h),(w*.57,h*.72),
                  (w*.38,h*.72),(w*.33,h),(0,h)]
        elif i%3==1:
            poly=[(0,0),(w*.58,0),(w,.28*h),(w,h),
                  (w*.32,h),(0,.65*h)]
        else:
            poly=[(0,0),(w,0),(w,h*.73),(w*.8,h),
                  (w*.2,h),(0,h*.73)]
        assert Polygon(poly).is_valid
        items.extend([poly,poly])
    return items

def worker(shapes,rotations,q):
    try:
        start=time.perf_counter()
        placements,unplaced=ironnest.nest(
            shapes,qty=[1]*len(shapes),
            container=[(.7,.7),(PLATE_W-.7,.7),
                       (PLATE_W-.7,PLATE_H-.7),(.7,PLATE_H-.7)],
            holes=[],min_sep=GAP,rotations=[rotations]*len(shapes),
            seed=1777,budget=24,strategy='sampling',column_weight=3,
            restarts=1,separation_effort='fast'
        )
        seconds=round(time.perf_counter()-start,2)
        q.put(dict(ok=True,seconds=seconds,placed=len(placements),
                   missing=len(unplaced),
                   angles=sorted(set(round(float(p[3]),4) for p in placements))))
    except BaseException as e:
        q.put(dict(ok=False,error=repr(e)))

def run_mode(label,angles,timeout=95):
    ctx=multiprocessing.get_context('spawn')
    q=ctx.Queue(maxsize=1)
    job=ctx.Process(target=worker,args=(fixture_shapes(),angles,q))
    started=time.monotonic()
    job.start()
    job.join(timeout)
    if job.is_alive():
        job.terminate()
        job.join(3)
        if job.is_alive():job.kill();job.join(3)
        result=dict(ok=False,timeout=True,seconds=round(time.monotonic()-started,2))
    else:
        try:result=q.get(timeout=2)
        except queue.Empty:result=dict(ok=False,error=f'No response; exit={job.exitcode}')
    q.close()
    result.update(mode=label,allowed_angles=angles,parts=20)
    return result

if __name__=='__main__':
    import pathlib
    result=[run_mode('4 angles',FOUR),run_mode('8 angles',EIGHT)]
    assert result[0]['allowed_angles']==FOUR
    assert result[1]['allowed_angles']==EIGHT
    assert all(x.get('ok') and x.get('placed',0)+x.get('missing',0)==20 for x in result),result
    output={'fixture':'20 synthetic pieces, 10 complete 2-part kits',
            'min_separation_search_mm':GAP,'plate_mm':[PLATE_W,PLATE_H],
            'runs':result,
            'caveat':'Synthetic only. Real production certification requires detailed SVG geometry.'}
    print('IRONNEST_ANGLE_BENCHMARK='+json.dumps(output,ensure_ascii=False))
