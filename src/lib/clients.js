function digits(value){
  return String(value||'').replace(/\D/g,'')
}

function text(value){
  return String(value||'').trim()
}

export function clientFromOrder(order={}){
  return {
    name:text(order.client||order.name),
    phone:text(order.phone),
    dni:text(order.dni),
    address:text(order.address),
    locality:text(order.locality||order.zone),
    province:text(order.province),
    postalCode:text(order.postalCode),
    notes:text(order.clientNotes),
    lastOrderAt:order.delivery||order.date||order.updatedAt||order.createdAt||new Date().toISOString()
  }
}

function sameClient(client,incoming){
  const phoneA=digits(client.phone), phoneB=digits(incoming.phone)
  if(phoneA&&phoneB&&phoneA===phoneB) return true
  const dniA=digits(client.dni), dniB=digits(incoming.dni)
  if(dniA&&dniB&&dniA===dniB) return true
  const nameA=text(client.name).toLocaleLowerCase('es')
  const nameB=text(incoming.name).toLocaleLowerCase('es')
  const cityA=text(client.locality||client.zone).toLocaleLowerCase('es')
  const cityB=text(incoming.locality).toLocaleLowerCase('es')
  return Boolean(nameA&&nameB&&cityA&&cityB&&nameA===nameB&&cityA===cityB)
}

export function upsertClient(clients=[],incomingRaw={}){
  const incoming={...incomingRaw,name:text(incomingRaw.name)}
  if(!incoming.name) return clients
  const index=clients.findIndex(client=>sameClient(client,incoming))
  if(index<0){
    return [...clients,{
      id:crypto.randomUUID(),
      createdAt:new Date().toISOString(),
      ...incoming
    }]
  }
  return clients.map((client,i)=>i===index?{
    ...client,
    ...Object.fromEntries(Object.entries(incoming).filter(([,value])=>text(value)!=='')),
    id:client.id,
    createdAt:client.createdAt||new Date().toISOString(),
    updatedAt:new Date().toISOString()
  }:client)
}

export function upsertClientFromOrder(clients=[],order={}){
  return upsertClient(clients,clientFromOrder(order))
}

export function importClientsFromOrders(clients=[],orders=[]){
  return (orders||[]).reduce((result,order)=>upsertClientFromOrder(result,order),clients||[])
}
