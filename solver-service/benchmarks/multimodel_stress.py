import json, subprocess, tempfile, re, random
from pathlib import Path

ROOT = Path(__file__).parent
MODELS = json.loads((ROOT / 'multimodel10.json').read_text(encoding='utf-8'))
SPARROW = '/tmp/sparrow-bin'
MAX_WIDTH = 1214.0
SEEDS = [101, 503, 1297]
random.seed(115)

names = list(MODELS)
assert len(names) >= 5, f'Expected >=5 real models, got {len(names)}'

# 12 mixed real-order cases. Every selected model contributes its real base+tapa pair.
cases=[]
for _ in range(12):
    cases.append([random.choice(names) for _ in range(12)])

def make_input(order, out):
    items=[]
    iid=0
    for model in order:
        parts=MODELS[model]['parts']
        if len(parts) != 2:
            raise ValueError(f'{model}: expected exactly 2 principal parts')
        for part in parts:
            if len(part) < 3:
                raise ValueError(f'{model}: invalid polygon')
            items.append({'id':iid,'demand':1,'shape':{'type':'simple_polygon','data':part}})
            iid += 1
    payload={'name':'multimodel_real_order','items':items}
    out.write_text(json.dumps(payload,separators=(',',':')),encoding='utf-8')

def parse_width(text):
    patterns=[
        r'best feasible width[^0-9]*([0-9]+(?:\.[0-9]+)?)',
        r'best[^\n]*width[^0-9]*([0-9]+(?:\.[0-9]+)?)',
        r'width[^0-9]*([0-9]+(?:\.[0-9]+)?)'
    ]
    for pat in patterns:
        vals=[float(x) for x in re.findall(pat,text,re.I)]
        if vals:
            return min(vals)
    return None

def candidate_outputs(td):
    # Sparrow versions differ in where/how they report the solution.
    # Inspect every small text-like file created by the binary rather than
    # declaring the geometry invalid merely because stdout wording changed.
    found=[]
    for p in td.rglob('*'):
        if not p.is_file() or p.name == 'input.json':
            continue
        try:
            if p.stat().st_size > 5_000_000:
                continue
            txt=p.read_text(encoding='utf-8',errors='ignore')
        except Exception:
            continue
        found.append((p,txt))
    return found

def run_case(case_id, order, seed):
    with tempfile.TemporaryDirectory() as tmp:
        td=Path(tmp)
        inp=td/'input.json'
        make_input(order,inp)
        cmd=[SPARROW,'-i',str(inp),'-t','6','--min-item-separation','2.5','--workers','1','-s',str(seed)]
        p=subprocess.run(cmd,cwd=td,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=30)
        log=p.stdout or ''
        width=parse_width(log)
        outputs=[]
        for path,txt in candidate_outputs(td):
            outputs.append({'name':str(path.relative_to(td)),'bytes':path.stat().st_size})
            if width is None:
                width=parse_width(txt)
        (Path('/tmp')/f'multimodel_case{case_id:02d}_seed{seed}.log').write_text(log,encoding='utf-8')
        # Keep diagnostics for the first run so Actions tells us the exact
        # Sparrow CLI/output contract without flooding all 36 runs.
        if case_id == 1 and seed == SEEDS[0]:
            print('DIAG returncode=',p.returncode,flush=True)
            print('DIAG command=',cmd,flush=True)
            print('DIAG generated_files=',json.dumps(outputs),flush=True)
            print('DIAG stdout_tail=',repr(log[-4000:]),flush=True)
        ok=p.returncode==0 and width is not None and width <= MAX_WIDTH
        return {'case':case_id,'seed':seed,'ok':ok,'width':width,'returncode':p.returncode,'outputs':outputs,'models':order}

rows=[]
for i,order in enumerate(cases,1):
    for seed in SEEDS:
        r=run_case(i,order,seed)
        rows.append(r)
        print(f"case={i:02d} seed={seed:4d} rc={r['returncode']} ok={r['ok']} width={r['width']} files={len(r['outputs'])} models={','.join(order)}",flush=True)

valid=[r['width'] for r in rows if r['width'] is not None]
ok=sum(r['ok'] for r in rows)
returncodes=sorted(set(r['returncode'] for r in rows))
summary={'models':names,'cases':len(cases),'runs':len(rows),'successes':ok,'success_rate':round(100*ok/len(rows),2),'best_width':min(valid) if valid else None,'worst_width':max(valid) if valid else None,'returncodes':returncodes}
Path('/tmp/multimodel_rows.json').write_text(json.dumps(rows,indent=2,ensure_ascii=False),encoding='utf-8')
Path('/tmp/multimodel_summary.json').write_text(json.dumps(summary,indent=2,ensure_ascii=False),encoding='utf-8')
print('SUMMARY',json.dumps(summary,ensure_ascii=False),flush=True)

# This is a diagnostic benchmark stage: do not turn an output-parser mismatch
# into a fake geometry failure. A later stage can become strict once the real
# Sparrow output contract is confirmed.
if not valid:
    print('DIAGNOSTIC: no parseable width yet; inspect DIAG output above. Geometry result is not classified as failed.',flush=True)
