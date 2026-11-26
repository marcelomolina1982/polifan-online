import assert from 'node:assert/strict'
import fs from 'node:fs'

// Run a real async IronNest frontend workflow against a fake HTTP lab.
// No connection to Render, Supabase, or customer data.
const source=fs.readFileSync(new URL('../src/lib/ironnestLab.js',import.meta.url),'utf8')
  .replaceAll('import.meta.env.VITE_IRONNEST_LAB_URL','undefined')
const lab=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))
const motor=fs.readFileSync(new URL('../src/pages/MotorDefinitivo.jsx',import.meta.url),'utf8')
assert.match(source,/fallbackVariants=uniqueKitVariants\(ordered,9\)/)
assert.match(motor,/data\.fallbackUsed===true/)
assert.match(motor,/reducedBase.*?'IronNest/)
assert.match(motor,/plan\.warning/)
assert.match(motor,/registerPlan\(plan\)/)
assert.match(motor,/if\(!String\(plan\.status\|\|''\)\.startsWith\('CERTIFICADO'\)/)

const kits=Array.from({length:10},(_,i)=>({
 kitId:'kit'+i,figure:'Synthetic'+i,priority:i,
 parts:[0,1].map(j=>({kitId:'kit'+i,instanceId:'kit'+i+'-piece'+j,
 svgText:'<svg/>',sourceWidthCm:10,sourceHeightCm:10}))
}))
let mode,starts,getCount
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}})
const placements=(batch)=>batch.flatMap(k=>k.parts.map(p=>({
 kitId:k.kitId,instanceId:p.instanceId,xCm:0,yCm:0,angle:0
})))
globalThis.fetch=async(url,options={})=>{
 if(String(url).includes('/ironnest/solve-start')&&options.method==='POST'){
  const payload=JSON.parse(options.body)
  const jobId='fake-'+starts.length
  starts.push(payload.kits)
  return json({ok:true,jobId},202)
 }
 if(String(url).includes('/ironnest/solve-status')){
  getCount++
  const id=new URL(url).searchParams.get('id')
  const batch=starts[Number(id.slice(5))]
  if(mode==='transient')return json({error:'Gateway unavailable'},503)
  const ten=batch.length===10
  if(ten&&(mode==='nine'||mode==='incomplete'||(mode==='grow'&&starts.filter(k=>k.length===10).length===1))){
   return json({ok:false,result:{ok:false,error:'IronNest acomodo 19 piezas, pero faltaron 1. No se registro ninguna placa.'}},422)
  }
  const pieces=placements(batch)
  const received=mode==='incomplete'&&batch.length===9?pieces.slice(0,-1):pieces
  return json({ok:true,result:{ok:true,placements:received,layoutValidation:{ok:true,minimumMeasuredGapMm:3.5,conflicts:0,outsidePlate:[]},geometricOccupancyPct:74}},200)
 }
 throw new Error('Unexpected synthetic fetch '+url)
}
async function testScenario(name){
 mode=name;starts=[];getCount=0
 try{
  const result=await lab.solveCompleteKitsWithIronNestLab(kits,{targetComplete:10,maxGrowth:10,pollMs:1})
  if(name==='incomplete'||name==='transient')throw new Error('Unsafe scenario unexpectedly succeeded')
  const expected=name==='nine'?9:10
  assert.equal(result.selectedKits.length,expected)
  assert.equal(result.fallbackUsed,name==='nine')
  assert.equal(result.placements.length,expected*2)
  assert.equal(result.layoutValidation.ok,true)
  assert.equal(result.requestedComplete,10)
  if(name==='nine')assert.ok(starts.some(b=>b.length===10)&&starts.some(b=>b.length===9))
  if(name==='full')assert.ok(starts.every(b=>b.length===10))
  if(name==='grow')assert.ok(starts.some(b=>b.length===9)&&starts.filter(b=>b.length===10).length>=2)
 }catch(error){
  if(name==='transient'){assert.match(String(error.message),/respuesta transitoria/);assert.ok(starts.every(k=>k.length===10));return}
  if(name==='incomplete'){assert.match(String(error.message),/piezas incompletas/);return}
  throw error
 }
}
await testScenario('full')
await testScenario('nine')
await testScenario('grow')
await testScenario('transient')
await testScenario('incomplete')
console.log('OK: IronNest certified 10, certified 9 fallback, recover 10, reject transient and partial pieces')
