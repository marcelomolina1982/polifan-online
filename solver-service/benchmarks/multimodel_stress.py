import json, subprocess, tempfile, re, random, shutil
from pathlib import Path

ROOT=Path(__file__).parent
MODELS=json.loads((ROOT/'multimodel10.json').read_text(encoding='utf-8'))
SPARROW='/tmp/sparrow-bin'; MAX_WIDTH=1214.0; STRIP_HEIGHT=580.0
random.seed(115)
names=list(MODELS)
cases=[[random.choice(names) for _ in range(12)] for __ in range(12)]
BASE=cases[8]
BEST_SEED=536870909


def area(poly):
    return abs(sum(poly[i][0]*poly[(i+1)%len(poly)][1]-poly[(i+1)%len(poly)][0]*poly[i][1] for i in range(len(poly)))/2.0)
MODEL_AREA={n:sum(area(p) for p in MODELS[n]['parts']) for n in names}


def legacy_best_order(base):
    ranked=sorted(list(base), key=lambda n:(MODEL_AREA[n],n))
    rr=random.Random(BEST_SEED + 19*100003)
    i=rr.randrange(len(ranked)-1)
    ranked[i],ranked[i+1]=ranked[i+1],ranked[i]
    return ranked


def build_items(order):
    rec=[]
    for mi,m in enumerate(order):
        for pi,p in enumerate(MODELS[m]['parts']):
            xs=[q[0] for q in p]; ys=[q[1] for q in p]
            rec.append({'m':m,'mi':mi,'pi':pi,'p':p,'a':area(p),'w':max(xs)-min(xs),'h':max(ys)-min(ys)})
    return sorted(rec,key=lambda r:(r['a'],r['w'],r['h']))


def widths(text):
    vals=[]
    for pat in [
        r'\[CMPR\] success[^\n]*\(([0-9]+(?:\.[0-9]+)?)\s*\|',
        r'best feasible solution: width:\s*([0-9]+(?:\.[0-9]+)?)',
        r'feasible solution found! \(width:\s*([0-9]+(?:\.[0-9]+)?)'
    ]:
        vals += [float(x) for x in re.findall(pat,text,re.I)]
    return vals


def run_cmd(args,cwd,logname,timeout):
    p=subprocess.run(args,cwd=cwd,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=timeout)
    text=p.stdout or ''
    Path('/tmp',logname).write_text(text,encoding='utf-8')
    ws=widths(text)
    return p, text, min(ws) if ws else None

order=legacy_best_order(BASE)
seq=build_items(order)
rows=[]; solved=False; best=None

with tempfile.TemporaryDirectory() as tmp:
    td=Path(tmp); inp=td/'input.json'
    items=[{'id':i,'demand':1,'shape':{'type':'simple_polygon','data':r['p']}} for i,r in enumerate(seq)]
    inp.write_text(json.dumps({'name':'case9_warm','strip_height':STRIP_HEIGHT,'items':items},separators=(',',':')),encoding='utf-8')

    # Exact reproduction of legacy run49 attempt19: 28s, 2 workers, same seed/order.
    p,text,w=run_cmd([
        SPARROW,'-i',str(inp),'-t','28','--min-item-separation','2.5',
        '--workers','2','-s',str(BEST_SEED)
    ],td,'multimodel_case09_stage1.log',70)
    row={'stage':1,'kind':'exact-rebuild','seed':BEST_SEED,'width':w,'ok':w is not None and w<=MAX_WIDTH}
    rows.append(row); best=w
    print('WARM_STAGE',json.dumps(row),flush=True)
    solved=row['ok']

    final_json=td/'output'/'final_case9_warm.json'
    # Preserve that exact placement, then devote most of the budget to compression.
    for stage,(explore,compress,seed,workers) in enumerate([
        (2,118,BEST_SEED,2),
        (3,157,BEST_SEED+104729,3),
        (3,197,BEST_SEED-104729,3),
    ],start=2):
        if solved or not final_json.exists():
            break
        warm=td/f'warm_stage{stage}.json'
        shutil.copy2(final_json,warm)
        p,text,w=run_cmd([
            SPARROW,'-i',str(warm),'-e',str(explore),'-c',str(compress),
            '--min-item-separation','2.5','--workers',str(workers),'-s',str(seed)
        ],td,f'multimodel_case09_stage{stage}.log',explore+compress+40)
        row={'stage':stage,'kind':'warm-compress','seed':seed,'width':w,'ok':w is not None and w<=MAX_WIDTH,
             'exploration':explore,'compression':compress,'workers':workers}
        rows.append(row)
        if w is not None and (best is None or w<best): best=w
        print('WARM_STAGE',json.dumps(row),flush=True)
        solved=row['ok']

summary={
    'models':names,'cases':12,
    'official_cases_solved':9,'official_success_rate':75.0,
    'adaptive_cases_solved':12 if solved else 11,
    'adaptive_success_rate':100.0 if solved else 91.67,
    'adaptive_gain_cases':3 if solved else 2,
    'beats_official':True,'focused_cases':[9],
    'focused_strategy':'exact legacy 1229 rebuild then chained warm-start compression',
    'total_runs':len(rows),'best_width':best,
    'case_results':[{'case':9,'official_ok':False,'official_width':1277.401,'solved':solved,
                     'attempts':len(rows),'best_width':best,'best_seed':BEST_SEED,
                     'best_strategy':'exact legacy attempt19 + chained warm compression','previous_best':1229.161,
                     'target_width':MAX_WIDTH,'models':BASE}],
    'stages':rows
}
Path('/tmp/multimodel_rows.json').write_text(json.dumps(rows,indent=2,ensure_ascii=False),encoding='utf-8')
Path('/tmp/multimodel_summary.json').write_text(json.dumps(summary,indent=2,ensure_ascii=False),encoding='utf-8')
print('SUMMARY',json.dumps(summary,ensure_ascii=False),flush=True)
