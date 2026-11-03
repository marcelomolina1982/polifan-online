"""Isolated smoke test; synthetic rectangles, never production orders."""
from shapely.geometry import box
from ironnest_benchmark_app import _run_ironnest, br

def main():
    kits=[]
    for i in range(10):
        kits.append({'kitId':f'test-{i}','parts':[
            {'instanceId':f'test-{i}-a','geom':box(0,0,70,70),'allowRotate':True},
            {'instanceId':f'test-{i}-b','geom':box(0,0,70,70),'allowRotate':True}
        ]})
    placed,missing,elapsed,total,_=_run_ironnest(kits,job_id='synthetic-smoke',settings={
        'strategy':'sampling','budget':24,'restarts':1,'separation_effort':'fast'
    },timeout_seconds=110)
    assert total==20, (total,missing)
    assert len(placed)==20 and not missing, (len(placed),missing)
    assert br.PLATE_WIDTH_MM==1230 and br.PLATE_HEIGHT_MM==580
    print(f'SMOKE_OK 20/20 synthetic parts placed in {elapsed}s')

if __name__=='__main__':
    main()
