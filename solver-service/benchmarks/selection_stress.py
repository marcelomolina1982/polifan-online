import json, math, os, re, shutil, subprocess, tempfile
from itertools import combinations

ROOT=os.path.dirname(__file__)
FIX=os.path.join(ROOT,'polifan_benchmark_12.json')
SPARROW='/tmp/sparrow-bin'
MAX_WIDTH=1214.0
GAP='2.5'
SEEDS=[101,1297,4099]
BUDGET='4'

with open(FIX,'r',encoding='utf-8') as f:
    base=json.load(f)
items=base['items']
assert len(items)==24, f'expected 24 items, got {len(items)}'

# Benchmark assumption: the 24 contours are ordered as 12 base+tapa pairs.
pairs=[(items[i],items[i+1]) for i in range(0,24,2)]

def poly_area(item):
    pts=item['shape']['data']
    s=0.0
    for i,(x1,y1) in enumerate(pts):
        x2,y2=pts[(i+1)%len(pts)]
        s+=x1*y2-x2*y1
    return abs(s)/2.0

def pair_area(pair):
    return sum(poly_area(x) for x in pair)

def clone_pair(pair,new_pair_idx):
    out=[]
    for j,item in enumerate(pair):
        c=json.loads(json.dumps(item))
        c['id']=1000+new_pair_idx*2+j
        out.append(c)
    return tuple(out)

def run_subset(label, candidate_pairs, selected_indices, seed):
    chosen=[candidate_pairs[i] for i in selected_indices]
    payload={'name':label,'items':[]}
    for p in chosen:
        payload['items'].extend(p)
    td=tempfile.mkdtemp(prefix='sparrow-select-')
    try:
        inp=os.path.join(td,'input.json')
        with open(inp,'w',encoding='utf-8') as f: json.dump(payload,f,separators=(',',':'))
        p=subprocess.run([SPARROW,'-i',inp,'-t',BUDGET,'--min-item-separation',GAP,'--workers','1','-s',str(seed)],cwd=td,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=20)
        txt=p.stdout
        m=re.findall(r'best feasible solution: width: ([0-9.]+) \(([0-9.]+)%\)',txt)
        if not m:
            return 999999.0,0.0,p.returncode
        w,d=m[-1]
        return float(w),float(d),p.returncode
    finally:
        shutil.rmtree(td,ignore_errors=True)

def evaluate_case(name,candidate_pairs,subset_indices):
    rows=[]
    for rank,sel in enumerate(subset_indices,1):
        area=sum(pair_area(candidate_pairs[i]) for i in sel)
        widths=[]; densities=[]
        for seed in SEEDS:
            w,d,code=run_subset(f'{name}-r{rank}-s{seed}',candidate_pairs,sel,seed)
            widths.append(w); densities.append(d)
        feasible=sum(w<=MAX_WIDTH for w in widths)
        rows.append({'rank':rank,'selected':list(sel),'area':area,'feasible_runs':feasible,'worst_width':max(widths),'best_width':min(widths),'avg_width':sum(widths)/len(widths),'best_density':max(densities)})
        print(name,rows[-1],flush=True)
    rows.sort(key=lambda r:(-r['feasible_runs'],r['worst_width'],-r['area'],r['avg_width']))
    return rows

# 13 candidates = original 12 + duplicate of pair with median area.
areas=[pair_area(p) for p in pairs]
median_idx=sorted(range(12),key=lambda i:areas[i])[len(areas)//2]
c13=pairs+[clone_pair(pairs[median_idx],12)]
subs13=[tuple(i for i in range(13) if i!=drop) for drop in range(13)]
res13=evaluate_case('case13',c13,subs13)

# 14 candidates = original 12 + duplicates of one large-ish and one small-ish pair.
order=sorted(range(12),key=lambda i:areas[i])
extra_a=order[3]
extra_b=order[-3]
c14=pairs+[clone_pair(pairs[extra_a],12),clone_pair(pairs[extra_b],13)]
all14=[]
for sel in combinations(range(14),12):
    a=sum(pair_area(c14[i]) for i in sel)
    all14.append((a,sel))
# Preselector: evaluate top 24 area-maximizing subsets; enough to test whether area-first is geometrically sane.
all14.sort(reverse=True,key=lambda x:x[0])
subs14=[sel for _,sel in all14[:24]]
res14=evaluate_case('case14',c14,subs14)

summary={
  'assumption':'24 contours ordered as 12 base+tapa pairs',
  'gap_mm':2.5,
  'max_width_mm':MAX_WIDTH,
  'budget_s':int(BUDGET),
  'seeds':SEEDS,
  'case13':{'candidates':13,'evaluated_subsets':len(subs13),'best':res13[0]},
  'case14':{'candidates':14,'total_possible_subsets':math.comb(14,12),'evaluated_subsets':len(subs14),'best':res14[0]},
}
print('FINAL_SUMMARY='+json.dumps(summary,separators=(',',':')),flush=True)
with open('/tmp/selection_summary.json','w',encoding='utf-8') as f: json.dump(summary,f,indent=2)
