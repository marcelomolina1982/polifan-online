from nest_nfp2 import app, _allowed_region, _region_points, _valid
from flask import jsonify
from shapely.geometry import box
from shapely.affinity import translate

@app.get('/nest-nfp2/selftest')
def nest_nfp2_selftest():
    # Dos rectángulos grandes que necesariamente caben lado a lado con 3 mm.
    width,height,gap=1220.0,580.0,3.0
    first=box(0,0,300,250)
    moving=box(0,0,300,250)
    placed=[{'geom':first}]
    region=_allowed_region(moving,placed,width,height,gap)
    pts=_region_points(region,80)
    good=[]
    for x,y in pts:
        cand=translate(moving,xoff=x,yoff=y)
        if _valid(cand,placed,width,height,gap):
            good.append((round(x,3),round(y,3)))
            if len(good)>=5:break
    return jsonify(ok=bool(good),engine='NFP2',allowedEmpty=region.is_empty,candidateCount=len(pts),validCandidates=good)
