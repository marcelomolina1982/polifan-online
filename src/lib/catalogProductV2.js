// Independent catalog API. Do not enable the independent write path until
// all clients and the public catalog have been migrated off app_state.
const validId = id => typeof id === 'string' && id.trim().length > 0 && id === id.trim()

export async function readCatalogProductV2(supabase,id){
  if(!validId(id))throw new Error('Identificador de producto inválido')
  const {data,error}=await supabase.from('catalog_products_v2')
    .select('id,payload,updated_at').eq('id',id).maybeSingle()
  if(error)throw error
  if(data && (!data.payload || data.payload.id !== data.id))throw new Error('Producto independiente inconsistente')
  return data||null
}

export async function readAllCatalogProductsV2(supabase,{pageSize=100}={}){
  if(!Number.isInteger(pageSize)||pageSize<1||pageSize>500)throw new Error('Tamaño de página inválido')
  const all=[]
  let lastId=null
  for(let page=0;page<10000;page++){
    let query=supabase.from('catalog_products_v2').select('id,payload,updated_at').order('id').limit(pageSize)
    if(lastId!==null)query=query.gt('id',lastId)
    const {data,error}=await query
    if(error)throw error
    const rows=data||[]
    for(const row of rows){
      if(!validId(row.id)||!row.payload||row.payload.id!==row.id||(lastId!==null&&row.id<=lastId))
        throw new Error('El catálogo independiente contiene identificadores inconsistentes')
      all.push(row)
      lastId=row.id
    }
    if(rows.length<pageSize)return all
  }
  throw new Error('El catálogo independiente excedió el límite de paginación')
}

export async function mutateCatalogProductV2(supabase,{operation,id,product,expectedRevision=null}){
  if(!['create','update','delete'].includes(operation))throw new Error('Operación de catálogo inválida')
  if(!validId(id))throw new Error('Identificador de producto inválido')
  if(operation==='create'&&expectedRevision!==null)throw new Error('Un producto nuevo no debe traer revisión previa')
  if(operation!=='create'&&(typeof expectedRevision!=='string'||!expectedRevision.trim()))
    throw new Error('Se requiere la revisión original para modificar o eliminar')
  if(operation!=='delete'&&(!product||Array.isArray(product)||typeof product!=='object'||product.id!==id))
    throw new Error('Los datos del producto no coinciden con su identificador')
  if(operation==='delete'&&product!==undefined)throw new Error('La eliminación no acepta contenido')
  const {data,error}=await supabase.rpc('mutate_catalog_product_v2',{
    p_action:operation,
    p_id:id,
    p_payload:operation==='delete'?null:product,
    p_expected_updated_at:expectedRevision
  })
  if(error)throw error
  const result=Array.isArray(data)?data[0]:data
  if(!result||typeof result.applied!=='boolean'||!['created','updated','deleted','conflict'].includes(result.status)||
      (result.applied&&result.status==='conflict')||(!result.applied&&result.status!=='conflict'))
    throw new Error('Respuesta de guardado individual inválida')
  if(!result.applied)return {ok:false,conflict:true,status:'conflict',revision:result.revision||null}
  return {ok:true,operation:result.status,revision:result.revision||null}
}
