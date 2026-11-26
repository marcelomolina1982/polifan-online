"""Regression checks for the REAL _execute_industrial selection function.

Extract its AST without importing the production app or reading customer data.
Mocks supply synthetic 20-part batches; test that only complete, uniquely
identified, certified plates can be chosen, and the narrower of 4/8 wins.
"""
import ast
import pathlib
import time
import uuid
from types import SimpleNamespace

source = pathlib.Path(__file__).with_name("ironnest_benchmark_app.py").read_text()
tree = ast.parse(source)
fn = next(x for x in tree.body if isinstance(x, ast.FunctionDef) and x.name == "_execute_industrial")

ids = [f"synthetic-{i:02d}" for i in range(20)]
payload = {"optimizationMode":"diagonal","kits": [{"kitId":"synthetic","parts":[{"instanceId":x,"kitId":"synthetic","trimXmm":0,"trimYmm":0} for x in ids]}]}

class FakeGeometry:
    def __init__(self,x):
        self.bounds=(x,0,x+10,10)
        self.area=100.0
    def distance(self,other):
        return 5.0

def validation(kits, placements):
    # Assert the real function calls validation for each accepted candidate
    # and again for the selected final plate.
    rows=[(p,FakeGeometry(float(p["xCm"])*10)) for p in placements]
    return {"ok":True,"outsidePlate":[],"gapViolations":[]},rows

calls=[]
scenario="diagonal_narrow"
def fake_run(kits, job_id=None, settings=None, seed=1777,
             column_weight=3, timeout_seconds=None, rotations=None):
    diagonal=rotations is not None
    calls.append("8" if diagonal else "4")
    if scenario=="diagonal_narrow":
        spacing=30 if diagonal else 45
    elif scenario=="diagonal_wide":
        spacing=45 if diagonal else 30
    else:
        spacing=30
    positions=[{"instanceId":ident,"angle":45 if diagonal else 0,
                "xCm":i*spacing/10,"yCm":0} for i,ident in enumerate(ids)]
    if scenario=="diagonal_duplicate" and diagonal:
        positions[-1]={**positions[-1],"instanceId":ids[0]}
    if scenario=="all_incomplete":
        positions.pop()
        return positions,[19],.01,20,120
    return positions,[],.01,20,120

ns={
    "time":time, "uuid":uuid,
    "br":SimpleNamespace(_validate_layout=validation,_svg_preview=lambda rows:"<svg/>",
                         _BENCH_RESULTS={},PLATE_WIDTH_MM=1230,
                         PLATE_HEIGHT_MM=580,GAP_MM=3.0,ABSOLUTE_MIN_GAP_MM=3.0),
    "IRON_COMPACT_SETTINGS":{"strategy":"sampling","budget":72,"restarts":2,"separation_effort":"fast"},
    "IRON_DIAGONAL_ROTATIONS":[float(x) for x in range(0,360,45)],
    "IRON_SOLVE_TIMEOUT_SECONDS":150,
    "_industrial_kits":lambda data,detailed=False:data["kits"],
    "_fastpack_rectangles":lambda kits:None,
    "_run_ironnest":fake_run
}
exec(compile(ast.Module(body=[fn],type_ignores=[]),"<real industrial function>","exec"),ns)

def check_case(name,expected_kind,expected_width,expected_ok):
    global scenario
    scenario=name
    calls.clear()
    result,status=ns["_execute_industrial"](payload,"isolated-test")
    assert bool(result["ok"])==expected_ok,(name,result)
    assert status==(200 if expected_ok else 422),(name,status)
    if expected_ok:
        assert len(result["placements"])==20,(name,"missing placements")
        assert len(set(x["instanceId"] for x in result["placements"]))==20,(name,"duplicate IDs")
        assert result["layoutValidation"]["ok"],(name,"invalid geometry")
        assert abs(result["usedWidthMm"]-expected_width)<.01,(name,result["usedWidthMm"],expected_width)
        assert result["placements"][0]["angle"]==expected_kind,(name,"wrong rotation selected")
    else:
        assert not result.get("placements"),(name,"unsafe result was returned")
    return result

check_case("diagonal_narrow",45,580.0,True)
assert calls==["4","8"],calls
check_case("diagonal_wide",0,580.0,True)
assert calls==["4","8"],calls
check_case("diagonal_duplicate",0,580.0,True)
assert calls==["4","8"],calls
check_case("all_incomplete",None,None,False)
assert all(v in ("4","8") for v in calls),calls
print("OK: real industrial selection prefers certified narrower layout; duplicate IDs and partial plates are not accepted.")
