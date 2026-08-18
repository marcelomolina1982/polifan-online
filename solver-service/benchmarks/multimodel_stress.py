import base64,gzip,json,random,re,subprocess,tempfile,os,statistics
from pathlib import Path

ROOT=Path(__file__).resolve().parent
MODELS=json.loads(gzip.decompress(base64.b64decode((ROOT/'multimodel10.b64').read_text())).decode())
SPARROW='/tmp/sparrow-bin'
GAP=2.5
MAXW=1214.0
SEEDS=[101,1297,4099]
BUDGET=6

by_name={m['name']:m for m in MODELS}
ordered=sorted(MODELS,key=lambda m:m['area'])
small=ordered[:4]
mid=ordered[3:7]
large=ordered[6:]


def make_counts(rng,pool,total=12,min_distinct=4):
    for _ in range(1000):
        counts={m['name']:0 for m in MODELS}
        for _ in range(total):
            counts[rng.choice(pool)['name']]+=1
        used={k:v for k,v in counts.items() if v}
        if len(used)>=min_distinct:
            return used
    raise RuntimeError('could not make counts')

def build_case(name,counts):
    items=[]; iid=0; total_area=0.0
    for model_name,demand in sorted(counts.items()):
        m=by_name[model_name]
        total_area += m['area']*demand
        for part in m['parts']:
            items.append({'id':iid,'demand':demand,'shape':{'type':'simple_polygon','data':part['points']}})
            iid+=1
    return {'name':name,'items':items,'strip_height':580.0}, total_area

def run_case(case,seed):
    with tempfile.TemporaryDirectory() as td:
        inp=Path(td)/'case.json'; inp.write_text(json.dumps(case,separators=(',',':')))
        p=subprocess.run([SPARROW,'-i',str(inp),'-t',str(BUDGET),'--min-item-separation',str(GAP),'--workers','1','-s',str(seed)],cwd=td,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=20)
        mm=re.findall(r'best feasible solution: width: ([0-9.]+) \(([0-9.]+)%\)',p.stdout)
        if not mm:
            return {'seed':seed,'exit':p.returncode,'width':999999.0,'density':0.0,'success':False}
        w,d=map(float,mm[-1])
        return {'seed':seed,'exit':p.returncode,'width':w,'density':d,'success':w<=MAXW}

rng=random.Random(20260818)
cases=[]
for label,pool in [('small',small),('balanced',MODELS),('large',large),('mixed',small+large)]:
    for i in range(4):
        counts=make_counts(rng,pool)
        case,area=build_case(f'{label}-{i+1}',counts)
        cases.append((label,case,counts,area))

rows=[]
for label,case,counts,area in cases:
    runs=[run_case(case,s) for s in SEEDS]
    feasible=sum(r['success'] for r in runs)
    widths=[r['width'] for r in runs if r['width']<900000]
    densities=[r['density'] for r in runs]
    row={
        'case':case['name'],'class':label,'counts':counts,
        'figures':sum(counts.values()),'models':len(counts),
        'raw_area_pct':round(area/(1214.0*580.0)*100,2),
        'feasible_runs':feasible,'runs':len(runs),
        'best_width':round(min(widths),3) if widths else 999999,
        'worst_width':round(max(widths),3) if widths else 999999,
        'avg_width':round(statistics.mean(widths),3) if widths else 999999,
        'best_density':round(max(densities),3)
    }
    rows.append(row)
    print(json.dumps(row,ensure_ascii=False))

summary={
 'cases':len(rows),'runs':len(rows)*len(SEEDS),'budget_s':BUDGET,'gap_mm':GAP,
 'all3_success_cases':sum(r['feasible_runs']==3 for r in rows),
 'at_least1_success_cases':sum(r['feasible_runs']>0 for r in rows),
 'zero_success_cases':sum(r['feasible_runs']==0 for r in rows),
 'by_class':{}
}
for label in ['small','balanced','large','mixed']:
    rs=[r for r in rows if r['class']==label]
    summary['by_class'][label]={
      'cases':len(rs),'all3':sum(r['feasible_runs']==3 for r in rs),
      'some':sum(r['feasible_runs']>0 for r in rs),
      'avg_raw_area_pct':round(statistics.mean(r['raw_area_pct'] for r in rs),2)
    }
Path('/tmp/multimodel_rows.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2))
Path('/tmp/multimodel_summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2))
print('FINAL_SUMMARY='+json.dumps(summary,ensure_ascii=False))
