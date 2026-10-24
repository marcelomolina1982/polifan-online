import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'

// Network-free regression test: the same concurrent read is shared, but
// subsequent reads and different section sets always fetch fresh revisions.
const source=readFileSync(new URL('../src/lib/v2Data.js',import.meta.url),'utf8')
let calls=0
const supabase={
  rpc:async(name,args)=>{
    calls++
    await new Promise(resolve=>setTimeout(resolve,10))
    if(name==='get_v2_sections')return {data:[{data:Object.fromEntries(args.p_keys.map(k=>[k,[]])),updated_at:'v1'}],error:null}
    if(name==='get_v2_section_revisions')return {data:args.p_keys.map(k=>({section_key:k,updated_at:'v1'})),error:null}
    throw new Error('unexpected RPC: '+name)
  }
}
const moduleText=source.replace(/^import \{supabase\} from '\.\.\/supabase'\s*/,'')
if(moduleText===source)throw new Error('import rewrite failed')
globalThis.__v2_test_supabase=supabase
const {loadV2Sections}=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent('const supabase=globalThis.__v2_test_supabase;\n'+moduleText))
const [a,b]=await Promise.all([loadV2Sections(['orders','figures']),loadV2Sections(['figures','orders'])])
assert.deepEqual(a,b)
assert.equal(calls,2,'concurrent identical requests should make one sections and one revisions RPC')
await loadV2Sections(['orders','figures'])
assert.equal(calls,4,'later requests must refresh rather than return stale data')
await Promise.all([loadV2Sections(['orders']),loadV2Sections(['figures'])])
assert.equal(calls,8,'different keys must not share results')
console.log('V2 in-flight coalescing regression: OK')
