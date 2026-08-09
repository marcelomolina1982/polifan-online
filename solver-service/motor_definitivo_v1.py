from __future__ import annotations
from dataclasses import dataclass, field
from pathlib import Path
import copy, io, json, math, random, tempfile, time
import xml.etree.ElementTree as ET
import cairosvg
import cv2
import numpy as np
from PIL import Image
from shapely import affinity
from shapely.geometry import Polygon
from shapely.ops import unary_union

SVGNS='http://www.w3.org/2000/svg'
ET.register_namespace('',SVGNS)
PLATE_W=1220.0
PLATE_H=580.0
PREFERRED_GAP=3.0
MIN_GAP=2.5
SEARCH_SAFETY=0.5
DRAWABLE={'path','rect','circle','ellipse','polygon','polyline','line','use'}
IGNORE={'defs','metadata','namedview','title','desc','text','tspan'}

def tag(el): return el.tag.split('}')[-1]

def blacken(el):
    t=tag(el)
    if t in DRAWABLE:
        el.set('fill','#000000')
        el.set('stroke','#000000' if t in {'line','polyline'} else 'none')
        el.set('stroke-width','0.5' if t in {'line','polyline'} else '0')
        el.set('style',el.attrib.get('style','')+';fill:#000000;stroke:none;stroke-width:0')
    for c in list(el): blacken(c)

def viewbox(root):
    try:
        v=[float(x) for x in root.attrib.get('viewBox','').replace(',',' ').split()]
        if len(v)==4:return tuple(v)
    except: pass
    return (0.0,0.0,1230.0,580.0)

def container(root):
    for wanted in ('layer1','CORTE'):
        x=next((e for e in root.iter() if e.attrib.get('id')==wanted),None)
        if x is not None and len(list(x)): return x
    groups=[e for e in root.iter() if tag(e)=='g' and len(list(e))]
    if groups:
        groups.sort(key=lambda g:sum(tag(c) not in IGNORE for c in list(g)),reverse=True)
        if sum(tag(c) not in IGNORE for c in list(groups[0]))>1:return groups[0]
    return root

def raster_geom(root,defs,element,ppm=1.0):
    vx,vy,vw,vh=viewbox(root)
    nr=ET.Element(f'{{{SVGNS}}}svg',{'width':f'{vw}mm','height':f'{vh}mm','viewBox':f'{vx} {vy} {vw} {vh}'})
    for d in defs:nr.append(copy.deepcopy(d))
    cc=copy.deepcopy(element);blacken(cc);nr.append(cc)
    png=cairosvg.svg2png(bytestring=ET.tostring(nr),output_width=max(1,round(vw*ppm)),output_height=max(1,round(vh*ppm)),background_color='white')
    gray=np.array(Image.open(io.BytesIO(png)).convert('L'))
    mask=(gray<128).astype(np.uint8)*255
    contours,hier=cv2.findContours(mask,cv2.RETR_CCOMP,cv2.CHAIN_APPROX_SIMPLE)
    polys=[]
    if hier is not None:
        hier=hier[0]
        for k,cnt in enumerate(contours):
            if hier[k][3]!=-1 or len(cnt)<3:continue
            shell=cnt[:,0,:].astype(float)/ppm;shell[:,0]+=vx;shell[:,1]+=vy
            holes=[];child=hier[k][2]
            while child!=-1:
                h=contours[child]
                if len(h)>=3:
                    hp=h[:,0,:].astype(float)/ppm;hp[:,0]+=vx;hp[:,1]+=vy;holes.append(hp)
                child=hier[child][0]
            p=Polygon(shell,holes)
            if not p.is_valid:p=p.buffer(0)
            if not p.is_empty and p.area>0.1:polys.append(p)
    return unary_union(polys) if polys else Polygon()

@dataclass
class Piece:
    pid:str
    geom:object
    members:list[ET.Element]=field(default_factory=list)
    matrix:np.ndarray=field(default_factory=lambda:np.eye(3))
    def clone(self):return Piece(self.pid,self.geom,self.members,self.matrix.copy())

def extract(svg_path,ppm=1.0):
    tree=ET.parse(svg_path);root=tree.getroot();defs=[copy.deepcopy(c) for c in root if tag(c)=='defs']
    children=[]
    for c in list(container(root)):
        if tag(c) in IGNORE:continue
        if c.attrib.get('display')=='none' or 'display:none' in c.attrib.get('style',''):continue
        children.append(c)
    raw=[]
    for i,ch in enumerate(children):
        g=raster_geom(root,defs,ch,ppm)
        if not g.is_empty and g.area>0.5:raw.append(Piece(ch.attrib.get('id',f'p{i}'),g,[copy.deepcopy(ch)]))
    order=sorted(range(len(raw)),key=lambda i:raw[i].geom.area,reverse=True);keep=[];parent={}
    for i in order:
        g=raw[i].geom;assigned=None
        for k in keep:
            G=raw[k].geom
            if G.area<g.area*1.4:continue
            try:ratio=g.intersection(G).area/max(g.area,1e-9)
            except:ratio=0
            if ratio>0.94:assigned=k;break
        if assigned is None:keep.append(i)
        else:parent[i]=assigned
    pieces=[];lookup={}
    for i in sorted(keep):
        p=raw[i].clone();pieces.append(p);lookup[i]=p
    for i,k in parent.items():lookup[k].members.extend(raw[i].members)
    return root,defs,pieces,len(parent)

