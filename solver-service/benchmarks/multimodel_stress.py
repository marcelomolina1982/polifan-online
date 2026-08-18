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

def parse_width(log):
    patterns=[
        r'best feasible width[^0-9]*([0-9]+(?:\.[0-9]+)?)',
        r'best[^\n]*width[^0-9]*([0-9]+(?:\.[0-9]+)?)',
        r'width[^0-9]*([0-9]+(?:\.[0-9]+)?)'
    ]
    vals=[]
    for pat in patterns:
        vals=[float(x) for x in re.findall(pat,log,re.I)]
        if vals: break
    return min(vals) if vals else None

def run_case(case_id, order, seed):
    with tempfile.TemporaryDirectory() as td:
        td=Path(td)
        inp=td/'input.json'
        make_input(order,inp)
        cmd=[SPARROW,'-i',str(inp),'-t','6','--min-item-separation','2.5','--workers','1','-s',str(seed)]
        p=subprocess.run(cmd,cwd=td,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=30)
        width=parse_width(p.stdout)
        (Path('/tmp')/f'multimodel_case{case_id:02d}_seed{seed}.log').write_text(p.stdout,encoding='utf-8')
        ok=p.returncode==0 and width is not None and width <= MAX_WIDTH
        return {'case':case_id,'seed':seed,'ok':ok,'width':width,'returncode':p.returncode,'models':order}

rows=[]
for i,order in enumerate(cases,1):
    for seed in SEEDS:
        r=run_case(i,order,seed)
        rows.append(r)
        print(f"case={i:02d} seed={seed:4d} ok={r['ok']} width={r['width']} models={','.join(order)}",flush=True)

valid=[r['width'] for r in rows if r['width'] is not None]
ok=sum(r['ok'] for r in rows)
summary={'models':names,'cases':len(cases),'runs':len(rows),'successes':ok,'success_rate':round(100*ok/len(rows),2),'best_width':min(valid) if valid else None,'worst_width':max(valid) if valid else None}
Path('/tmp/multimodel_rows.json').write_text(json.dumps(rows,indent=2,ensure_ascii=False),encoding='utf-8')
Path('/tmp/multimodel_summary.json').write_text(json.dumps(summary,indent=2,ensure_ascii=False),encoding='utf-8')
print('SUMMARY',json.dumps(summary,ensure_ascii=False),flush=True)
if not valid:
    raise SystemExit('No Sparrow run produced a parseable width')
