import json, math, re, shutil, subprocess, tempfile
from pathlib import Path

ROOT = Path(__file__).parent
SPARROW = '/tmp/sparrow-bin'
FIXTURE = ROOT / 'case9_run67_checkpoint.json'
PLATE_W = 1220.0
PLATE_H = 580.0
SEP = 3.0
EXPECTED_ITEMS = 24
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


def final_files(work):
    out=work/'output'
    js=list(out.glob('final_*.json')) if out.exists() else []
    sv=list(out.glob('final_*.svg')) if out.exists() else []
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
    if not xs: return None
    return (min(xs),min(ys),max(xs),max(ys))


def validate(path):
    if path is None or not path.exists():
        return {'valid':False,'reason':'no-final-json','placed':0,'bbox':None}
    obj=json.loads(path.read_text(encoding='utf-8'))
    placed=obj.get('solution',{}).get('layout',{}).get('placed_items',[])
    ids=[p.get('item_id') for p in placed]
    bbox=transformed_bbox(obj)
    count_ok=len(placed)==EXPECTED_ITEMS and len(set(ids))==EXPECTED_ITEMS
    # Sparrow's --min-item-separation=3 applies the 3 mm border margin to the physical container.
    border_ok=False
    if bbox:
        minx,miny,maxx,maxy=bbox
        border_ok=(minx>=SEP-0.15 and miny>=SEP-0.15 and maxx<=PLATE_W-SEP+0.15 and maxy<=PLATE_H-SEP+0.15)
    return {'valid':bool(count_ok and border_ok),'reason':'ok' if count_ok and border_ok else ('piece-count' if not count_ok else 'border'),'placed':len(placed),'bbox':bbox}


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
assert len(base['solution']['layout']['placed_items'])==EXPECTED_ITEMS, 'fixture must contain all 24 pieces'
base['strip_height']=PLATE_H
rows=[]; solved=False; champion=None

# Full 24-piece warm starts only. The first run gives Sparrow the real 580 mm physical height.
plans=[
    ('full24-height-release',35,115,536870909),
    ('full24-alt-basin',45,135,1073741789),
    ('full24-deep',60,165,1610612741),
]

with tempfile.TemporaryDirectory() as tmp:
    td=Path(tmp)
    source=td/'base.json'; source.write_text(json.dumps(base,separators=(',',':')),encoding='utf-8')
    best_w=None
    for i,(label,explore,compress,seed) in enumerate(plans,1):
        if solved: break
        work=td/f'run_{i:02d}'; work.mkdir()
        src=work/'warm.json'
        if champion and champion.get('checkpoint'):
            shutil.copy2(champion['checkpoint'],src)
            # keep physical height explicit on every chained warm start
            tmpobj=json.loads(src.read_text(encoding='utf-8')); tmpobj['strip_height']=PLATE_H
            src.write_text(json.dumps(tmpobj,separators=(',',':')),encoding='utf-8')
        else:
            shutil.copy2(source,src)
        rc,w,text=run([SPARROW,'-i',str(src),'-e',str(explore),'-c',str(compress),'--min-item-separation',str(SEP),'--workers','3','-s',str(seed)],work,f'multimodel_case09_full24_{i:02d}.log',explore+compress+55)
        js,svg=final_files(work)
        cert=validate(js)
        actual_strip=None
        if js and js.exists():
            actual_strip=json.loads(js.read_text(encoding='utf-8')).get('solution',{}).get('strip_width')
        success=bool(cert['valid'] and actual_strip is not None and actual_strip<=PLATE_W+0.01)
        row={'stage':i,'phase':'full24-physical-plate','label':label,'seed':seed,'returncode':rc,'reported_width':w,'strip_width':actual_strip,'placed':cert['placed'],'bbox':cert['bbox'],'certificate':cert['reason'],'solved':success,'exploration':explore,'compression':compress}
        rows.append(row); print('FULL24',json.dumps(row),flush=True)
        if cert['valid'] and actual_strip is not None and (best_w is None or actual_strip<best_w):
            best_w=actual_strip
            cp=td/'champion.json'; shutil.copy2(js,cp)
            sp=None
            if svg is not None:
                sp=td/'champion.svg'; shutil.copy2(svg,sp)
            champion={'width':actual_strip,'checkpoint':cp,'svg':sp}
        solved=success

    if champion:
        shutil.copy2(champion['checkpoint'],'/tmp/case9_best_checkpoint.json')
        if champion.get('svg') and Path(champion['svg']).exists(): shutil.copy2(champion['svg'],'/tmp/case9_best.svg')

best=min([r['strip_width'] for r in rows if r.get('strip_width') is not None and r.get('placed')==EXPECTED_ITEMS],default=None)
summary={
    'cases':12,
    'adaptive_cases_solved':12 if solved else 11,
    'adaptive_success_rate':100.0 if solved else 91.67,
    'focused_cases':[9],
    'focused_strategy':'strict full-24 warm search on physical plate; no partial-solution false positives',
    'physical_plate_mm':[PLATE_W,PLATE_H],
    'minimum_separation_mm':SEP,
    'required_placed_items':EXPECTED_ITEMS,
    'previous_valid_best_mm':PREVIOUS_BEST,
    'best_width':best,
    'width_goal_reached':solved,
    'total_runs':len(rows),
    'stages':rows
}
Path('/tmp/multimodel_rows.json').write_text(json.dumps(rows,indent=2),encoding='utf-8')
Path('/tmp/multimodel_summary.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
print('SUMMARY',json.dumps(summary),flush=True)
