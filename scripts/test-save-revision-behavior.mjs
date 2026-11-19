import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

// Execute the exact saveData function from App.jsx, not a copy of the algorithm.
const app=fs.readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8')
const start=app.indexOf('  async function saveData(next){')
const end=app.indexOf('  async function saveOrderData(next){',start)
assert.ok(start!==-1 && end>start,'Could not locate app saving function')
const functionSource=app.slice(start,end)

const copy=x=>JSON.parse(JSON.stringify(x))
function makeClient({baseline,live,localRevision='R1',liveRevision='R1'}){
  let serverData=copy(live),databaseRevision=liveRevision,componentData=copy(baseline)
  const calls={revisionReads:0,fullReads:0,updates:0,expectedRevisions:[],alerts:[]}
  const supabase={
    from(table){
      assert.equal(table,'app_state')
      return{
        select(columns){
          assert.ok(['updated_at,catalog_image_compaction_enabled','data,updated_at','data,updated_at,catalog_write_nonce'].includes(columns))
          return{eq(field,id){
            assert.equal(field,'id');assert.equal(id,'main')
            return{async maybeSingle(){
              if(columns==='updated_at,catalog_image_compaction_enabled'){calls.revisionReads++;return{data:{updated_at:databaseRevision,catalog_image_compaction_enabled:false},error:null}}
              calls.fullReads++;return{data:{updated_at:databaseRevision,data:copy(serverData)},error:null}
            }}
          }}
        },
        update(payload){
          let expected=null
          return{eq(field,value){
            if(field==='id')assert.equal(value,'main')
            else if(field==='updated_at')expected=value
            else assert.fail('Unexpected update filter '+field)
            return this
          },async select(fields){
            assert.equal(fields,'updated_at')
            calls.updates++
            calls.expectedRevisions.push(expected)
            if(expected!==databaseRevision)return{data:[],error:null}
            serverData=copy(payload.data)
            databaseRevision=payload.updated_at
            return{data:[{updated_at:databaseRevision}],error:null}
          }}
        }
      }
    }
  }
  const context={
    supabase,db:copy(baseline),session:{user:{id:'test-user'}},
    serverDataRef:{current:copy(baseline)},
    serverRevisionRef:{current:localRevision},
    mutationEpochRef:{current:0},loadSequenceRef:{current:0},savingRef:{current:false},
    setSaving:()=>{},setDb:data=>{componentData=copy(data)},
    localStorage:{setItem:()=>{}},alert:text=>calls.alerts.push(text),
    stableJson:JSON.stringify,
    changedTopLevelKeys:(a,b)=>[...new Set([...Object.keys(a),...Object.keys(b)])]
      .filter(k=>JSON.stringify(a[k])!==JSON.stringify(b[k])),
    MERGE_BY_RECORD:new Set(['orders']),
    mergeArrayById:()=>{throw new Error('Unexpected record merge in this scenario')},
    emptyState:()=>({}),
    crypto:{randomUUID:()=>`00000000-0000-4000-8000-000000000001`},
    Promise,Date,Error,Set,Map,JSON
  }
  const save=vm.runInNewContext(functionSource+'\n saveData',context)
  return{save,calls,get data(){return serverData},get component(){return componentData},get revision(){return databaseRevision}}
}

{
  const client=makeClient({baseline:{stock:1,orders:[]},live:{stock:1,orders:[]}})
  const result=await client.save({stock:2,orders:[]})
  assert.equal(result.ok,true)
  assert.equal(client.calls.revisionReads,1)
  assert.equal(client.calls.fullReads,0,'Matching revision must NOT download 22 MB state')
  assert.equal(client.calls.updates,1)
  assert.deepEqual(client.calls.expectedRevisions,['R1'])
  assert.equal(client.data.stock,2)
}
{
  const client=makeClient({
    baseline:{stock:1,orders:[]},
    live:{stock:1,orders:[{id:'remote-order'}]},
    localRevision:'R1',liveRevision:'R2'
  })
  const result=await client.save({stock:2,orders:[]})
  assert.equal(result.ok,true)
  assert.equal(client.calls.revisionReads,1)
  assert.equal(client.calls.fullReads,1,'Changed revision must download fresh data')
  assert.deepEqual(client.calls.expectedRevisions,['R2'])
  assert.equal(client.data.stock,2)
  assert.equal(client.data.orders[0].id,'remote-order','Never discard another computer order')
}
{
  const client=makeClient({
    baseline:{stock:1,orders:[]},
    live:{stock:5,orders:[]},
    localRevision:'R1',liveRevision:'R2'
  })
  const result=await client.save({stock:2,orders:[]})
  assert.equal(result.ok,false,'Same stock field concurrent change must be rejected')
  assert.equal(result.conflict,true)
  assert.equal(client.calls.fullReads,1)
  assert.equal(client.calls.updates,0)
  assert.equal(client.data.stock,5,'Remote data must remain intact')
}
console.log('OK: unchanged revision skips full read; remote orders survive; same-key conflicts block overwrite')
