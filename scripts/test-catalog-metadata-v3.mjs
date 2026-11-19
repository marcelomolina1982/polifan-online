import assert from 'node:assert/strict'
import {splitCatalogProduct,readCatalogMetadataV3,readCatalogImageV3,mutateCatalogMetadataV3} from '../src/lib/catalogMetadataV3.js'
const photo='data:image/png;base64,THIS_IS_A_TEST_IMAGE'
const original={id:'a',name:'Corazón',price:4000,image:photo,imageData:photo,photo}
assert.deepEqual(splitCatalogProduct(original),{metadata:{id:'a',name:'Corazón',price:4000},image:photo})
assert.deepEqual(original,{id:'a',name:'Corazón',price:4000,image:photo,imageData:photo,photo},'must not mutate input')
const rows=Array.from({length:205},(_,i)=>({id:String(i).padStart(3,'0'),payload:{id:String(i).padStart(3,'0'),price:i},updated_at:'1'}))
const calls=[]
const supabase={
  from(table){
    let id,after=null,limit=100
    const query={
      select(){return query},
      order(){return query},
      limit(n){limit=n;return query},
      gt(column,v){assert.equal(column,'id');after=v;return query},
      eq(column,v){assert.equal(column,'product_id');id=v;return query},
      async maybeSingle(){return {data:id==='a'?{image:photo}:null,error:null}},
      then(resolve){return Promise.resolve({data:rows.filter(r=>after===null||r.id>after).slice(0,limit),error:null}).then(resolve)}
    }
    assert.ok(['catalog_product_metadata_v3','catalog_product_images'].includes(table))
    return query
  },
  async rpc(name,args){
    assert.equal(name,'mutate_catalog_metadata_v3');calls.push(args)
    return {data:[{applied:true,status:args.p_action==='create'?'created':args.p_action==='update'?'updated':'deleted',revision:'2'}],error:null}
  }
}
assert.equal((await readCatalogMetadataV3(supabase)).length,205)
assert.equal((await readCatalogMetadataV3(supabase,{pageSize:20})).length,205)
assert.equal(await readCatalogImageV3(supabase,'a'),photo)
assert.equal(await readCatalogImageV3(supabase,'missing'),null)
assert.equal((await mutateCatalogMetadataV3(supabase,{operation:'create',product:original})).ok,true)
assert.deepEqual(calls[0],{p_action:'create',p_id:'a',p_payload:{id:'a',name:'Corazón',price:4000},p_expected_updated_at:null,p_image:photo})
assert.equal((await mutateCatalogMetadataV3(supabase,{operation:'update',product:original,expectedRevision:'1'})).ok,true)
assert.equal(calls[1].p_image,null,'editing a price must never retransmit a big unchanged image')
assert.equal((await mutateCatalogMetadataV3(supabase,{operation:'update',product:original,expectedRevision:'1',imageChanged:true})).ok,true)
assert.equal(calls[2].p_image,photo)
assert.equal((await mutateCatalogMetadataV3(supabase,{operation:'delete',id:'a',expectedRevision:'1'})).ok,true)
assert.equal(calls[3].p_image,null)
await assert.rejects(mutateCatalogMetadataV3(supabase,{operation:'create',product:{id:'a'}}),/imagen/)
await assert.rejects(mutateCatalogMetadataV3(supabase,{operation:'update',product:original}),/revisión/)
const conflictDb={rpc:async()=>({data:[{applied:false,status:'conflict',revision:'2'}],error:null})}
assert.deepEqual(await mutateCatalogMetadataV3(conflictDb,{operation:'update',product:original,expectedRevision:'1'}),{ok:false,conflict:true,status:'conflict',revision:'2'})
const badDb={rpc:async()=>({data:null,error:new Error('network error')})}
await assert.rejects(mutateCatalogMetadataV3(badDb,{operation:'update',product:original,expectedRevision:'1'}),/network error/)
console.log('OK: 205 paginated metadata products; images separate; changes omit unchanged images; atomic CRUD contracts')
