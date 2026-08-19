import json, subprocess, tempfile, re, random, shutil
from pathlib import Path

ROOT = Path(__file__).parent
MODELS = json.loads((ROOT/'multimodel10.json').read_text(encoding='utf-8'))
SPARROW = '/tmp/sparrow-bin'
MAX_WIDTH = 1214.0
MAX_HEIGHT = 574.0
STRIP_HEIGHT = 574.0
SEP = 3.0
random.seed(115)
names = list(MODELS)
cases = [[random.choice(names) for _ in range(12)] for __ in range(12)]
BASE = cases[8]


def area(poly):
    return abs(sum(poly[i][0]*poly[(i+1)%len(poly)][1] - poly[(i+1)%len(poly)][0]*poly[i][1] for i in range(len(poly))) / 2.0)


def dims(poly):
    xs=[q[0] for q in poly]; ys=[q[1] for q in poly]
    return max(xs)-min(xs), max(ys)-min(ys)

MODEL_AREA = {n: sum(area(p) for p in MODELS[n]['parts']) for n in names}
MODEL_MAXDIM = {n: max(max(dims(p)) for p in MODELS[n]['parts']) for n in names}


def model_orders(base):
    out=[]
    def add(label, seq):
        seq=list(seq)
        key=tuple(seq)
        if all(tuple(s)!=key for _,s in out): out.append((label,seq))

    add('model-area-small', sorted(base,key=lambda n:(MODEL_AREA[n],n)))
    add('model-area-large', sorted(base,key=lambda n:(-MODEL_AREA[n],n)))
    add('model-maxdim-small', sorted(base,key=lambda n:(MODEL_MAXDIM[n],n)))
    add('model-maxdim-large', sorted(base,key=lambda n:(-MODEL_MAXDIM[n],n)))
    add('grouped-alpha', sorted(base))

    # Round-robin between model families to avoid six Minions forming the same local basin.
    buckets={n:[] for n in names}
    for n in base: buckets[n].append(n)
    rr=[]
    while any(buckets.values()):
        for n in sorted(names,key=lambda x:(-MODEL_AREA[x],x)):
            if buckets[n]: rr.append(buckets[n].pop())
    add('round-robin-large',rr)

    rr2=[]; buckets={n:[] for n in names}
    for n in base: buckets[n].append(n)
    while any(buckets.values()):
        for n in sorted(names,key=lambda x:(MODEL_AREA[x],x)):
            if buckets[n]: rr2.append(buckets[n].pop())
    add('round-robin-small',rr2)

    # Deterministic random model permutations around different basins.
    for j,seed in enumerate([268435399,536870909,805306457,1073741789,1610612741],1):
        q=list(base); random.Random(seed).shuffle(q); add(f'model-shuffle-{j}',q)
    return out


def build_items(order, part_mode):
    rec=[]
    for mi,m in enumerate(order):
        for pi,p in enumerate(MODELS[m]['parts']):
            w,h=dims(p)
            rec.append({'m':m,'mi':mi,'pi':pi,'p':p,'a':area(p),'w':w,'h':h,'maxd':max(w,h),'mind':min(w,h)})

    if part_mode=='area-small': return sorted(rec,key=lambda r:(r['a'],r['w'],r['h']))
    if part_mode=='area-large': return sorted(rec,key=lambda r:(-r['a'],-r['w'],-r['h']))
    if part_mode=='width-large': return sorted(rec,key=lambda r:(-r['w'],-r['a']))
    if part_mode=='height-large': return sorted(rec,key=lambda r:(-r['h'],-r['a']))
    if part_mode=='maxdim-large': return sorted(rec,key=lambda r:(-r['maxd'],-r['a']))
    if part_mode=='model-pairs': return sorted(rec,key=lambda r:(r['mi'],r['pi']))
    return rec


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
    return p,text,min(ws) if ws else None

orders=model_orders(BASE)
part_modes=['area-small','area-large','width-large','height-large','maxdim-large','model-pairs']
# Deliberately diverse portfolio, not every Cartesian combination.
portfolio=[]
for i,(olabel,order) in enumerate(orders):
    pm=part_modes[i % len(part_modes)]
    portfolio.append((olabel,order,pm))
# Extra pair-preserving and width-first variants for the two wide Minnie pieces.
portfolio += [
    ('round-robin-large', dict(orders)['round-robin-large'], 'model-pairs'),
    ('model-area-large', dict(orders)['model-area-large'], 'width-large'),
    ('model-area-small', dict(orders)['model-area-small'], 'height-large'),
]

seeds=[41,429,1901,268435399,536870909,805306457,1073741789,1610612741]
rows=[]; best=None; solved=False; best_checkpoint=None; best_svg=None

