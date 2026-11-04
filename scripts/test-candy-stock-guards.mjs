import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const sql=readFileSync(new URL('../sql/proposals/golosinas_stock.sql',import.meta.url),'utf8')
const ui=readFileSync(new URL('../src/pages/CandyStock.jsx',import.meta.url),'utf8')
const admin=readFileSync(new URL('../src/pages/CatalogAdmin.jsx',import.meta.url),'utf8')
const checks=[
 ['inventory rejects negative quantities',/quantity integer not null default 0 check\(quantity>=0\)/.test(sql)],
 ['inventory records movement IDs',/id uuid primary key/.test(sql)],
 ['stock write requires authentication',/v_actor is null or not exists/.test(sql)],
 ['stock write checks candy category',/lower\(btrim\(p->>'category'\)\)='golosinas'/.test(sql)],
 ['stock changes lock the product row',/for update/.test(sql)],
 ['stock changes reject insufficient quantity',/Stock insuficiente/.test(sql)],
 ['movement read requires staff',/Staff can read candy movements"[\s\S]*?exists\(select 1 from public\.perfiles/.test(sql)],
 ['inventory movement uses atomic RPC',/supabase\.rpc\('adjust_candy_stock'/.test(ui)],
 ['direct sales request confirmation',/confirm\('¿Registrar venta directa/.test(ui)],
 ['inventory shows movement history',/Últimos movimientos/.test(ui)],
 ['admin includes candy stock panel',/<CandyStock products=\{products\}/.test(admin)],
]
for(const [name,pass] of checks){assert.ok(pass,name);process.stdout.write('PASS '+name+'\n')}
console.log('All static candy inventory guards passed. Database integration and concurrency tests remain pending.')
