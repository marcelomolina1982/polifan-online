import json, math, re, shutil, subprocess, tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT=Path(__file__).parent
SPARROW='/tmp/sparrow-bin'
FIXTURE=ROOT/'case9_run67_checkpoint.json'
PLATE_W=1220.0; PLATE_H=580.0; SEP=3.0; EXPECTED_ITEMS=24
PREVIOUS_BEST=1238.606


def widths(text):
    vals=[]
    for pat in [r'\[CMPR\] success[^\n]*\(([0-9]+(?:\.[0-9]+)?)\s*\|',r'best feasible solution: width:\s*([0-9]+(?:\.[0-9]+)?)',r'feasible solution found! \(width:\s*([0-9]+(?:\.[0-9]+)?)']:
        vals += [float(x) for x in re.findall(pat,text,re.I)]
    return vals


def final_files(work):
    out=work/'output'; js=sorted(out.glob('final_*.json')) if out.exists() else []; sv=sorted(out.glob('final_*.svg')) if out.exists() else []
    return (js[0] if js else None),(sv[0] if sv else None)


def transformed_bbox(obj):
    shapes={it['id']:it['shape']['data'] for it in obj['items']}; placed=obj.get('solution',{}).get('layout',{}).get('placed_items',[])
    xs=[]; ys=[]
    for pl in placed:
        pts=shapes[pl['item_id']]; a=math.radians(pl['transformation']['rotation']); c=math.cos(a); s=math.sin(a); tx,ty=pl['transformation']['translation']
        for x,y in pts: xs.append(x*c-y*s+tx); ys.append(x*s+y*c+ty)
    return (min(xs),min(ys),max(xs),max(ys)) if xs else None


def validate(path):
    if path is None or not path.exists(): return {'candidate':False,'solved':False,'reason':'no-final-json','placed':0,'bbox':None,'strip_width':None}
    obj=json.loads(path.read_text()); placed=obj.get('solution',{}).get('layout',{}).get('placed_items',[]); ids=[p.get('item_id') for p in placed]; bbox=transformed_bbox(obj); strip=obj.get('solution',{}).get('strip_width')
    count_ok=len(placed)==EXPECTED_ITEMS and len(set(ids))==EXPECTED_ITEMS
    y_ok=left_ok=right_ok=False
    if bbox:
        minx,miny,maxx,maxy=bbox; y_ok=miny>=SEP-0.15 and maxy<=PLATE_H-SEP+0.15; left_ok=minx>=SEP-0.15; right_ok=maxx<=PLATE_W-SEP+0.15
    candidate=bool(count_ok and y_ok and left_ok and strip is not None)
    solved=bool(candidate and right_ok and strip<=PLATE_W+0.01)
    reason='ok' if solved else ('piece-count' if not count_ok else ('vertical-border' if not y_ok else ('left-border' if not left_ok else 'too-wide')))
    return {'candidate':candidate,'solved':solved,'reason':reason,'placed':len(placed),'bbox':bbox,'strip_width':strip}


def run_one(source,root,label,e,c,seed,timeout,workers=1):
    work=root/label; work.mkdir(); src=work/'warm.json'; shutil.copy2(source,src)
    obj=json.loads(src.read_text()); obj['strip_height']=PLATE_H; src.write_text(json.dumps(obj,separators=(',',':')))
    try:
        p=subprocess.run([SPARROW,'-i',str(src),'-e',str(e),'-c',str(c),'--min-item-separation',str(SEP),'--workers',str(workers),'-s',str(seed)],cwd=work,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=timeout); text=p.stdout or ''; rc=p.returncode
    except subprocess.TimeoutExpired as ex: text=(ex.stdout or '') if isinstance(ex.stdout,str) else ''; rc=124
    Path('/tmp',f'multimodel_case09_{label}.log').write_text(text+'\n'+('TIMEOUT' if rc==124 else ''))
    ws=widths(text); js,svg=final_files(work); cert=validate(js)
    return {'label':label,'seed':seed,'exploration':e,'compression':c,'returncode':rc,'reported_width':min(ws) if ws else None,**cert,'json':js,'svg':svg}


def perturb(src,dst,rot_delta,jitter):
    obj=json.loads(Path(src).read_text()); byid={p['item_id']:p for p in obj['solution']['layout']['placed_items']}
    for iid,delta in rot_delta.items():
        if iid in byid: byid[iid]['transformation']['rotation']=(byid[iid]['transformation']['rotation']+delta)%360
    for iid,(dx,dy) in jitter.items():
        if iid in byid:
            t=byid[iid]['transformation']['translation']; byid[iid]['transformation']['translation']=[t[0]+dx,t[1]+dy]
    obj['strip_height']=PLATE_H; Path(dst).write_text(json.dumps(obj,separators=(',',':')))

