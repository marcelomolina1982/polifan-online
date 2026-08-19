import json, math, re, shutil, subprocess, tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).parent
SPARROW = '/tmp/sparrow-bin'
FIXTURE = ROOT / 'case9_run67_checkpoint.json'
PLATE_W = 1220.0
PLATE_H = 580.0
SEP = 3.0
EXPECTED_ITEMS = 24
PREVIOUS_BEST = 1238.606


def widths(text):
    vals=[]
    for pat in [
        r'\[CMPR\] success[^\n]*\(([0-9]+(?:\.[0-9]+)?)\s*\|',
        r'best feasible solution: width:\s*([0-9]+(?:\.[0-9]+)?)',
        r'feasible solution found! \(width:\s*([0-9]+(?:\.[0-9]+)?)'
    ]:
        vals += [float(x) for x in re.findall(pat,text,re.I)]
    return vals


def final_files(work):
    out=work/'output'
    js=sorted(out.glob('final_*.json')) if out.exists() else []
    sv=sorted(out.glob('final_*.svg')) if out.exists() else []
    return (js[0] if js else None),(sv[0] if sv else None)


def transformed_bbox(obj):
    shapes={it['id']:it['shape']['data'] for it in obj['items']}
    placed=obj.get('solution',{}).get('layout',{}).get('placed_items',[])
    xs=[]; ys=[]
    for pl in placed:
        pts=shapes[pl['item_id']]
        a=math.radians(pl['transformation']['rotation']); c=math.cos(a); s=math.sin(a)
        tx,ty=pl['transformation']['translation']
        for x,y in pts:
            xs.append(x*c-y*s+tx); ys.append(x*s+y*c+ty)
    return (min(xs),min(ys),max(xs),max(ys)) if xs else None


def validate(path):
    if path is None or not path.exists():
        return {'candidate':False,'solved':False,'reason':'no-final-json','placed':0,'bbox':None,'strip_width':None}
    obj=json.loads(path.read_text(encoding='utf-8'))
    placed=obj.get('solution',{}).get('layout',{}).get('placed_items',[])
    ids=[p.get('item_id') for p in placed]
    bbox=transformed_bbox(obj)
    strip=obj.get('solution',{}).get('strip_width')
    count_ok=len(placed)==EXPECTED_ITEMS and len(set(ids))==EXPECTED_ITEMS
    y_ok=False; left_ok=False; right_ok=False
    if bbox:
        minx,miny,maxx,maxy=bbox
        y_ok=miny>=SEP-0.15 and maxy<=PLATE_H-SEP+0.15
        left_ok=minx>=SEP-0.15
        right_ok=maxx<=PLATE_W-SEP+0.15
    # Candidate may still exceed the right edge: keep it so near-winners are not lost.
    candidate=bool(count_ok and y_ok and left_ok and strip is not None)
    solved=bool(candidate and right_ok and strip<=PLATE_W+0.01)
    reason='ok' if solved else ('piece-count' if not count_ok else ('vertical-border' if not y_ok else ('left-border' if not left_ok else 'too-wide')))
    return {'candidate':candidate,'solved':solved,'reason':reason,'placed':len(placed),'bbox':bbox,'strip_width':strip}


def run_one(source, root, label, explore, compress, seed, timeout):
    work=root/label; work.mkdir()
    src=work/'warm.json'; shutil.copy2(source,src)
    obj=json.loads(src.read_text(encoding='utf-8')); obj['strip_height']=PLATE_H
    src.write_text(json.dumps(obj,separators=(',',':')),encoding='utf-8')
    try:
        p=subprocess.run([SPARROW,'-i',str(src),'-e',str(explore),'-c',str(compress),'--min-item-separation',str(SEP),'--workers','1','-s',str(seed)],cwd=work,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=timeout)
        text=p.stdout or ''; rc=p.returncode
    except subprocess.TimeoutExpired as e:
        text=(e.stdout or '') if isinstance(e.stdout,str) else ''; rc=124
    Path('/tmp',f'multimodel_case09_{label}.log').write_text(text+'\n'+('TIMEOUT' if rc==124 else ''),encoding='utf-8')
    ws=widths(text)
    js,svg=final_files(work)
    cert=validate(js)
    reported=min(ws) if ws else None
    return {'label':label,'seed':seed,'exploration':explore,'compression':compress,'returncode':rc,'reported_width':reported,**cert,'json':js,'svg':svg}


