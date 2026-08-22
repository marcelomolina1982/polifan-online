"""U-Nesting 0.7.2 adapter for the isolated TVT V9 portfolio.

U-Nesting is only a candidate generator. Every returned layout must still pass the
existing TVT/Jagua independent production certificate before it can win.
"""
from __future__ import annotations
import ctypes,json,os

LIB=os.environ.get('UNESTING_LIB','/usr/local/lib/libu_nesting.so')
STRATEGIES=('ga','brkga','alns','gdrr')

def available():
    return os.path.exists(LIB)

def _load():
    lib=ctypes.CDLL(LIB)
    lib.unesting_solve.argtypes=[ctypes.c_char_p,ctypes.POINTER(ctypes.c_void_p)]
    lib.unesting_solve.restype=ctypes.c_int
    lib.unesting_free_string.argtypes=[ctypes.c_void_p]
    return lib

def _poly(part):
    g=part['geom']; minx,miny,_,_=g.bounds
    return [[float(x-minx),float(y-miny)] for x,y in list(g.exterior.coords)[:-1]]

def solve(prepared_kits,strategy='alns',time_limit_ms=30000):
    if strategy not in STRATEGIES: raise ValueError('unsupported U-Nesting strategy')
    if not available(): return {'ok':False,'engine':'u-nesting','error':'ffi library unavailable'}
    geometries=[];part_by_id={}
    for kit in prepared_kits:
        for p in kit.get('parts') or []:
            iid=str(p['instanceId']); part_by_id[iid]=p
            geometries.append({'id':iid,'polygon':_poly(p),'quantity':1,'rotations':[0,15,30,45,60,75,90,105,120,135,150,165,180,195,210,225,240,255,270,285,300,315,330,345]})
    req={'mode':'2d','geometries':geometries,'boundary':{'width':1220.0,'height':580.0},'config':{'spacing':3.0,'margin':0.0,'strategy':strategy,'time_limit_ms':int(time_limit_ms)}}
    lib=_load(); out=ctypes.c_void_p()
    rc=lib.unesting_solve(json.dumps(req,separators=(',',':')).encode(),ctypes.byref(out))
    if not out.value:return {'ok':False,'engine':'u-nesting','strategy':strategy,'error':f'ffi rc={rc} no response'}
    try: data=json.loads(ctypes.string_at(out.value).decode())
    finally: lib.unesting_free_string(out)
    placements=[]
    for row in data.get('placements') or []:
        iid=str(row.get('id') or ''); p=part_by_id.get(iid)
        if not p:continue
        placements.append({'instanceId':iid,'kitId':p['kitId'],'figure':p['figure'],'name':p['name'],'role':p['role'],'xCm':float(row.get('x') or 0)/10.0,'yCm':float(row.get('y') or 0)/10.0,'angle':float(row.get('rotation') or 0),'trimXCm':float(p.get('trimXmm') or 0)/10.0,'trimYCm':float(p.get('trimYmm') or 0)/10.0,'partialExtra':False})
    return {'ok':bool(data.get('success',rc==0)),'engine':'u-nesting-0.7.2','strategy':strategy,'placements':placements,'raw':data}
