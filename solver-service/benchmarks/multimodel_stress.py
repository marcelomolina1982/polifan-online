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


def rr_large(base):
    buckets={n:[] for n in names}
    for n in base: buckets[n].append(n)
    out=[]
    while any(buckets.values()):
        for n in sorted(names,key=lambda x:(-MODEL_AREA[x],x)):
            if buckets[n]: out.append(buckets[n].pop())
    return out


def rotate(seq,k):
    k%=len(seq)
    return list(seq[k:]+seq[:k])


def swap_pairs(seq, pairs):
    q=list(seq)
    for a,b in pairs:
        if a < len(q) and b < len(q): q[a],q[b]=q[b],q[a]
    return q


def build_items(order, mode='maxdim-large'):
    rec=[]
    for mi,m in enumerate(order):
        for pi,p in enumerate(MODELS[m]['parts']):
            w,h=dims(p)
            rec.append({'m':m,'mi':mi,'pi':pi,'p':p,'a':area(p),'w':w,'h':h,'maxd':max(w,h)})
    if mode=='maxdim-large': return sorted(rec,key=lambda r:(-r['maxd'],-r['a'],-r['w']))
    if mode=='width-large': return sorted(rec,key=lambda r:(-r['w'],-r['a'],-r['maxd']))
    if mode=='area-large': return sorted(rec,key=lambda r:(-r['a'],-r['maxd']))
    if mode=='pairs-maxdim': return sorted(rec,key=lambda r:(r['mi'],-r['maxd'],r['pi']))
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


def final_files(work):
    out=work/'output'
    js=list(out.glob('final_*.json')) if out.exists() else []
    svgs=list(out.glob('final_*.svg')) if out.exists() else []
    return (js[0] if js else None),(svgs[0] if svgs else None)

base_rr=rr_large(BASE)
# Tight beam around the topology that won run #65. No broad portfolio anymore.
scouts=[
    ('rr0-maxdim', base_rr, 'maxdim-large', 536870909),
    ('rr1-maxdim', rotate(base_rr,1), 'maxdim-large', 536975638),
    ('rr-1-maxdim', rotate(base_rr,-1), 'maxdim-large', 536766180),
    ('rr2-maxdim', rotate(base_rr,2), 'maxdim-large', 268435399),
    ('rr-rev-maxdim', list(reversed(base_rr)), 'maxdim-large', 805306457),
    ('rr-swap-maxdim', swap_pairs(base_rr,[(1,2),(5,6)]), 'maxdim-large', 1073741789),
    ('rr0-width', base_rr, 'width-large', 1610612741),
    ('rr0-pairs', base_rr, 'pairs-maxdim', 402653189),
]

rows=[]; solved=False; candidates=[]; best=None

