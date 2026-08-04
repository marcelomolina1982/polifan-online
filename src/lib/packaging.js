export const BOX_TYPES = [
  { id:'box-30', name:'Caja 30×20×20 cm', capacity:6, materials:['Caja','Film negro','Cinta'] },
  { id:'box-40', name:'Caja 40×30×30 cm', capacity:12, materials:['Caja','Film negro','Cinta'] },
  { id:'box-cargo', name:'Caja Vía Cargo', capacity:20, note:'Apta para cualquier expreso', materials:['Caja','Film negro','Cinta'] },
  { id:'box-5030', name:'Caja 50×40×30 cm', capacity:24, materials:['Caja','Film negro','Cinta'] },
  { id:'box-5040', name:'Caja 50×40×40 cm', capacity:36, materials:['Caja','Film negro','Cinta'] },
  { id:'box-6040', name:'Caja 60×40×40 cm', capacity:48, materials:['Caja','Film negro','Cinta'] }
]

export function packagingForPieces(value){
  let pieces=Math.max(0,Number(value)||0)
  if(!pieces) return {boxes:[],label:'Sin caja',materials:[]}
  const boxes=[]
  while(pieces>0){
    const box=[...BOX_TYPES].reverse().find(item=>item.capacity<=pieces) || BOX_TYPES.find(item=>item.capacity>=pieces) || BOX_TYPES[0]
    boxes.push(box)
    pieces-=Math.min(pieces,box.capacity)
  }
  const grouped=boxes.reduce((acc,box)=>{acc[box.id]=(acc[box.id]||{...box,qty:0});acc[box.id].qty++;return acc},{})
  const list=Object.values(grouped)
  return {
    boxes:list,
    label:list.map(box=>`${box.qty>1?box.qty+' × ':''}${box.name}`).join(' + '),
    materials:['Film negro','Cinta de embalar']
  }
}