def T_translate(dx,dy):return np.array([[1.,0.,dx],[0.,1.,dy],[0.,0.,1.]])
def T_rotate(deg,cx,cy):
    a=math.radians(deg);c,s=math.cos(a),math.sin(a);R=np.array([[c,-s,0.],[s,c,0.],[0.,0.,1.]])
    return T_translate(cx,cy)@R@T_translate(-cx,-cy)

def compact_seed(pieces):
    allg=unary_union([p.geom for p in pieces]);minx,miny,maxx,maxy=allg.bounds;spanx,spany=maxx-minx,maxy-miny;ex=max(0.,spanx-PLATE_W);out=[]
    for p in pieces:
        q=p.clone();cx=q.geom.centroid.x;frac=(cx-minx)/spanx if spanx else 0;dx=-minx-ex*frac;dy=-miny+max(0.,(PLATE_H-spany)/2)
        q.geom=affinity.translate(q.geom,dx,dy);q.matrix=T_translate(dx,dy)@q.matrix;out.append(q)
    return out

def bbox_dist(a,b):
    ax0,ay0,ax1,ay1=a.bounds;bx0,by0,bx1,by1=b.bounds
    return math.hypot(max(bx0-ax1,ax0-bx1,0),max(by0-ay1,ay0-by1,0))

def evaluate(pieces,gap):
    penalty=0.;conflicts=0;borders=0;mind=1e9;gs=[p.geom for p in pieces]
    for g in gs:
        x0,y0,x1,y1=g.bounds
        for v in (max(0,-x0),max(0,-y0),max(0,x1-PLATE_W),max(0,y1-PLATE_H)):
            if v>0:penalty+=60*v*v+200*v;borders+=1
    for i,a in enumerate(gs):
        for b in gs[i+1:]:
            bd=bbox_dist(a,b);d=bd if bd>=gap else a.distance(b);mind=min(mind,d)
            if d<gap-1e-9:z=gap-d;penalty+=30*z*z+20*z;conflicts+=1
    return penalty,conflicts,borders,None if mind==1e9 else mind

def degrees(pieces,gap):
    d=[0]*len(pieces)
    for i,a in enumerate(pieces):
        x0,y0,x1,y1=a.geom.bounds
        if x0<0 or y0<0 or x1>PLATE_W or y1>PLATE_H:d[i]+=3
        for j in range(i+1,len(pieces)):
            if a.geom.distance(pieces[j].geom)<gap:d[i]+=1;d[j]+=1
    return d

def anneal(pieces,gap,seconds,seed):
    cur=[p.clone() for p in pieces];best=[p.clone() for p in cur];cs=evaluate(cur,gap);bs=cs;rng=random.Random(seed);start=time.time();iters=0
    while time.time()-start<seconds:
        iters+=1;deg=degrees(cur,gap)
        i=rng.choices(range(len(cur)),weights=[1+x*x for x in deg],k=1)[0] if max(deg,default=0)>0 and rng.random()<.82 else rng.randrange(len(cur))
        old=cur[i].clone();c=old.geom.centroid;e=(time.time()-start)/seconds;sc=max(.2,3*(1-e));dx,dy=rng.gauss(0,sc),rng.gauss(0,sc);ang=rng.choice([0,0,0,0,-1,-.5,.5,1,-2,2]);q=old.clone();M=np.eye(3)
        if ang:q.geom=affinity.rotate(q.geom,ang,origin=(c.x,c.y));M=T_rotate(ang,c.x,c.y)@M
        q.geom=affinity.translate(q.geom,dx,dy);M=T_translate(dx,dy)@M;q.matrix=M@q.matrix;cur[i]=q
        ns=evaluate(cur,gap);delta=ns[0]-cs[0];temp=max(.05,8*(1-e))
        if delta<=0 or rng.random()<math.exp(-delta/temp):
            cs=ns
            if (ns[1]+ns[2],ns[0])<(bs[1]+bs[2],bs[0]):best=[p.clone() for p in cur];bs=ns
            if ns[1]==0 and ns[2]==0:break
        else:cur[i]=old
    return best,bs,{'iterations':iters,'seed':seed,'seconds':round(time.time()-start,3)}

def msvg(M):return f'matrix({M[0,0]:.12g} {M[1,0]:.12g} {M[0,1]:.12g} {M[1,1]:.12g} {M[0,2]:.12g} {M[1,2]:.12g})'

