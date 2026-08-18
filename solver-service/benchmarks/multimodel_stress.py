import json, subprocess, tempfile, re, random
from pathlib import Path

ROOT = Path(__file__).parent
# Geometry is stored as plain JSON so benchmark input cannot fail because of Base64 padding.
MODELS = json.loads((ROOT / 'multimodel10.json').read_text(encoding='utf-8'))
SPARROW = '/tmp/sparrow-bin'
MAX_WIDTH = 1214.0
SEEDS = [101, 503, 1297]
random.seed(115)

# 16 varied orders of 12 complete figures, mixing small/medium/large candidates.
names = list(MODELS)
assert len(names) >= 10, f'Expected >=10 models, got {len(names)}'
cases = []
for i in range(16):
    # Repetition is intentional: real orders may contain several units of a model.
    order = [random.choice(names) for _ in range(12)]
    cases.append(order)

def make_svg(order, out):
    # Each model payload contains the already validated SVG geometry for one complete figure.
    body = []
    for name in order:
        payload = MODELS[name]
        if isinstance(payload, dict):
            payload = payload.get('svg') or payload.get('content') or payload.get('geometry')
        if not isinstance(payload, str) or '<' not in payload:
            raise ValueError(f'Invalid geometry payload for {name}')
        # Strip outer svg wrapper when present; Sparrow receives one combined SVG.
        payload = re.sub(r'^.*?<svg[^>]*>', '', payload, count=1, flags=re.S|re.I)
        payload = re.sub(r'</svg>\s*$', '', payload, count=1, flags=re.S|re.I)
        body.append(payload)
    out.write_text('<svg xmlns="http://www.w3.org/2000/svg">\n' + '\n'.join(body) + '\n</svg>', encoding='utf-8')

def run_case(case_id, order, seed):
    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        inp = td/'input.svg'
        make_svg(order, inp)
        cmd = [SPARROW, str(inp), '--seed', str(seed), '--time-limit', '6']
        p = subprocess.run(cmd, cwd=td, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        log = p.stdout
        widths = [float(x) for x in re.findall(r'best feasible width[^0-9]*([0-9]+(?:\.[0-9]+)?)', log, re.I)]
        if not widths:
            widths = [float(x) for x in re.findall(r'width[^0-9]*([0-9]+(?:\.[0-9]+)?)', log, re.I)]
        width = min(widths) if widths else None
        ok = p.returncode == 0 and width is not None and width <= MAX_WIDTH
        return {'case':case_id,'seed':seed,'ok':ok,'width':width,'returncode':p.returncode,'models':order}

rows=[]
for i, order in enumerate(cases, 1):
    for seed in SEEDS:
        r=run_case(i, order, seed)
        rows.append(r)
        print(f"case={i:02d} seed={seed:4d} ok={r['ok']} width={r['width']} models={','.join(order)}", flush=True)

ok=sum(r['ok'] for r in rows)
valid_widths=[r['width'] for r in rows if r['width'] is not None]
summary={'runs':len(rows),'successes':ok,'success_rate':round(100*ok/len(rows),2),'best_width':min(valid_widths) if valid_widths else None,'worst_width':max(valid_widths) if valid_widths else None}
Path('/tmp/multimodel_rows.json').write_text(json.dumps(rows,indent=2,ensure_ascii=False),encoding='utf-8')
Path('/tmp/multimodel_summary.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
print('SUMMARY',json.dumps(summary),flush=True)