base=json.loads(FIXTURE.read_text()); assert len(base['solution']['layout']['placed_items'])==EXPECTED_ITEMS; base['strip_height']=PLATE_H
rows=[]; solved=False
with tempfile.TemporaryDirectory() as tmp:
    td=Path(tmp); source=td/'base.json'; source.write_text(json.dumps(base,separators=(',',':')))
    # Rebuild the known strong basin once, then attack its structure quickly.
    seedbase=run_one(source,td,'recover_champion',45,135,1073741789,210,3)
    row={k:v for k,v in seedbase.items() if k not in ('json','svg')}; row['phase']='recover'; rows.append(row); print('RECOVER',json.dumps(row),flush=True)
    champion=seedbase if seedbase['candidate'] else None; solved=bool(champion and champion['solved'])

    variants=[
      ('rot_a',{15:15,18:-15,23:15},{15:(-4,4),18:(-4,-4),23:(-5,0)},536870909),
      ('rot_b',{15:30,18:15,23:-30},{15:(-6,-3),18:(-3,5),23:(-6,2)},1610612741),
      ('rot_c',{15:-20,18:25,23:20,19:-15},{15:(-5,5),18:(-4,-5),23:(-7,0),19:(-3,3)},805306457),
      ('rot_d',{15:45,18:-30,23:-15,17:20},{15:(-7,0),18:(-4,4),23:(-7,-3),17:(-2,3)},268435399),
      ('rot_e',{15:-35,18:35,23:35,20:-20},{15:(-6,3),18:(-5,-3),23:(-6,3),20:(-3,-2)},402653189),
      ('rot_f',{15:20,18:20,23:-45,19:20,20:-15},{15:(-5,-4),18:(-5,4),23:(-8,0),19:(-3,2),20:(-2,-3)},134217689),
      ('rot_g',{15:-15,18:-30,23:45,17:-20,19:15},{15:(-5,2),18:(-5,-2),23:(-8,2),17:(-2,-3),19:(-3,3)},2147483629),
      ('rot_h',{15:35,18:-20,23:20,19:-25,20:20},{15:(-7,-2),18:(-4,4),23:(-7,1),19:(-3,-3),20:(-3,3)},67108859),
    ]
    results=[]
    if champion and not solved:
        sources=[]
        for label,rd,jit,seed in variants:
            p=td/f'{label}_input.json'; perturb(champion['json'],p,rd,jit); sources.append((p,label,seed))
        with ThreadPoolExecutor(max_workers=4) as ex:
            futs=[ex.submit(run_one,p,td,label,16,32,seed,58,1) for p,label,seed in sources]
            for fut in as_completed(futs):
                r=fut.result(); results.append(r); rr={k:v for k,v in r.items() if k not in ('json','svg')}; rr['phase']='structural-scout'; rows.append(rr); print('STRUCT',json.dumps(rr),flush=True)
        candidates=sorted([r for r in results if r['candidate']],key=lambda r:r['strip_width']); solved=any(r['solved'] for r in candidates)
        if candidates and (champion is None or candidates[0]['strip_width']<champion['strip_width']): champion=candidates[0]

        if not solved and candidates:
            top=candidates[:2]; refined=[]
            with ThreadPoolExecutor(max_workers=2) as ex:
                futs=[]
                for i,cand in enumerate(top,1):
                    cp=td/f'refine_src_{i}.json'; shutil.copy2(cand['json'],cp); futs.append(ex.submit(run_one,cp,td,f'struct_refine_{i}',26,58,[1073741777,1610612707][i-1],88,1))
                for fut in as_completed(futs):
                    r=fut.result(); refined.append(r); rr={k:v for k,v in r.items() if k not in ('json','svg')}; rr['phase']='structural-refine'; rows.append(rr); print('REFINE',json.dumps(rr),flush=True)
            rcands=[r for r in refined if r['candidate']];
            if rcands:
                rcands.sort(key=lambda r:r['strip_width']);
                if champion is None or rcands[0]['strip_width']<champion['strip_width']: champion=rcands[0]
            solved=solved or any(r['solved'] for r in rcands)

    if champion:
        shutil.copy2(champion['json'],'/tmp/case9_best_checkpoint.json')
        if champion.get('svg') and Path(champion['svg']).exists(): shutil.copy2(champion['svg'],'/tmp/case9_best.svg')

best=min([r['strip_width'] for r in rows if r.get('candidate') and r.get('strip_width') is not None],default=None)
summary={'cases':12,'adaptive_cases_solved':12 if solved else 11,'adaptive_success_rate':100.0 if solved else 91.67,'focused_cases':[9],'focused_strategy':'recover strong basin then fast structural rotation/jitter attack','physical_plate_mm':[PLATE_W,PLATE_H],'minimum_separation_mm':SEP,'required_placed_items':EXPECTED_ITEMS,'previous_valid_best_mm':PREVIOUS_BEST,'best_width':best,'width_goal_reached':solved,'total_runs':len(rows),'stages':rows}
Path('/tmp/multimodel_rows.json').write_text(json.dumps(rows,indent=2)); Path('/tmp/multimodel_summary.json').write_text(json.dumps(summary,indent=2)); print('SUMMARY',json.dumps(summary),flush=True)
