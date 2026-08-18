import json, subprocess, tempfile, re, random
from pathlib import Path

ROOT = Path(__file__).parent
MODELS = json.loads((ROOT / 'multimodel10.json').read_text(encoding='utf-8'))
SPARROW = '/tmp/sparrow-bin'
MAX_WIDTH = 1214.0
STRIP_HEIGHT = 580.0
BASE_SEEDS = [101, 503, 1297, 1701, 4099, 7919]
ATTEMPT_TIME = 6
random.seed(115)

names = list(MODELS)
assert len(names) >= 5, f'Expected >=5 real models, got {len(names)}'

# Same 12 real mixed orders used in the previous benchmark so results are comparable.
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
    payload={'name':'multimodel_real_order','strip_height':STRIP_HEIGHT,'items':items}
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

def run_once(case_id, base_order, seed, attempt):
    # Keep the same 12 figures but vary their insertion order on later attempts.
    order=list(base_order)
    if attempt > 1:
        rr=random.Random(case_id * 100000 + seed * 17 + attempt)
        rr.shuffle(order)
    with tempfile.TemporaryDirectory() as tmp:
        td=Path(tmp)
        inp=td/'input.json'
        make_input(order,inp)
        cmd=[SPARROW,'-i',str(inp),'-t',str(ATTEMPT_TIME),'--min-item-separation','2.5','--workers','1','-s',str(seed)]
        p=subprocess.run(cmd,cwd=td,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=30)
        log=p.stdout or ''
        width=parse_width(log)
        outputs=[]
        for path,txt in candidate_outputs(td):
            outputs.append({'name':str(path.relative_to(td)),'bytes':path.stat().st_size})
            if width is None:
                width=parse_width(txt)
        (Path('/tmp')/f'multimodel_case{case_id:02d}_attempt{attempt:02d}_seed{seed}.log').write_text(log,encoding='utf-8')
        ok=p.returncode==0 and width is not None and width <= MAX_WIDTH
        return {'case':case_id,'attempt':attempt,'seed':seed,'ok':ok,'width':width,'returncode':p.returncode,'models':order,'outputs':outputs}

rows=[]
case_results=[]
for case_id,base_order in enumerate(cases,1):
    best=None
    solved=False
    attempts=0
    for attempt,seed in enumerate(BASE_SEEDS,1):
        r=run_once(case_id,base_order,seed,attempt)
        rows.append(r)
        attempts += 1
        if r['width'] is not None and (best is None or r['width'] < best['width']):
            best=r
        print(f"case={case_id:02d} attempt={attempt} seed={seed:4d} rc={r['returncode']} ok={r['ok']} width={r['width']} models={','.join(r['models'])}",flush=True)
        if r['ok']:
            solved=True
            break
    case_results.append({'case':case_id,'solved':solved,'attempts':attempts,'best_width':best['width'] if best else None,'best_seed':best['seed'] if best else None,'best_attempt':best['attempt'] if best else None,'models':base_order})
    print(f"CASE_SUMMARY case={case_id:02d} solved={solved} attempts={attempts} best_width={case_results[-1]['best_width']}",flush=True)

solved=sum(x['solved'] for x in case_results)
valid=[r['width'] for r in rows if r['width'] is not None]
summary={
    'models':names,
    'cases':len(cases),
    'cases_solved':solved,
    'case_success_rate':round(100*solved/len(cases),2),
    'total_runs':len(rows),
    'max_attempts_per_case':len(BASE_SEEDS),
    'attempt_seconds':ATTEMPT_TIME,
    'best_width':min(valid) if valid else None,
    'worst_width':max(valid) if valid else None,
    'case_results':case_results,
}
Path('/tmp/multimodel_rows.json').write_text(json.dumps(rows,indent=2,ensure_ascii=False),encoding='utf-8')
Path('/tmp/multimodel_summary.json').write_text(json.dumps(summary,indent=2,ensure_ascii=False),encoding='utf-8')
print('SUMMARY',json.dumps(summary,ensure_ascii=False),flush=True)