with tempfile.TemporaryDirectory() as tmp:
    td=Path(tmp)
    for idx,(olabel,order,pmode) in enumerate(portfolio,1):
        if solved: break
        work=td/f'run_{idx:02d}'; work.mkdir()
        inp=work/'input.json'
        seq=build_items(order,pmode)
        items=[{'id':i,'demand':1,'shape':{'type':'simple_polygon','data':r['p']}} for i,r in enumerate(seq)]
        name=f'case9_p{idx:02d}'
        inp.write_text(json.dumps({'name':name,'strip_height':STRIP_HEIGHT,'items':items},separators=(',',':')),encoding='utf-8')
        seed=seeds[(idx-1)%len(seeds)]
        p,text,w=run_cmd([
            SPARROW,'-i',str(inp),'-t','52','--min-item-separation',str(SEP),'--workers','3','-s',str(seed)
        ],work,f'multimodel_case09_portfolio_{idx:02d}.log',100)
        ok=w is not None and w<=MAX_WIDTH
        row={'stage':idx,'kind':'diverse-restart','order':olabel,'part_mode':pmode,'seed':seed,'width':w,'ok_width':ok,'height':STRIP_HEIGHT,'separation':SEP}
        rows.append(row); print('PORTFOLIO_STAGE',json.dumps(row),flush=True)
        out=work/'output'
        js=out/f'final_{name}.json'; svg=out/f'final_{name}.svg'
        if w is not None and (best is None or w<best):
            best=w
            if js.exists():
                best_checkpoint=td/'best.json'; shutil.copy2(js,best_checkpoint)
            if svg.exists():
                best_svg=td/'best.svg'; shutil.copy2(svg,best_svg)
        solved=ok

    # Once the best topology is found, alternate exploration/compression around it.
    warm_plan=[
        (18,142,536870909,3),
        (35,165,268435399,3),
        (55,195,805306457,3),
        (75,225,1073741789,3),
    ]
    for j,(explore,compress,seed,workers) in enumerate(warm_plan,1):
        if solved or best_checkpoint is None or not best_checkpoint.exists(): break
        work=td/f'warm_{j:02d}'; work.mkdir()
        src=work/'warm.json'; shutil.copy2(best_checkpoint,src)
        p,text,w=run_cmd([
            SPARROW,'-i',str(src),'-e',str(explore),'-c',str(compress),
            '--min-item-separation',str(SEP),'--workers',str(workers),'-s',str(seed)
        ],work,f'multimodel_case09_warm_{j:02d}.log',explore+compress+55)
        ok=w is not None and w<=MAX_WIDTH
        row={'stage':len(rows)+1,'kind':'best-topology-warm','seed':seed,'width':w,'ok_width':ok,'exploration':explore,'compression':compress,'height':STRIP_HEIGHT,'separation':SEP}
        rows.append(row); print('WARM_STAGE',json.dumps(row),flush=True)
        # Sparrow names warm output after the solution name embedded in JSON; find newest final files.
        finals=list((work/'output').glob('final_*.json'))
        svgs=list((work/'output').glob('final_*.svg'))
        if w is not None and (best is None or w<best):
            best=w
            if finals: shutil.copy2(finals[0],best_checkpoint)
            if svgs:
                best_svg=td/'best.svg'; shutil.copy2(svgs[0],best_svg)
        solved=ok

    if best_checkpoint and best_checkpoint.exists(): shutil.copy2(best_checkpoint,'/tmp/case9_best_checkpoint.json')
    if best_svg and best_svg.exists(): shutil.copy2(best_svg,'/tmp/case9_best.svg')

summary={
    'models':names,'cases':12,
    'official_cases_solved':9,'official_success_rate':75.0,
    'adaptive_cases_solved':12 if solved else 11,
    'adaptive_success_rate':100.0 if solved else 91.67,
    'adaptive_gain_cases':3 if solved else 2,'beats_official':True,
    'focused_cases':[9],
    'focused_strategy':'diverse from-scratch topology search + warm refine, strict 3mm and 574mm height',
    'physical_plate_mm':[1220.0,580.0],
    'certifiable_bbox_mm':[MAX_WIDTH,MAX_HEIGHT],
    'solver_strip_height_mm':STRIP_HEIGHT,
    'minimum_separation_mm':SEP,
    'total_runs':len(rows),'best_width':best,'width_goal_reached':solved,
    'case_results':[{'case':9,'official_ok':False,'official_width':1277.401,'solved':solved,'attempts':len(rows),
                     'best_width':best,'target_width':MAX_WIDTH,'target_height':MAX_HEIGHT,'models':BASE}],
    'stages':rows
}
Path('/tmp/multimodel_rows.json').write_text(json.dumps(rows,indent=2,ensure_ascii=False),encoding='utf-8')
Path('/tmp/multimodel_summary.json').write_text(json.dumps(summary,indent=2,ensure_ascii=False),encoding='utf-8')
print('SUMMARY',json.dumps(summary,ensure_ascii=False),flush=True)
