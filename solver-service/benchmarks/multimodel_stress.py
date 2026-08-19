import json, subprocess, tempfile, re, random
from pathlib import Path

ROOT = Path(__file__).parent
MODELS = json.loads((ROOT / 'multimodel10.json').read_text(encoding='utf-8'))
SPARROW = '/tmp/sparrow-bin'
MAX_WIDTH = 1214.0
STRIP_HEIGHT = 580.0
ATTEMPT_TIME = 6
BASE_SEEDS = [101,503,1297,1701,4099,7919,10009,17011,27183,48017,65537,99991]
# Extra compute is spent ONLY when the normal adaptive pass still fails.
EXTRA_SEEDS = [131071,196613,262147,393241,524287,786433,1048573,1572869,2097143,3145721,4194301,6291449,8388593,12582917,16777213,25165813,33554393,50331653]
random.seed(115)
names=list(MODELS)
assert len(names)>=5
cases=[[random.choice(names) for _ in range(12)] for __ in range(12)]

def poly_area(poly):
    if len(poly)<3:return 0.0
    return abs(sum(poly[i][0]*poly[(i+1)%len(poly)][1]-poly[(i+1)%len(poly)][0]*poly[i][1] for i in range(len(poly)))/2.0)

def model_stats(name):
    parts=MODELS[name]['parts']; xs=[p[0] for part in parts for p in part]; ys=[p[1] for part in parts for p in part]
    return {'area':sum(poly_area(part) for part in parts),'w':max(xs)-min(xs),'h':max(ys)-min(ys),'maxdim':max(max(xs)-min(xs),max(ys)-min(ys))}
STATS={n:model_stats(n) for n in names}

def strategic_order(base_order, attempt, seed, case_id):
    order=list(base_order)
    if attempt==1:return order,'official-original'
    strategies=[
      ('area-large-first',lambda n:(-STATS[n]['area'],-STATS[n]['maxdim'],n)),
      ('maxdim-large-first',lambda n:(-STATS[n]['maxdim'],-STATS[n]['area'],n)),
      ('wide-first',lambda n:(-STATS[n]['w'],STATS[n]['h'],n)),
      ('tall-first',lambda n:(-STATS[n]['h'],STATS[n]['w'],n)),
      ('area-small-first',lambda n:(STATS[n]['area'],STATS[n]['maxdim'],n)),
    ]
    idx=attempt-2
    if idx<len(strategies):
        label,key=strategies[idx]; return sorted(order,key=key),label
    if attempt==7:
        ranked=sorted(order,key=lambda n:(-STATS[n]['area'],-STATS[n]['maxdim'],n)); alt=[]; lo=0; hi=len(ranked)-1
        while lo<=hi:
            alt.append(ranked[lo]); lo+=1
            if lo<=hi:alt.append(ranked[hi]); hi-=1
        return alt,'large-small-alternating'
    rr=random.Random(case_id*1000003+seed*97+attempt*7919); rr.shuffle(order)
    return order,f'random-repair-{attempt}'

def make_input(order,out):
    items=[]; iid=0
    for model in order:
        parts=MODELS[model]['parts']
        for part in parts:
            items.append({'id':iid,'demand':1,'shape':{'type':'simple_polygon','data':part}}); iid+=1
    out.write_text(json.dumps({'name':'multimodel_real_order','strip_height':STRIP_HEIGHT,'items':items},separators=(',',':')),encoding='utf-8')

def parse_width(text):
    for pat in [r'best feasible width[^0-9]*([0-9]+(?:\.[0-9]+)?)',r'best[^\n]*width[^0-9]*([0-9]+(?:\.[0-9]+)?)',r'width[^0-9]*([0-9]+(?:\.[0-9]+)?)']:
        vals=[float(x) for x in re.findall(pat,text,re.I)]
        if vals:return min(vals)
    return None

