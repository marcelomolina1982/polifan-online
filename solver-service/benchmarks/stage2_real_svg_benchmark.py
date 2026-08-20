import json, math, os, re, shutil, subprocess, tempfile, time
from pathlib import Path

ROOT=Path(__file__).parent
MODELS=json.loads((ROOT/'real_models_stage2.json').read_text())
SPARROW='/tmp/sparrow-bin'
PLATE_W=1220.0
PLATE_H=580.0
SEP=3.0
MODEL=os.environ.get('MODEL','Mate')
COUNT=int(os.environ.get('COUNT','10'))
SEED=int(os.environ.get('SEED','20260820')) + COUNT*101 + sum(map(ord,MODEL))
TIMEOUT=int(os.environ.get('SOLVER_TIMEOUT','105'))


def transformed_bbox(obj):
    shapes={it['id']:it['shape']['data'] for it in obj.get('items',[])}
    placed=obj.get('solution',{}).get('layout',{}).get('placed_items',[])
    xs=[]; ys=[]
    for pl in placed:
        pts=shapes.get(pl.get('item_id'),[])
        tr=pl.get('transformation',{})
        a=math.radians(float(tr.get('rotation',0.0)))
        c=math.cos(a); s=math.sin(a)
        tx,ty=tr.get('translation',[0.0,0.0])
        for x,y in pts:
            xs.append(x*c-y*s+tx); ys.append(x*s+y*c+ty)
    return (min(xs),min(ys),max(xs),max(ys)) if xs else None


def build_input(model,count):
    m=MODELS[model]
    items=[]; iid=0
    for _ in range(count):
        for part in m['parts'][:2]:
            items.append({'id':iid,'shape':{'type':'simple_polygon','data':part['points']},'min_quality':None,'demand':1})
            iid+=1
    return {'name':f'stage2_{re.sub(r"[^a-z0-9]+","_",model.lower()).strip("_")}_{count}','items':items,'strip_height':PLATE_H}


def find_final(work):
    out=work/'output'
    js=sorted(out.glob('final_*.json')) if out.exists() else []
    sv=sorted(out.glob('final_*.svg')) if out.exists() else []
    return (js[0] if js else None),(sv[0] if sv else None)

if MODEL not in MODELS:
    raise SystemExit(f'unknown MODEL={MODEL}')

inp=build_input(MODEL,COUNT)
expected=COUNT*2
part_area=sum(float(p['area_mm2']) for p in MODELS[MODEL]['parts'][:2])
material_area=part_area*COUNT
plate_area=PLATE_W*PLATE_H
start=time.monotonic()
rc=None; text=''; final_json=None; final_svg=None
with tempfile.TemporaryDirectory() as tmp:
    work=Path(tmp); src=work/'input.json'; src.write_text(json.dumps(inp,separators=(',',':')))
    cmd=[SPARROW,'-i',str(src),'-e','20','-c','48','--min-item-separation',str(SEP),'--workers','2','-s',str(SEED)]
    try:
        p=subprocess.run(cmd,cwd=work,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=TIMEOUT)
        rc=p.returncode; text=p.stdout or ''
    except subprocess.TimeoutExpired as ex:
        rc=124; text=ex.stdout if isinstance(ex.stdout,str) else ''
    elapsed=round(time.monotonic()-start,3)
    js,svg=find_final(work)
    obj=json.loads(js.read_text()) if js else None
    if js:
        final_json=Path('/tmp')/f'stage2_{re.sub(r"[^a-z0-9]+","_",MODEL.lower()).strip("_")}_{COUNT}_final.json'
        shutil.copy2(js,final_json)
    if svg:
        final_svg=Path('/tmp')/f'stage2_{re.sub(r"[^a-z0-9]+","_",MODEL.lower()).strip("_")}_{COUNT}_final.svg'
        shutil.copy2(svg,final_svg)

bbox=transformed_bbox(obj) if obj else None
placed=obj.get('solution',{}).get('layout',{}).get('placed_items',[]) if obj else []
ids=[p.get('item_id') for p in placed]
count_ok=(len(placed)==expected and len(set(ids))==expected)
strip_width=(obj.get('solution',{}).get('strip_width') if obj else None)
inside=False
if bbox:
    minx,miny,maxx,maxy=bbox
    inside=(minx>=SEP-0.2 and miny>=SEP-0.2 and maxx<=PLATE_W-SEP+0.2 and maxy<=PLATE_H-SEP+0.2)
valid=bool(rc==0 and count_ok and inside and strip_width is not None and float(strip_width)<=PLATE_W+0.05)
material_util=100.0*material_area/plate_area
strip_util=(100.0*material_area/(float(strip_width)*PLATE_H)) if strip_width else None
result={
  'stage':'real-svg-stage2','model':MODEL,'count_complete':COUNT,'parts_expected':expected,'parts_placed':len(placed),
  'valid_fit':valid,'returncode':rc,'elapsed_s':elapsed,'plate_mm':[PLATE_W,PLATE_H],'separation_mm':SEP,
  'strip_width_mm':round(float(strip_width),3) if strip_width is not None else None,
  'bbox_mm':[round(float(v),3) for v in bbox] if bbox else None,
  'material_area_mm2':round(material_area,3),'plate_utilization_pct':round(material_util,3),
  'plate_waste_pct':round(100.0-material_util,3),'strip_material_efficiency_pct':round(strip_util,3) if strip_util is not None else None,
  'beats_10_by_count':COUNT>10 and valid,
  'source_svg':MODELS[MODEL]['source_svg'],
  'error':None if valid else ('timeout' if rc==124 else ('missing-final' if obj is None else ('piece-count' if not count_ok else ('outside-plate' if not inside else 'too-wide'))))
}
slug=re.sub(r'[^a-z0-9]+','_',MODEL.lower()).strip('_')
out=Path('/tmp')/f'stage2_result_{slug}_{COUNT}.json'
out.write_text(json.dumps(result,indent=2))
Path('/tmp')/f'stage2_log_{slug}_{COUNT}.txt'
(Path('/tmp')/f'stage2_log_{slug}_{COUNT}.txt').write_text(text)
print('RESULT',json.dumps(result),flush=True)
