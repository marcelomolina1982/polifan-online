import assert from 'node:assert/strict'
import {readCatalogProductV2,readAllCatalogProductsV2,mutateCatalogProductV2} from '../src/lib/catalogProductV2.js'

const record=id=>({id,payload:{id,name:id},updated_at:'2026-11-19T00:00:00+00:00'})
const products=Array.from({length:205},(_,i)=>record(String(i).padStart(4,'0')))
let calls=[]
const db={
  from(table){
    assert.equal(table,'catalog_products_v2')
    const spec={id:null,gt:null,limit:100}
    const q={
      select(columns){assert.equal(columns,'id,payload,updated_at');return q},
      order(column){assert.equal(column,'id');return q},
      limit(n){spec.limit=n;return q},
      gt(column,id){assert.equal(column,'id');spec.gt=id;return q},
      eq(column,id){assert.equal(column,'id');spec.id=id;return q},
      async maybeSingle(){return {data:products.find(p=>p.id===spec.id)||null,error:null}},
      then(resolve){const page=products.filter(p=>spec.gt===null||p.id>spec.gt).slice(0,spec.limit);return Promise.resolve({data:page,error:null}).then(resolve)}
    }
    return q
  },
  async rpc(name,args){assert.equal(name,'mutate_catalog_product_v2');calls.push(args);return {data:[{applied:true,revision:'2026-11-19T00:00:01+00:00',status:args.p_action==='create'?'created':args.p_action==='delete'?'deleted':'updated'}],error:null}}
}
assert.equal((await readCatalogProductV2(db,'0005')).payload.name,'0005')
assert.equal(await readCatalogProductV2(db,'none'),null)
assert.equal((await readAllCatalogProductsV2(db)).length,205)
assert.deepEqual((await readAllCatalogProductsV2(db,{pageSize:25})).map(p=>p.id),products.map(p=>p.id))
const created=await mutateCatalogProductV2(db,{operation:'create',id:'new',product:{id:'new',name:'Nuevo'}})
assert.equal(created.ok,true)
assert.deepEqual(calls[0],{p_action:'create',p_id:'new',p_payload:{id:'new',name:'Nuevo'},p_expected_updated_at:null})
const revision='2026-11-19T00:00:00+00:00'
assert.equal((await mutateCatalogProductV2(db,{operation:'update',id:'0001',product:{id:'0001',name:'Editado'},expectedRevision:revision})).ok,true)
assert.equal(calls[1].p_expected_updated_at,revision)
assert.equal((await mutateCatalogProductV2(db,{operation:'delete',id:'0001',expectedRevision:revision})).operation,'deleted')
assert.equal(calls[2].p_payload,null)
await assert.rejects(mutateCatalogProductV2(db,{operation:'update',id:'0001',product:{id:'0001'}}),/revisión/)
await assert.rejects(mutateCatalogProductV2(db,{operation:'create',id:'0001',product:{id:'other'}}),/coinciden/)
await assert.rejects(mutateCatalogProductV2(db,{operation:'delete',id:'0001',expectedRevision:revision,product:{id:'0001'}}),/no acepta/)
await assert.rejects(mutateCatalogProductV2(db,{operation:'create',id:' ',product:{id:' '}}),/inválido/)
const conflictDb={rpc:async()=>({data:[{applied:false,status:'conflict',revision:null}],error:null})}
const conflict=await mutateCatalogProductV2(conflictDb,{operation:'update',id:'0001',product:{id:'0001'},expectedRevision:revision})
assert.deepEqual(conflict,{ok:false,conflict:true,status:'conflict',revision:null})
const failedDb={rpc:async()=>({data:null,error:new Error('connection lost')})}
await assert.rejects(mutateCatalogProductV2(failedDb,{operation:'update',id:'0001',product:{id:'0001'},expectedRevision:revision}),/connection lost/)
const invalidResponse={rpc:async()=>({data:[{applied:true,status:'conflict'}],error:null})}
await assert.rejects(mutateCatalogProductV2(invalidResponse,{operation:'update',id:'0001',product:{id:'0001'},expectedRevision:revision}),/inválida/)
console.log('OK: catalog v2 per-product create/update/delete, revision conflicts, validation, pagination and errors')