def export(defs,pieces,out,meta):
    root=ET.Element(f'{{{SVGNS}}}svg',{'width':f'{PLATE_W}mm','height':f'{PLATE_H}mm','viewBox':f'0 0 {PLATE_W} {PLATE_H}'})
    md=ET.SubElement(root,f'{{{SVGNS}}}metadata');md.text=json.dumps(meta,ensure_ascii=False)
    for d in defs:root.append(copy.deepcopy(d))
    cut=ET.SubElement(root,f'{{{SVGNS}}}g',{'id':'CORTE','fill':'none','stroke':'#000000'})
    for i,p in enumerate(pieces,1):
        g=ET.SubElement(cut,f'{{{SVGNS}}}g',{'id':f'pieza_{i:03d}','data-polifan-piece':'1','data-source-id':p.pid,'transform':msvg(p.matrix)})
        for m in p.members:g.append(copy.deepcopy(m))
    ET.ElementTree(root).write(out,encoding='utf-8',xml_declaration=True)

def validate(svg_path,ppm=4.0):
    tree=ET.parse(svg_path);root=tree.getroot();defs=[copy.deepcopy(c) for c in root if tag(c)=='defs'];cut=next((e for e in root.iter() if e.attrib.get('id')=='CORTE'),None);pieces=[]
    if cut is None:return {'valid':False,'piece_count':0,'conflicts':0,'border_conflicts':0,'min_gap_mm':None}
    for i,g in enumerate(list(cut)):
        if g.attrib.get('data-polifan-piece')!='1':continue
        geom=raster_geom(root,defs,g,ppm)
        if not geom.is_empty and geom.area>.2:pieces.append(Piece(g.attrib.get('id',f'p{i}'),geom))
    ev=evaluate(pieces,MIN_GAP)
    return {'valid':ev[1]==0 and ev[2]==0,'piece_count':len(pieces),'conflicts':ev[1],'border_conflicts':ev[2],'min_gap_mm':ev[3],'validation_ppm':ppm,'gap_required_mm':MIN_GAP}

def solve_file(inp,outdir,seconds3=6.,seconds25=10.):
    t0=time.time();root,defs,pieces,collapsed=extract(inp,1.0)
    if not pieces:return {'archivo':inp.name,'status':'SIN_GEOMETRIA','seconds':round(time.time()-t0,3)}
    base=compact_seed(pieces);attempts=[]
    def try_gap(final_gap,seconds):
        gap=final_gap+SEARCH_SAFETY;ev=evaluate(base,gap)
        if ev[1]==0 and ev[2]==0:return [p.clone() for p in base],ev
        best=None;best_ev=ev;per=max(.35,seconds/3)
        for s in (17,43,101):
            cand,cev,meta=anneal(base,gap,per,s);attempts.append({'gap':final_gap,'eval':cev,'meta':meta})
            if (cev[1]+cev[2],cev[0])<(best_ev[1]+best_ev[2],best_ev[0]):best,best_ev=cand,cev
            if cev[1]==0 and cev[2]==0:return cand,cev
        return best,best_ev
    sol,ev=try_gap(PREFERRED_GAP,seconds3);used=PREFERRED_GAP
    if sol is None or ev[1] or ev[2]:sol,ev=try_gap(MIN_GAP,seconds25);used=MIN_GAP
    if sol is None or ev[1] or ev[2]:return {'archivo':inp.name,'status':'NO_RESUELTO','pieces':len(pieces),'collapsed_internal':collapsed,'conflicts':ev[1],'border_conflicts':ev[2],'min_gap_mm':ev[3],'attempts':attempts,'seconds':round(time.time()-t0,3)}
    out=outdir/(inp.stem+'__POLIFAN_OK.svg');export(defs,sol,out,{'engine':'Motor Polifan Definitivo V1','source':inp.name,'plate_mm':[PLATE_W,PLATE_H],'target_gap_used_mm':used,'scale':'1:1','piece_count':len(pieces),'collapsed_internal_details':collapsed})
    val=validate(out,4.0);status='CERTIFICADO' if val['valid'] and val['piece_count']==len(pieces) else 'EXPORT_RECHAZADO'
    return {'archivo':inp.name,'status':status,'pieces':len(pieces),'collapsed_internal':collapsed,'search_gap_used_mm':used,'search_min_gap_mm':ev[3],'validation':val,'output':str(out),'attempts':attempts,'seconds':round(time.time()-t0,3)}

def solve_svg_text(svg_text:str,filename:str='placa.svg',seconds3:float=6.,seconds25:float=10.):
    with tempfile.TemporaryDirectory(prefix='polifan_def_') as td:
        base=Path(td);safe=Path(filename or 'placa.svg').name
        if not safe.lower().endswith('.svg'):safe+='.svg'
        inp=base/safe;outdir=base/'out';outdir.mkdir();inp.write_text(svg_text,encoding='utf-8')
        result=solve_file(inp,outdir,seconds3,seconds25);txt=None;path=result.get('output')
        if path and Path(path).exists():txt=Path(path).read_text(encoding='utf-8')
        result=dict(result);result.pop('output',None);result['svgText']=txt;return result
