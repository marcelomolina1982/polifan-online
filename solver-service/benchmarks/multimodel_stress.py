import json, math, re, shutil, subprocess, tempfile
from pathlib import Path

ROOT = Path(__file__).parent
SPARROW = '/tmp/sparrow-bin'
FIXTURE = ROOT / 'case9_run67_checkpoint.json'
MAX_WIDTH = 1214.0
MAX_HEIGHT = 574.0
SEP = 3.0
PREVIOUS_BEST = 1248.347


def widths(text):
    vals=[]
    for pat in [
        r'\[CMPR\] success[^\n]*\(([0-9]+(?:\.[0-9]+)?)\s*\|',
        r'best feasible solution: width:\s*([0-9]+(?:\.[0-9]+)?)',
        r'feasible solution found! \(width:\s*([0-9]+(?:\.[0-9]+)?)'
    ]:
        vals += [float(x) for x in re.findall(pat,text,re.I)]
    return vals


def bbox_right(obj, placed):
    shapes={it['id']:it['shape']['data'] for it in obj['items']}
    right=0.0
    for pl in placed:
        pts=shapes[pl['item_id']]
        a=math.radians(pl['transformation']['rotation']); c=math.cos(a); s=math.sin(a)
        tx,ty=pl['transformation']['translation']
        right=max(right,max(x*c-y*s+tx for x,y in pts))
    return right


def final_files(work):
    out=work/'output'
    js=list(out.glob('final_*.json')) if out.exists() else []
    sv=list(out.glob('final_*.svg')) if out.exists() else []
    return (js[0] if js else None),(sv[0] if sv else None)


def run(args,work,log,timeout):
    try:
        p=subprocess.run(args,cwd=work,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=timeout)
        text=p.stdout or ''
        Path('/tmp',log).write_text(text,encoding='utf-8')
        ws=widths(text)
        return p.returncode,(min(ws) if ws else None),text
    except subprocess.TimeoutExpired as e:
        text=(e.stdout or '') if isinstance(e.stdout,str) else ''
        Path('/tmp',log).write_text(text+'\nTIMEOUT',encoding='utf-8')
        ws=widths(text)
        return 124,(min(ws) if ws else None),text


base=json.loads(FIXTURE.read_text(encoding='utf-8'))
original=list(base['solution']['layout']['placed_items'])
# The three pieces actually forming the right edge are 15, 23 and 18.
# Adjacent variants release one/two neighbours so Sparrow can cross the local basin.
variants=[
    ('edge3',[15,18,23],536870909),
    ('edge4-left',[15,18,19,23],268435399),
    ('edge4-up',[15,17,18,23],805306457),
    ('edge5',[15,18,19,20,23],1073741789),
]
rows=[]; candidates=[]; solved=False

with tempfile.TemporaryDirectory() as tmp:
    td=Path(tmp)
    for i,(label,release,seed) in enumerate(variants,1):
        work=td/f'surgical_{i:02d}'; work.mkdir()
        obj=json.loads(json.dumps(base))
        kept=[p for p in original if p['item_id'] not in set(release)]
        obj['name']=f'case9_surgical_{label}'
        obj['solution']['layout']['placed_items']=kept
        fixed_right=bbox_right(obj,kept)
        # Give the partial layout only a small tail beyond its frozen right edge.
        # Missing items remain in `items` and are the only pieces Sparrow needs to repair.
        obj['solution']['strip_width']=min(PREVIOUS_BEST,max(fixed_right+80.0,MAX_WIDTH+8.0))
        obj['solution']['layout']['density']=0.0
        obj['solution']['density']=0.0
        inp=work/'partial.json'; inp.write_text(json.dumps(obj,separators=(',',':')),encoding='utf-8')
        rc,w,text=run([SPARROW,'-i',str(inp),'-e','22','-c','68','--min-item-separation',str(SEP),'--workers','3','-s',str(seed)],work,f'multimodel_case09_surgical_{i:02d}.log',125)
        js,svg=final_files(work)
        row={'stage':i,'phase':'surgical-scout','label':label,'released':release,'fixed_right':round(fixed_right,3),'seed':seed,'returncode':rc,'width':w,'improves_previous':bool(w is not None and w<PREVIOUS_BEST),'solved':bool(w is not None and w<=MAX_WIDTH)}
        rows.append(row); print('SURGICAL',json.dumps(row),flush=True)
        if w is not None and js is not None:
            cp=td/f'cand_{i}.json'; shutil.copy2(js,cp)
            sp=None
            if svg is not None: sp=td/f'cand_{i}.svg'; shutil.copy2(svg,sp)
            candidates.append({'width':w,'label':label,'checkpoint':cp,'svg':sp,'seed':seed})
        if row['solved']:
            solved=True; break

    candidates.sort(key=lambda c:c['width'])
    champion=candidates[0] if candidates else None

    # Only a real improvement receives one deeper repair/compression pass.
    if not solved and champion and champion['width'] < PREVIOUS_BEST:
        work=td/'surgical_refine'; work.mkdir()
        src=work/'warm.json'; shutil.copy2(champion['checkpoint'],src)
        rc,w,text=run([SPARROW,'-i',str(src),'-e','35','-c','125','--min-item-separation',str(SEP),'--workers','3','-s','1610612741'],work,'multimodel_case09_surgical_refine.log',205)
        js,svg=final_files(work)
        row={'stage':len(rows)+1,'phase':'surgical-refine','source':champion['label'],'seed':1610612741,'returncode':rc,'width':w,'improves_previous':bool(w is not None and w<PREVIOUS_BEST),'solved':bool(w is not None and w<=MAX_WIDTH)}
        rows.append(row); print('SURGICAL_REFINE',json.dumps(row),flush=True)
        if w is not None and js is not None and w < champion['width']:
            cp=td/'refined.json'; shutil.copy2(js,cp)
            sp=None
            if svg is not None: sp=td/'refined.svg'; shutil.copy2(svg,sp)
            champion={'width':w,'label':champion['label'],'checkpoint':cp,'svg':sp,'seed':1610612741}
        solved=bool(w is not None and w<=MAX_WIDTH)

    if champion:
        shutil.copy2(champion['checkpoint'],'/tmp/case9_best_checkpoint.json')
        if champion.get('svg') and Path(champion['svg']).exists(): shutil.copy2(champion['svg'],'/tmp/case9_best.svg')

best=min([r['width'] for r in rows if r.get('width') is not None],default=None)
summary={
    'cases':12,
    'adaptive_cases_solved':12 if solved else 11,
    'adaptive_success_rate':100.0 if solved else 91.67,
    'focused_cases':[9],
    'focused_strategy':'surgical right-edge destroy/repair from run67 checkpoint',
    'physical_plate_mm':[1220.0,580.0],
    'certifiable_bbox_mm':[MAX_WIDTH,MAX_HEIGHT],
    'minimum_separation_mm':SEP,
    'previous_valid_best_mm':PREVIOUS_BEST,
    'best_width':best,
    'width_goal_reached':solved,
    'total_runs':len(rows),
    'stages':rows
}
Path('/tmp/multimodel_rows.json').write_text(json.dumps(rows,indent=2),encoding='utf-8')
Path('/tmp/multimodel_summary.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
print('SUMMARY',json.dumps(summary),flush=True)