with tempfile.TemporaryDirectory() as tmp:
    td=Path(tmp)
    # Phase A: short scouts. The goal is topology discrimination, not final compression.
    for idx,(label,order,pmode,seed) in enumerate(scouts,1):
        if solved: break
        work=td/f'scout_{idx:02d}'; work.mkdir()
        seq=build_items(order,pmode)
        name=f'case9_scout_{idx:02d}'
        inp=work/'input.json'
        items=[{'id':i,'demand':1,'shape':{'type':'simple_polygon','data':r['p']}} for i,r in enumerate(seq)]
        inp.write_text(json.dumps({'name':name,'strip_height':STRIP_HEIGHT,'items':items},separators=(',',':')),encoding='utf-8')
        p,text,w=run_cmd([SPARROW,'-i',str(inp),'-t','32','--min-item-separation',str(SEP),'--workers','3','-s',str(seed)],work,f'multimodel_case09_scout_{idx:02d}.log',75)
        ok=w is not None and w<=MAX_WIDTH
        row={'stage':len(rows)+1,'phase':'scout','label':label,'part_mode':pmode,'seed':seed,'width':w,'ok_width':ok,'height':STRIP_HEIGHT,'separation':SEP}
        rows.append(row); print('SCOUT',json.dumps(row),flush=True)
        js,svg=final_files(work)
        if w is not None and js is not None:
            cp=td/f'candidate_{idx:02d}.json'; shutil.copy2(js,cp)
            sp=None
            if svg is not None:
                sp=td/f'candidate_{idx:02d}.svg'; shutil.copy2(svg,sp)
            candidates.append({'width':w,'label':label,'seed':seed,'checkpoint':cp,'svg':sp})
            best=w if best is None else min(best,w)
        solved=ok

    # Keep only the three best topology basins.
    candidates=sorted(candidates,key=lambda c:c['width'])[:3]
    print('BEAM_TOP3',json.dumps([{k:v for k,v in c.items() if k in ('width','label','seed')} for c in candidates]),flush=True)

    # Phase B: spend real budget only on top-3.
    refined=[]
    refine_seeds=[268435399,536870909,805306457]
    for rank,c in enumerate(candidates,1):
        if solved: break
        work=td/f'refine_{rank:02d}'; work.mkdir()
        src=work/'warm.json'; shutil.copy2(c['checkpoint'],src)
        seed=refine_seeds[rank-1]
        p,text,w=run_cmd([SPARROW,'-i',str(src),'-e','35','-c','185','--min-item-separation',str(SEP),'--workers','3','-s',str(seed)],work,f'multimodel_case09_refine_{rank:02d}.log',275)
        ok=w is not None and w<=MAX_WIDTH
        row={'stage':len(rows)+1,'phase':'beam-refine','rank':rank,'source_label':c['label'],'seed':seed,'width':w,'ok_width':ok,'exploration':35,'compression':185,'height':STRIP_HEIGHT,'separation':SEP}
        rows.append(row); print('REFINE',json.dumps(row),flush=True)
        js,svg=final_files(work)
        if w is not None and js is not None:
            cp=td/f'refined_{rank:02d}.json'; shutil.copy2(js,cp)
            sp=None
            if svg is not None:
                sp=td/f'refined_{rank:02d}.svg'; shutil.copy2(svg,sp)
            refined.append({'width':w,'label':c['label'],'seed':seed,'checkpoint':cp,'svg':sp})
            best=w if best is None else min(best,w)
        else:
            refined.append(c)
        solved=ok

    pool=sorted(refined or candidates,key=lambda c:c['width'])
    champion=pool[0] if pool else None

    # Phase C: only the champion gets the expensive attack. Success stops immediately.
    final_plan=[
        (25,235,1073741789),
        (55,275,1610612741),
        (90,310,536870909),
    ]
    for j,(explore,compress,seed) in enumerate(final_plan,1):
        if solved or champion is None: break
        work=td/f'champion_{j:02d}'; work.mkdir()
        src=work/'warm.json'; shutil.copy2(champion['checkpoint'],src)
        p,text,w=run_cmd([SPARROW,'-i',str(src),'-e',str(explore),'-c',str(compress),'--min-item-separation',str(SEP),'--workers','3','-s',str(seed)],work,f'multimodel_case09_champion_{j:02d}.log',explore+compress+65)
        ok=w is not None and w<=MAX_WIDTH
        row={'stage':len(rows)+1,'phase':'champion-attack','round':j,'source_label':champion['label'],'seed':seed,'width':w,'ok_width':ok,'exploration':explore,'compression':compress,'height':STRIP_HEIGHT,'separation':SEP}
        rows.append(row); print('CHAMPION',json.dumps(row),flush=True)
        js,svg=final_files(work)
        if w is not None and js is not None and w < champion['width']:
            cp=td/f'champion_best_{j:02d}.json'; shutil.copy2(js,cp)
            sp=None
            if svg is not None:
                sp=td/f'champion_best_{j:02d}.svg'; shutil.copy2(svg,sp)
            champion={'width':w,'label':champion['label'],'seed':seed,'checkpoint':cp,'svg':sp}
            best=w if best is None else min(best,w)
        solved=ok

    if champion is not None:
        shutil.copy2(champion['checkpoint'],'/tmp/case9_best_checkpoint.json')
        if champion.get('svg') and Path(champion['svg']).exists(): shutil.copy2(champion['svg'],'/tmp/case9_best.svg')

summary={
    'models':names,'cases':12,
    'official_cases_solved':9,'official_success_rate':75.0,
    'adaptive_cases_solved':12 if solved else 11,
    'adaptive_success_rate':100.0 if solved else 91.67,
    'adaptive_gain_cases':3 if solved else 2,'beats_official':True,
    'focused_cases':[9],
    'focused_strategy':'winner-topology beam: 8 scouts -> top3 refine -> champion attack',
    'physical_plate_mm':[1220.0,580.0],
    'certifiable_bbox_mm':[MAX_WIDTH,MAX_HEIGHT],
    'solver_strip_height_mm':STRIP_HEIGHT,
    'minimum_separation_mm':SEP,
    'previous_valid_best_mm':1248.347,
    'total_runs':len(rows),'best_width':best,'width_goal_reached':solved,
    'case_results':[{'case':9,'solved':solved,'attempts':len(rows),'best_width':best,'target_width':MAX_WIDTH,'target_height':MAX_HEIGHT,'models':BASE}],
    'stages':rows
}
Path('/tmp/multimodel_rows.json').write_text(json.dumps(rows,indent=2,ensure_ascii=False),encoding='utf-8')
Path('/tmp/multimodel_summary.json').write_text(json.dumps(summary,indent=2,ensure_ascii=False),encoding='utf-8')
print('SUMMARY',json.dumps(summary,ensure_ascii=False),flush=True)
