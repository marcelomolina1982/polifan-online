import assert from 'node:assert/strict'
import {auditCatalogV2} from '../src/lib/auditCatalogV2.js'

const product=(id,name)=>({id,name})
function mock(original,staged){
  return {from(table){
    if(table==='app_state')return {select(){return {eq(){return {async single(){return {data:{data:{customerCatalog:original}},error:null}}}}}}}
    if(table==='catalog_products_v2')return {select(){return {order(){return {async range(start,end){return {data:staged.slice(start,end+1),error:null}}}}}}}
    throw new Error('Unexpected table '+table)
  }}
}
const original=[product('a','A'),product('b','B')]
const identical=[{id:'a',payload:{name:'A',id:'a'}},{id:'b',payload:product('b','B')}]
assert.equal((await auditCatalogV2(mock(original,identical))).ready,true)
const missing=await auditCatalogV2(mock(original,identical.slice(0,1)))
assert.equal(missing.ready,false)
assert.deepEqual(missing.missing,['b'])
const different=await auditCatalogV2(mock(original,[identical[0],{id:'b',payload:product('b','Changed')}]))
assert.deepEqual(different.different,['b'])
await assert.rejects(auditCatalogV2(mock([product('a','A'),product('a','B')],identical)),/duplicados/)
const extra=await auditCatalogV2(mock(original,[...identical,{id:'c',payload:product('c','C')}]))
assert.equal(extra.ready,false)
assert.deepEqual(extra.extra,['c'])
const many=Array.from({length:205},(_,i)=>product(String(i),String(i)))
assert.equal((await auditCatalogV2(mock(many,many.map(p=>({id:p.id,payload:p}))))).ready,true)
console.log('OK: catalog v2 audit detects matching, missing, changed, duplicate and paginated products')
