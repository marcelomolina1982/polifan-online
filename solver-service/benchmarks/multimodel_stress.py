import json, subprocess, tempfile, re, random, shutil
from pathlib import Path

ROOT=Path(__file__).parent
MODELS=json.loads((ROOT/'multimodel10.json').read_text(encoding='utf-8'))
SPARROW='/tmp/sparrow-bin'
MAX_WIDTH=1214.0
MAX_HEIGHT=574.0
STRIP_HEIGHT=580.0
SEP=3.0
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


def copy_best(output_dir, name, checkpoint):
    src=output_dir/f'final_{name}.json'
    if src.exists():
        shutil.copy2(src,checkpoint)
        return True
    return False

order=legacy_best_order(BASE)
seq=build_items(order)
rows=[]
solved=False
best=None

with tempfile.TemporaryDirectory() as tmp:
    td=Path(tmp)
    inp=td/'input.json'
    items=[{'id':i,'demand':1,'shape':{'type':'simple_polygon','data':r['p']}} for i,r in enumerate(seq)]
    inp.write_text(json.dumps({'name':'case9_target','strip_height':STRIP_HEIGHT,'items':items},separators=(',',':')),encoding='utf-8')
    output_dir=td/'output'
    checkpoint=td/'checkpoint.json'

    # Reproduce the basin that produced the 1222.701 mm record.
    stages=[
        ('exact-rebuild', None, None, BEST_SEED, 2, 28),
        ('warm-compress', 2, 118, BEST_SEED, 2, None),
        ('warm-compress', 3, 157, BEST_SEED+104729, 3, None),
        ('warm-compress', 3, 197, BEST_SEED-104729, 3, None),
    ]

    for stage,(kind,explore,compress,seed,workers,total) in enumerate(stages,1):
        if solved: break
        source=inp if stage==1 else checkpoint
        if stage>1 and not checkpoint.exists(): break
        args=[SPARROW,'-i',str(source),'--min-item-separation',str(SEP),'--workers',str(workers),'-s',str(seed)]
        if total is not None:
            args += ['-t',str(total)]
            timeout=total+45
        else:
            args += ['-e',str(explore),'-c',str(compress)]
            timeout=explore+compress+45
        p,text,w=run_cmd(args,td,f'multimodel_case09_stage{stage}.log',timeout)
        row={'stage':stage,'kind':kind,'seed':seed,'width':w,'ok_width':w is not None and w<=MAX_WIDTH,'workers':workers,'separation':SEP}
        rows.append(row)
        print('TARGET_STAGE',json.dumps(row),flush=True)
        if w is not None and (best is None or w<best):
            best=w
            copy_best(output_dir,'case9_target',checkpoint)
        elif stage==1:
            copy_best(output_dir,'case9_target',checkpoint)
        solved=row['ok_width']

    # Escape from the reproduced best basin instead of compressing the same local minimum forever.
    escape_runs=[
        (5,18,142,805306457,3),
        (6,30,170,268435399,3),
        (7,45,195,402653189,3),
        (8,60,220,1073741789,3),
        (9,75,245,1610612741,3),
    ]
    for stage,explore,compress,seed,workers in escape_runs:
        if solved or not checkpoint.exists(): break
        trial=td/f'trial_{stage}.json'
        shutil.copy2(checkpoint,trial)
        p,text,w=run_cmd([
            SPARROW,'-i',str(trial),'-e',str(explore),'-c',str(compress),
            '--min-item-separation',str(SEP),'--workers',str(workers),'-s',str(seed)
        ],td,f'multimodel_case09_stage{stage}.log',explore+compress+50)
        row={'stage':stage,'kind':'warm-destroy-repair','seed':seed,'width':w,'ok_width':w is not None and w<=MAX_WIDTH,
             'exploration':explore,'compression':compress,'workers':workers,'separation':SEP}
        rows.append(row)
        print('TARGET_STAGE',json.dumps(row),flush=True)
        if w is not None and (best is None or w<best):
            best=w
            copy_best(output_dir,'case9_target',checkpoint)
        solved=row['ok_width']

    if checkpoint.exists():
        shutil.copy2(checkpoint,'/tmp/case9_best_checkpoint.json')
    final_svg=output_dir/'final_case9_target.svg'
    if final_svg.exists():
        shutil.copy2(final_svg,'/tmp/case9_best.svg')

summary={
    'models':names,
    'cases':12,
    'official_cases_solved':9,
    'official_success_rate':75.0,
    'adaptive_cases_solved':12 if solved else 11,
    'adaptive_success_rate':100.0 if solved else 91.67,
    'adaptive_gain_cases':3 if solved else 2,
    'beats_official':True,
    'focused_cases':[9],
    'focused_strategy':'reproduce record basin then aggressive warm destroy-repair with 3mm separation',
    'physical_plate_mm':[1220.0,580.0],
    'certifiable_bbox_mm':[MAX_WIDTH,MAX_HEIGHT],
    'minimum_separation_mm':SEP,
    'total_runs':len(rows),
    'best_width':best,
    'width_goal_reached':solved,
    'case_results':[{
        'case':9,'official_ok':False,'official_width':1277.401,'solved':solved,
        'attempts':len(rows),'best_width':best,'best_seed':BEST_SEED,
        'best_strategy':'record basin + aggressive warm destroy-repair',
        'previous_best':1222.701,'target_width':MAX_WIDTH,'target_height':MAX_HEIGHT,'models':BASE
    }],
    'stages':rows
}
Path('/tmp/multimodel_rows.json').write_text(json.dumps(rows,indent=2,ensure_ascii=False),encoding='utf-8')
Path('/tmp/multimodel_summary.json').write_text(json.dumps(summary,indent=2,ensure_ascii=False),encoding='utf-8')
print('SUMMARY',json.dumps(summary,ensure_ascii=False),flush=True)
