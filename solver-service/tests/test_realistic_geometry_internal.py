import json
import os
import pathlib
import subprocess
import tempfile
import time
import unittest

SPARROW_BIN=os.environ.get('SPARROW_BIN_TEST')


def simple(points):
    return {'type':'simple_polygon','data':[[float(x),float(y)] for x,y in points]}


def with_hole(outer, inner):
    return {'type':'multi_polygon','data':[{
        'outer': [[float(x),float(y)] for x,y in outer],
        'inner': [[[float(x),float(y)] for x,y in inner]],
    }]}


def rect(w,h):
    return simple([(0,0),(w,0),(w,h),(0,h)])


def l_shape(w=100,h=100,t=35):
    return simple([(0,0),(w,0),(w,t),(t,t),(t,h),(0,h)])


def c_shape(w=110,h=100,t=28):
    return simple([(0,0),(w,0),(w,t),(t,t),(t,h-t),(w,h-t),(w,h),(0,h)])


def star(cx=55,cy=55,r1=52,r2=23,n=5):
    import math
    pts=[]
    for i in range(n*2):
        a=-math.pi/2+i*math.pi/n
        r=r1 if i%2==0 else r2
        pts.append((cx+r*math.cos(a),cy+r*math.sin(a)))
    return simple(pts)


@unittest.skipUnless(SPARROW_BIN and os.path.exists(SPARROW_BIN),'Sparrow real no disponible')
class RealisticGeometryInternalTests(unittest.TestCase):
    def run_sparrow(self, items, seconds=4, gap=3.2, name='realistic-internal'):
        instance={'name':name,'items':items,'strip_height':580.0}
        with tempfile.TemporaryDirectory(prefix='sparrow-realistic-') as td:
            inp=pathlib.Path(td)/'input.json'
            inp.write_text(json.dumps(instance,separators=(',',':')),encoding='utf-8')
            started=time.monotonic()
            proc=subprocess.run([
                SPARROW_BIN,'-i',str(inp),'-t',str(seconds),
                '--min-item-separation',str(gap),'--workers','1','-s','429'
            ],cwd=td,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=seconds+18)
            elapsed=time.monotonic()-started
            out=pathlib.Path(td)/'output'/f'final_{name}.json'
            self.assertEqual(proc.returncode,0,proc.stdout[-3000:])
            self.assertTrue(out.exists(),proc.stdout[-3000:])
            return json.loads(out.read_text(encoding='utf-8')),elapsed

    def item(self,i,shape,angles=None):
        row={'id':i,'demand':1,'shape':shape}
        if angles is not None: row['allowed_orientations']=angles
        return row

    def test_20_mixed_realistic_parts_fit_without_hanging(self):
        shapes=[
            l_shape(96,112,34), c_shape(108,94,26), star(r1=48,r2=22),
            rect(82,67), simple([(0,0),(92,0),(74,70),(20,88)]),
            l_shape(78,120,30), c_shape(96,112,24), star(cx=48,cy=48,r1=45,r2=20),
            rect(105,58), simple([(0,15),(42,0),(95,25),(78,82),(22,76)]),
        ]
        # Dos componentes por figura: 10 figuras completas / 20 cortes.
        items=[]
        for i,shape in enumerate(shapes+shapes):
            items.append(self.item(i,shape,[0,15,30,45,60,75,90,105,120,135,150,165,180,195,210,225,240,255,270,285,300,315,330,345]))
        data,elapsed=self.run_sparrow(items,seconds=5,gap=3.2,name='mixed-realistic')
        sol=data.get('solution') or {}
        placed=((sol.get('layout') or {}).get('placed_items') or [])
        self.assertEqual(len(placed),20)
        self.assertLessEqual(float(sol.get('strip_width') or 1e9),1220.5)
        self.assertLess(elapsed,24.0)

    def test_internal_hole_is_accepted_and_can_reduce_strip_width(self):
        # Marco grande con hueco útil + pieza pequeña que entra dentro.
        frame=with_hole(
            [(0,0),(400,0),(400,500),(0,500)],
            [(70,70),(330,70),(330,430),(70,430)],
        )
        small=rect(180,180)
        items=[self.item(0,frame,[0]),self.item(1,small,[0,90,180,270])]
        data,elapsed=self.run_sparrow(items,seconds=6,gap=3.2,name='hole-usable')
        sol=data.get('solution') or {}
        placed=((sol.get('layout') or {}).get('placed_items') or [])
        self.assertEqual(len(placed),2)
        # Si el hueco es considerado libre, Sparrow puede mantener un ancho cercano al marco.
        # Damos margen para la heurística, pero un ancho >560 mm indica que trató el hueco como sólido.
        self.assertLessEqual(float(sol.get('strip_width') or 1e9),560.0)
        self.assertLess(elapsed,25.0)

    def test_concave_shapes_do_not_get_reduced_to_bounding_boxes(self):
        # Dos L grandes pueden entrelazarse. Con bounding boxes necesitarían ~440 mm;
        # usando contorno cóncavo real deberían compactarse claramente mejor.
        items=[
            self.item(0,l_shape(220,220,70),[0,90,180,270]),
            self.item(1,l_shape(220,220,70),[0,90,180,270]),
        ]
        data,_=self.run_sparrow(items,seconds=5,gap=3.2,name='concave-interlock')
        sol=data.get('solution') or {}
        placed=((sol.get('layout') or {}).get('placed_items') or [])
        self.assertEqual(len(placed),2)
        self.assertLess(float(sol.get('strip_width') or 1e9),430.0)


if __name__=='__main__':
    unittest.main(verbosity=2)