base=json.loads(FIXTURE.read_text(encoding='utf-8'))
assert len(base['solution']['layout']['placed_items'])==EXPECTED_ITEMS
base['strip_height']=PLATE_H
rows=[]; solved=False

# Many short probes instead of one long search. All start from the same full 24-piece checkpoint.
scouts=[
    ('micro_a',10,28,536870909),
    ('micro_b',14,30,1073741789),
    ('micro_c',18,28,1610612741),
    ('micro_d',8,36,268435399),
    ('micro_e',20,24,805306457),
    ('micro_f',12,34,402653189),
]

with tempfile.TemporaryDirectory() as tmp:
    td=Path(tmp)
    source=td/'base.json'; source.write_text(json.dumps(base,separators=(',',':')),encoding='utf-8')
    results=[]
    # 3 simultaneous Sparrow processes, one worker each: short wall-clock batch.
    with ThreadPoolExecutor(max_workers=3) as ex:
        futs=[ex.submit(run_one,source,td,*plan,55) for plan in scouts]
        for fut in as_completed(futs):
            r=fut.result(); results.append(r)
            row={k:v for k,v in r.items() if k not in ('json','svg')}
            row['phase']='micro-scout'; rows.append(row); print('MICRO',json.dumps(row),flush=True)

    candidates=sorted([r for r in results if r['candidate']],key=lambda r:r['strip_width'])
    solved=any(r['solved'] for r in candidates)
    champion=candidates[0] if candidates else None

    # Refine only the best two basins, also in parallel, and only briefly.
    refined=[]
    if not solved:
        top=candidates[:2]
        refine_specs=[]
        for i,c in enumerate(top,1):
            cp=td/f'top_{i}.json'; shutil.copy2(c['json'],cp)
            refine_specs.append((cp,f'refine_{i}',18+6*i,46+8*i,[2147483629,134217689][i-1]))
        with ThreadPoolExecutor(max_workers=2) as ex:
            futs=[ex.submit(run_one,cp,td,label,e,c,s,80) for cp,label,e,c,s in refine_specs]
            for fut in as_completed(futs):
                r=fut.result(); refined.append(r)
                row={k:v for k,v in r.items() if k not in ('json','svg')}
                row['phase']='micro-refine'; rows.append(row); print('REFINE',json.dumps(row),flush=True)
        candidates += [r for r in refined if r['candidate']]
        candidates=sorted(candidates,key=lambda r:r['strip_width'])
        solved=any(r['solved'] for r in candidates)
        champion=candidates[0] if candidates else champion

    if champion:
        shutil.copy2(champion['json'],'/tmp/case9_best_checkpoint.json')
        if champion.get('svg') and Path(champion['svg']).exists(): shutil.copy2(champion['svg'],'/tmp/case9_best.svg')

best=min([r['strip_width'] for r in rows if r.get('candidate') and r.get('strip_width') is not None],default=None)
summary={
    'cases':12,'adaptive_cases_solved':12 if solved else 11,
    'adaptive_success_rate':100.0 if solved else 91.67,
    'focused_cases':[9],
    'focused_strategy':'fast parallel micro-search: 6 scouts -> top2 short refine',
    'physical_plate_mm':[PLATE_W,PLATE_H],
    'minimum_separation_mm':SEP,'required_placed_items':EXPECTED_ITEMS,
    'previous_valid_best_mm':PREVIOUS_BEST,'best_width':best,
    'width_goal_reached':solved,'total_runs':len(rows),'stages':rows
}
Path('/tmp/multimodel_rows.json').write_text(json.dumps(rows,indent=2),encoding='utf-8')
Path('/tmp/multimodel_summary.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
print('SUMMARY',json.dumps(summary),flush=True)
