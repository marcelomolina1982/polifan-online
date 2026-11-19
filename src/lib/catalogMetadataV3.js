// Metadata-only catalog staging. The live application must continue to
// use the legacy store until a verified coordinated cutover.
const imageFields=['image','imageData','photo']
const validId=id=>typeof id==='string'&&id.length>0&&id===id.trim()&&id.length<=256
export function splitCatalogProduct(product){
  if(!product||Array.isArray(product)||typeof product!=='object'||!validId(product.id))
    throw new Error('Producto inválido')
  const metadata={...product}
  imageFields.forEach(key=>delete metadata[key])
  return {metadata,image:typeof product.image==='string'&&product.image.length?product.image:null}
}

export async function readCatalogMetadataV3(supabase,{pageSize=100}={}){
  if(!Number.isInteger(pageSize)||pageSize<1||pageSize>500)throw new Error('Paginación inválida')
  const rows=[]
  let last=null
  for(let n=0;n<10000;n++){
    let query=supabase.from('catalog_product_metadata_v3')
      .select('id,payload,updated_at').order('id').limit(pageSize)
    if(last!==null)query=query.gt('id',last)
    const result=await query
    if(result.error)throw result.error
    const batch=result.data||[]
    for(const row of batch){
      if(!validId(row.id)||row.payload?.id!==row.id||
        imageFields.some(key=>Object.hasOwn(row.payload,key))||
        (last!==null&&row.id<=last))throw new Error('Metadatos inconsistentes')
      rows.push(row)
      last=row.id
    }
    if(batch.length<pageSize)return rows
  }
  throw new Error('Catálogo excede el límite permitido')
}

export async function readCatalogImageV3(supabase,id){
  if(!validId(id))throw new Error('Identificador inválido')
  const {data,error}=await supabase.from('catalog_product_images')
    .select('image,updated_at').eq('product_id',id).maybeSingle()
  if(error)throw error
  return data?.image||null
}

export async function mutateCatalogMetadataV3(supabase,{operation,product,id,expectedRevision,imageChanged=false}){
  if(!['create','update','delete'].includes(operation))throw new Error('Operación inválida')
  const productId=id??product?.id
  if(!validId(productId))throw new Error('Identificador inválido')
  if(operation==='create'&&expectedRevision!=null)throw new Error('El alta no lleva revisión anterior')
  if(operation!=='create'&&(typeof expectedRevision!=='string'||!expectedRevision.trim()))
    throw new Error('Falta revisión de edición')
  if(operation==='delete'&&(product!==undefined||imageChanged))
    throw new Error('La eliminación no admite datos ni imagen nueva')
  if(operation!=='delete'&&(!product||product.id!==productId))throw new Error('Producto no coincide')
  const split=operation==='delete'?null:splitCatalogProduct(product)
  if(operation==='create'&&!split.image)throw new Error('El producto nuevo requiere imagen')
  if(imageChanged&&!split.image)throw new Error('La imagen modificada está vacía')
  const payload={
    p_action:operation,p_id:productId,
    p_payload:split?.metadata||null,
    p_expected_updated_at:expectedRevision||null,
    p_image:operation==='create'||imageChanged?split.image:null
  }
  const {data,error}=await supabase.rpc('mutate_catalog_metadata_v3',payload)
  if(error)throw error
  const response=Array.isArray(data)?data[0]:data
  if(!response||typeof response.applied!=='boolean'||
    !['created','updated','deleted','conflict'].includes(response.status)||
    (response.applied===(response.status==='conflict')))
    throw new Error('Respuesta del servidor inválida')
  return {ok:response.applied,conflict:!response.applied,status:response.status,revision:response.revision||null}
}
