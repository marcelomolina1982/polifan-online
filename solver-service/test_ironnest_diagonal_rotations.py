"""Run opt-in diagonal-rotation checks without importing the live service.

This fixture extracts the real worker functions from ironnest_benchmark_app.py,
runs them with an in-memory fake multiprocessing context, and asserts that the
existing four-rotation default remains unchanged. It never uses the network,
Supabase, or any customer's SVG.
"""
import ast
import pathlib
import queue
import re
import time
from types import SimpleNamespace

src = pathlib.Path(__file__).with_name("ironnest_benchmark_app.py").read_text()
tree = ast.parse(src)
funcs = {n.name: n for n in tree.body if isinstance(n, ast.FunctionDef)}
assert "_run_ironnest" in funcs and "_solve_process" in funcs
assert "_execute_industrial" in funcs
assert "if mode not in ('fast','compact','diagonal'):" in src
assert "if mode=='diagonal':" in src
assert "attempts.append((2713,2,settings,IRON_DIAGONAL_ROTATIONS))" in src
assert "rotations=angle_override" in src
assert "score=(used_width,used_height,e)" in src
assert "if best is None or score<best[0]: best=(score,p,u,e,n,v)" in src
assert "br._validate_layout(detailed_try,p)" in src
assert "fast_placements=_fastpack_rectangles(kits) if mode=='fast' else None" in src
assert "br._validate_layout(detailed_try,p)" in src
assert "gap<br.ABSOLUTE_MIN_GAP_MM-0.000001" in src
assert "IRON_SOLVER_GAP_MM=br.GAP_MM+1.5" in src

rotations = []
def fake_nest(items, **kw):
    rotations.append(kw["rotations"])
    return ([(i,0,0,0) for i in range(len(items))], [])

class FakeProcess:
    exitcode = 0
    def __init__(self,target,args): self.target, self.args = target,args
    def start(self): self.target(*self.args)
    def join(self,timeout=None): pass
    def is_alive(self): return False
    def kill(self): pass
    def terminate(self): pass

class FakeQueue:
    def __init__(self,maxsize=1): self.q=queue.Queue(maxsize=maxsize)
    def put(self,v): self.q.put(v)
    def get(self,timeout=None): return self.q.get(timeout=timeout)
    def close(self): pass
    def cancel_join_thread(self): pass

ctx = SimpleNamespace(Process=FakeProcess,Queue=FakeQueue)
ns = dict(
    multiprocessing=SimpleNamespace(get_context=lambda mode:ctx),
    ironnest=SimpleNamespace(nest=fake_nest),
    br=SimpleNamespace(PLATE_WIDTH_MM=1230, PLATE_HEIGHT_MM=580),
    time=time, queue=queue,
    IRON_ROTATIONS=[0.0,90.0,180.0,270.0],
    IRON_EXTRA_ROTATIONS=[0.0,90.0,180.0,270.0],
    IRON_EXTRA_ROTATION_ITEMS=(),
    IRON_DIAGONAL_ROTATIONS=[float(i) for i in range(0,360,45)],
    IRON_BUDGET=24, IRON_RESTARTS=1,
    IRON_SEPARATION_EFFORT="fast", IRON_STRATEGY="sampling",
    IRON_SIMPLIFY_MM=.6, IRON_SOLVER_GAP_MM=4.5,
    IRON_SOLVE_TIMEOUT_SECONDS=150,
    _outline=lambda geom:geom
)
module = ast.Module(body=[funcs["_solve_process"],funcs["_run_ironnest"]],type_ignores=[])
exec(compile(module,"<isolated exact functions>","exec"),ns)
pieces=[{"geom":[(0,0),(10,0),(10,10)],"instanceId":"normal"},
        {"geom":[(0,0),(10,0),(10,10)],"instanceId":"locked","allowRotate":False}]
kits=[{"parts":pieces}]
default=ns["_run_ironnest"](kits,job_id="synthetic-default")
assert default[3]==2 and default[1]==[]
assert rotations[-1]==[[0.0,90.0,180.0,270.0],[0.0]]
diagonal=ns["_run_ironnest"](
    kits,job_id="synthetic-diagonal",rotations=ns["IRON_DIAGONAL_ROTATIONS"])
assert diagonal[3]==2 and diagonal[1]==[]
assert rotations[-1]==[[0.,45.,90.,135.,180.,225.,270.,315.],[0.0]]
assert ns["IRON_BUDGET"]==24 and ns["IRON_RESTARTS"]==1
print("OK: 4-angle mode unchanged; optional 8-angle solver available; opt-in compares certified widths and retains the best")
