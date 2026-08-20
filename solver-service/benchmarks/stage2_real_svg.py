import argparse, json, math, os, shutil, subprocess, tempfile, time
from pathlib import Path

ROOT = Path(__file__).parent
DATA = ROOT / 'real-svg-stage2' / 'batch1_polygons.json'
PLATE_W = 1220.0
PLATE_H = 580.0
SEP = 3.0
PLATE_AREA = PLATE_W * PLATE_H
SPARROW = os.environ.get('SPARROW_BIN', '/tmp/sparrow-bin')


def polygon_area(pts):
    s = 0.0
    for (x1,y1),(x2,y2) in zip(pts, pts[1:]+pts[:1]):
        s += x1*y2 - x2*y1
    return abs(s) * 0.5


def final_json(work):
    out = work / 'output'
    files = sorted(out.glob('final_*.json')) if out.exists() else []
    return files[0] if files else None


def build_instance(model, pieces, qty):
    items=[]
    for i,p in enumerate(pieces):
        items.append({
            'id': i,
            'demand': qty,
            'allowed_orientations': [float(x) for x in range(0,360,15)],
            'shape': {'type':'simple_polygon','data':p['pts']},
        })
    return {'name':f"stage2_{Path(model).stem}_{qty}", 'items':items, 'strip_height':PLATE_H}


def validate(path, qty):
    if not path or not path.exists():
        return {'placed':0,'strip_width':None,'fits':False,'reason':'no-final-json'}
    obj=json.loads(path.read_text())
    placed=obj.get('solution',{}).get('layout',{}).get('placed_items',[])
    width=obj.get('solution',{}).get('strip_width')
    expected=qty*2
    fits=(len(placed)==expected and width is not None and width <= PLATE_W + 0.01)
    reason='ok' if fits else ('piece-count' if len(placed)!=expected else 'too-wide')
    return {'placed':len(placed),'strip_width':width,'fits':fits,'reason':reason}


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--model', required=True)
    ap.add_argument('--qty', type=int, required=True)
    ap.add_argument('--exploration', type=int, default=28)
    ap.add_argument('--compression', type=int, default=22)
    ap.add_argument('--seed', type=int, default=20260820)
    args=ap.parse_args()

    data=json.loads(DATA.read_text())
    pieces=data[args.model]
    pair_area=sum(polygon_area(p['pts']) for p in pieces)
    utilization=(pair_area*args.qty/PLATE_AREA)*100.0
    baseline10=(pair_area*10/PLATE_AREA)*100.0
    inst=build_instance(args.model,pieces,args.qty)

    with tempfile.TemporaryDirectory() as td0:
        td=Path(td0)
        ip=td/'input.json'; ip.write_text(json.dumps(inst,separators=(',',':')))
        t0=time.time()
        try:
            p=subprocess.run([
                SPARROW,'-i',str(ip),'-e',str(args.exploration),'-c',str(args.compression),
                '--min-item-separation',str(SEP),'--workers','2','-s',str(args.seed)
            ],cwd=td,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=args.exploration+args.compression+35)
            rc=p.returncode; log=p.stdout or ''
        except subprocess.TimeoutExpired as ex:
            rc=124; log=(ex.stdout or '') if isinstance(ex.stdout,str) else ''
        elapsed=time.time()-t0
        fj=final_json(td)
        cert=validate(fj,args.qty)
        result={
            'model':args.model,'qty':args.qty,'complete_figures':args.qty if cert['fits'] else 0,
            'pair_area_mm2':round(pair_area,2),'plate_area_mm2':PLATE_AREA,
            'material_utilization_pct':round(utilization,2),
            'baseline_10_utilization_pct':round(baseline10,2),
            'waste_pct':round(100-utilization,2),
            'placed':cert['placed'],'expected_pieces':args.qty*2,
            'strip_width_mm':cert['strip_width'],'fits_1220x580':cert['fits'],
            'reason':cert['reason'],'elapsed_s':round(elapsed,2),'returncode':rc,
        }
        Path('/tmp/stage2_result.json').write_text(json.dumps(result,indent=2))
        Path('/tmp/stage2_console.txt').write_text(log)
        if fj and fj.exists(): shutil.copy2(fj,'/tmp/stage2_final.json')
        svg=sorted((td/'output').glob('final_*.svg')) if (td/'output').exists() else []
        if svg: shutil.copy2(svg[0],'/tmp/stage2_final.svg')
        print('STAGE2',json.dumps(result),flush=True)

if __name__=='__main__':
    main()
