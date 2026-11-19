import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

// Test the real saveData source, with a mock BEFORE UPDATE trigger.
const app=fs.readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8')
const begin=app.indexOf('  async function saveData(next){')
const end=app.indexOf('  async function saveOrderData(next){',begin)
assert.ok(begin>=0&&end>begin)
const source=app.slice(begin,end)
const clone=value=>JSON.parse(JSON.stringify(value))
const photoA='data:image/jpeg;base64,T0xE'
const photoB='data:image/jpeg;base64,TkVX'
const url=(id,rev)=>`https://eftksimpkkvmyfurwqii.supabase.co/functions/v1/catalog-image?id=${id}&v=${rev}`

function makeClient({omitCanonical=false,compactionEnabled=true}={}){
  let stored={
    orders:[{id:'order1'}],
    stock:3,
    customerCatalog:[{id:'heart',image:photoA,name:'Heart'},{id:'star',name:'Star'}]
  }
  const imageStore=new Map([['heart',photoA],['star',photoB]])
  let nonceCounter=0
  let revision='R1',visible=clone(stored)
  const seen={returning:[],revisionReads:0,fullReads:0,updates:0,alerts:[],imageUpdates:0,nonces:[]}
  const supabase={from(table){
    assert.equal(table,'app_state')
    return{
      select(fields){
        return {eq(col,value){
          assert.equal(col,'id');assert.equal(value,'main')
          return{async maybeSingle(){
            if(fields==='updated_at,catalog_image_compaction_enabled'){seen.revisionReads++;return{data:{updated_at:revision,catalog_image_compaction_enabled:compactionEnabled},error:null}}
            assert.equal(fields,'data,updated_at');seen.fullReads++
            return{data:{data:clone(stored),updated_at:revision},error:null}
          }}
        }}
      },
      update(payload){
        let expected
        return{
          eq(col,value){if(col==='updated_at')expected=value;else assert.equal(col,'id');return this},
          async select(fields){
            seen.returning.push(fields);seen.updates++
            seen.nonces.push(payload.catalog_write_nonce)
            if(expected!==revision)return{data:[],error:null}
            const updated=clone(payload.data)
            // Simulate the PostgreSQL trigger: image bytes written atomically,
            // replaced with URLs, including products without legacy image field.
            const inline=compactionEnabled&&updated.customerCatalog.some(p=>String(p.image||'').startsWith('data:image/'))
            if(inline)for(const item of updated.customerCatalog){
              if(String(item.image||'').startsWith('data:image/')){
                if(imageStore.get(item.id)!==item.image){seen.imageUpdates++;imageStore.set(item.id,item.image)}
                item.image=url(item.id,123)
              }else if(!item.image&&imageStore.has(item.id))item.image=url(item.id,123)
            }
            stored=updated
            revision=payload.updated_at
            return{data:[{
              updated_at:revision,
              ...(fields==='updated_at,data'&&!omitCanonical?{data:clone(stored)}:{})
            }],error:null}
          }
        }
      }
    }
  }}
  const context={
    supabase,db:clone(stored),session:{user:{id:'test-user'}},
    serverDataRef:{current:clone(stored)},serverRevisionRef:{current:revision},
    mutationEpochRef:{current:0},loadSequenceRef:{current:0},savingRef:{current:false},
    setSaving:()=>{},setDb:value=>{visible=clone(value);context.db=clone(value)},
    localStorage:{setItem:()=>{}},alert:value=>seen.alerts.push(value),
    changedTopLevelKeys:(a,b)=>[...new Set([...Object.keys(a),...Object.keys(b)])]
      .filter(k=>JSON.stringify(a[k])!==JSON.stringify(b[k])),
    stableJson:JSON.stringify,MERGE_BY_RECORD:new Set(),
    mergeArrayById:()=>{throw new Error('Should not merge arrays in this test')},
    emptyState:()=>({}),crypto:{randomUUID:()=>`00000000-0000-4000-8000-${String(++nonceCounter).padStart(12,'0')}`},Promise,Date,Error,Set,Map,JSON
  }
  const save=vm.runInNewContext(source+'\n saveData',context)
  return{
    save,seen,
    get visible(){return clone(visible)},
    get stored(){return clone(stored)},
    get image(){return imageStore.get('heart')},
    get catalog(){return clone(context.db.customerCatalog)}
  }
}

{
  const c=makeClient()
  const first=await c.save({...c.visible,stock:4})
  assert.equal(first.ok,true)
  assert.equal(c.seen.returning[0],'updated_at,data','Canonical result returned atomically')
  assert.equal(c.seen.fullReads,0,'No additional 22MB roundtrip')
  assert.equal(c.stored.stock,4)
  assert.equal(c.stored.orders[0].id,'order1')
  assert.equal(c.catalog.length,2)
  assert.ok(c.catalog.every(p=>p.image?.startsWith('https://')),'All images linked, including formerly absent')
  assert.equal(c.image,photoA,'Existing image not overwritten')
  assert.deepEqual(clone(first.data),c.stored,'Client state mirrors committed server row')

  const second=await c.save({...c.visible,stock:5})
  assert.equal(second.ok,true)
  assert.equal(c.seen.returning[1],'updated_at','Next save is revision-only')
  assert.notEqual(c.seen.nonces[0],c.seen.nonces[1],'Each save uses a fresh nonce')
  assert.equal(c.seen.fullReads,0)
  assert.equal(c.image,photoA)
  assert.equal(c.seen.imageUpdates,0,'No retransmission of original images')
}
{
  const c=makeClient()
  const uploaded={...c.catalog[0],image:photoB}
  const first=await c.save({...c.visible,customerCatalog:[uploaded,c.catalog[1]]})
  assert.equal(first.ok,true)
  assert.equal(c.image,photoB,'Changed product image saved')
  assert.ok(c.visible.customerCatalog[0].image.startsWith('https://'))
  assert.equal(c.seen.imageUpdates,1)
  const second=await c.save({...c.visible,stock:10})
  assert.equal(second.ok,true)
  assert.equal(c.image,photoB,'Unrelated order/stock save cannot revert changed image')
}
{
  const c=makeClient({omitCanonical:true})
  const result=await c.save({...c.visible,stock:4})
  assert.equal(result.ok,false)
  assert.equal(result.committed,true)
  assert.equal(result.requiresReload,true)
  assert.equal(c.seen.alerts.length,1,'Fail closed with reload instructions')
  assert.ok(c.visible.customerCatalog[0].image.startsWith('data:'),'Never claim a canonical state that was not returned')
}
{
  // Before activation the server contains old base64 photos, so normal saves
  // MUST return only a tiny revision and never ask for the 26 MB JSON again.
  const c=makeClient({compactionEnabled:false})
  const first=await c.save({...c.visible,stock:4})
  assert.equal(first.ok,true)
  assert.equal(c.seen.returning[0],'updated_at')
  assert.equal(c.seen.fullReads,0)
  assert.ok(c.visible.customerCatalog[0].image.startsWith('data:'))
  const second=await c.save({...c.visible,stock:5})
  assert.equal(second.ok,true)
  assert.equal(c.seen.returning[1],'updated_at')
}
console.log('OK: atomic returned image URLs, legacy images preserved, repeated saves stable, missing canonical response fails closed')
