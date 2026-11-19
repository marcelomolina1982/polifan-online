// Pure merge helpers shared by the app and concurrency tests.
export const stableJson=value=>{try{return JSON.stringify(value)}catch{return String(value)}}
export const changedTopLevelKeys=(before,after)=>{
  const keys=new Set([...Object.keys(before||{}),...Object.keys(after||{})])
  return [...keys].filter(key=>stableJson(before?.[key])!==stableJson(after?.[key]))
}
const comparableRecord=(item,key)=>{
  if(!item||typeof item!=='object')return item
  if(key!=='clients')return item
  const copy={...item}
  delete copy.updatedAt
  delete copy.lastOrderAt
  return copy
}
const mergeCutBatchRecord=(base,remote,wanted)=>{
  if(wanted===undefined)return{ok:true,value:undefined}
  if(remote===undefined)return{ok:true,value:wanted}
  if(base===undefined)return{ok:true,value:{...remote,...wanted}}
  const out={...remote},keys=new Set([...Object.keys(base||{}),...Object.keys(remote||{}),...Object.keys(wanted||{})])
  const conflicts=[]
  for(const field of keys){
    if(field==='updatedAt'){if(field in wanted)out[field]=wanted[field];continue}
    const b=base?.[field],r=remote?.[field],w=wanted?.[field]
    const localChanged=stableJson(w)!==stableJson(b),remoteChanged=stableJson(r)!==stableJson(b)
    if(localChanged&&remoteChanged&&stableJson(w)!==stableJson(r)){conflicts.push(field);continue}
    if(localChanged){if(w===undefined)delete out[field];else out[field]=w}
  }
  return conflicts.length?{ok:false,conflicts}:{ok:true,value:out}
}
export const mergeArrayById=(baseline,latest,next,key='')=>{
  const baseMap=new Map((baseline||[]).map(item=>[String(item?.id),item]))
  const latestMap=new Map((latest||[]).map(item=>[String(item?.id),item]))
  const nextMap=new Map((next||[]).map(item=>[String(item?.id),item]))
  const ids=new Set([...baseMap.keys(),...nextMap.keys()])
  const touched=[...ids].filter(id=>stableJson(baseMap.get(id))!==stableJson(nextMap.get(id)))
  const merged=new Map(latestMap),conflicts=[]
  for(const id of touched){
    const base=baseMap.get(id),remote=latestMap.get(id),wanted=nextMap.get(id)
    if(key==='cutBatches'){
      const section=mergeCutBatchRecord(base,remote,wanted)
      if(!section.ok){conflicts.push(id);continue}
      section.value===undefined?merged.delete(id):merged.set(id,section.value)
      continue
    }
    if(key==='orders'&&wanted===undefined){merged.delete(id);continue}
    if(base===undefined&&remote!==undefined&&(key==='orders'||key==='clients')){wanted===undefined?merged.delete(id):merged.set(id,wanted);continue}
    const normalizedBase=comparableRecord(base,key),normalizedRemote=comparableRecord(remote,key),normalizedWanted=comparableRecord(wanted,key)
    if(stableJson(normalizedRemote)!==stableJson(normalizedBase)&&stableJson(normalizedRemote)!==stableJson(normalizedWanted)){conflicts.push(id);continue}
    wanted===undefined?merged.delete(id):merged.set(id,wanted)
  }
  if(conflicts.length)return{ok:false,conflicts}
  const order=[...(latest||[]).map(x=>String(x?.id)),...(next||[]).map(x=>String(x?.id))]
  return{ok:true,value:[...new Set(order)].map(id=>merged.get(id)).filter(Boolean)}
}
export const MERGE_BY_RECORD=new Set(['customerCatalog','catalogCollections','orders','clients','svgLibrary','cutBatches','movements','quotes','incomes','expenses','generatedSheets','customerReviews','customerPhotos'])