def run_once(case_id,base_order,seed,attempt,seconds=ATTEMPT_TIME):
    order,strategy=strategic_order(base_order,attempt,seed,case_id)
    with tempfile.TemporaryDirectory() as tmp:
        td=Path(tmp); inp=td/'input.json'; make_input(order,inp)
        cmd=[SPARROW,'-i',str(inp),'-t',str(seconds),'--min-item-separation','2.5','--workers','1','-s',str(seed)]
        p=subprocess.run(cmd,cwd=td,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=max(30,seconds+20))
        log=p.stdout or ''; width=parse_width(log)
        (Path('/tmp')/f'multimodel_case{case_id:02d}_attempt{attempt:02d}_seed{seed}.log').write_text(log,encoding='utf-8')
        return {'case':case_id,'attempt':attempt,'seed':seed,'strategy':strategy,'ok':p.returncode==0 and width is not None and width<=MAX_WIDTH,'width':width,'returncode':p.returncode,'models':order,'seconds':seconds}

rows=[]; case_results=[]; official_solved=0
for case_id,base_order in enumerate(cases,1):
    best=None; solved=False; official=None; attempts=0
    for attempt,seed in enumerate(BASE_SEEDS,1):
        r=run_once(case_id,base_order,seed,attempt); rows.append(r); attempts+=1
        if attempt==1:
            official=r
            if r['ok']:official_solved+=1
        if r['width'] is not None and (best is None or r['width']<best['width']):best=r
        print(f"case={case_id:02d} attempt={attempt:02d} strategy={r['strategy']} ok={r['ok']} width={r['width']}",flush=True)
        if r['ok']:solved=True; break
    # Focused second stage: only unresolved cases get extra randomized repair.
    if not solved:
        start=len(BASE_SEEDS)+1
        for j,seed in enumerate(EXTRA_SEEDS,start):
            # Give the hardest candidates a little more local-search time without slowing solved cases.
            r=run_once(case_id,base_order,seed,j,seconds=8); rows.append(r); attempts+=1
            if r['width'] is not None and (best is None or r['width']<best['width']):best=r
            print(f"FOCUSED case={case_id:02d} attempt={j:02d} strategy={r['strategy']} ok={r['ok']} width={r['width']}",flush=True)
            if r['ok']:solved=True; break
    case_results.append({'case':case_id,'official_ok':bool(official and official['ok']),'official_width':official['width'] if official else None,'solved':solved,'attempts':attempts,'best_width':best['width'] if best else None,'best_seed':best['seed'] if best else None,'best_attempt':best['attempt'] if best else None,'best_strategy':best['strategy'] if best else None,'models':base_order})
    print('CASE_SUMMARY',json.dumps(case_results[-1],ensure_ascii=False),flush=True)
adaptive_solved=sum(x['solved'] for x in case_results); valid=[r['width'] for r in rows if r['width'] is not None]
summary={'models':names,'cases':len(cases),'official_cases_solved':official_solved,'official_success_rate':round(100*official_solved/len(cases),2),'adaptive_cases_solved':adaptive_solved,'adaptive_success_rate':round(100*adaptive_solved/len(cases),2),'adaptive_gain_cases':adaptive_solved-official_solved,'beats_official':adaptive_solved>official_solved,'total_runs':len(rows),'normal_attempts':len(BASE_SEEDS),'focused_extra_attempts':len(EXTRA_SEEDS),'best_width':min(valid) if valid else None,'worst_width':max(valid) if valid else None,'human_reference':{'plate_mm':[1220,580],'observed_used_bbox_mm':[1213.94,575.06],'bbox_plate_coverage_percent':98.66},'case_results':case_results}
Path('/tmp/multimodel_rows.json').write_text(json.dumps(rows,indent=2,ensure_ascii=False),encoding='utf-8'); Path('/tmp/multimodel_summary.json').write_text(json.dumps(summary,indent=2,ensure_ascii=False),encoding='utf-8'); print('SUMMARY',json.dumps(summary,ensure_ascii=False),flush=True)
