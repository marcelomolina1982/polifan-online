import assert from 'node:assert/strict'
import {changedTopLevelKeys,mergeArrayById} from '../src/lib/stateMerge.js'

const product=(id,name)=>({id,name})
const base=[product('a','Original')]
const fromOtherComputer=[...base,product('b','Nuevo remoto')]
const local=[product('a','Editado local')]
const combined=mergeArrayById(base,fromOtherComputer,local,'customerCatalog')
assert.equal(combined.ok,true,'Two users editing different products should merge')
assert.deepEqual(combined.value,[product('a','Editado local'),product('b','Nuevo remoto')])

const sameProduct=mergeArrayById(base,[product('a','Otro cambio')],local,'customerCatalog')
assert.equal(sameProduct.ok,false,'Two users editing the same product must conflict')
assert.deepEqual(sameProduct.conflicts,['a'])

const originalOrders=[{id:'o1',status:'Pendiente'}]
const remoteOrders=[...originalOrders,{id:'o2',status:'Nuevo'}]
const localOrders=[{id:'o1',status:'Preparando'}]
const savedOrders=mergeArrayById(originalOrders,remoteOrders,localOrders,'orders')
assert.equal(savedOrders.ok,true)
assert.deepEqual(savedOrders.value,[
  {id:'o1',status:'Preparando'},
  {id:'o2',status:'Nuevo'}
],'Remote order must survive an unrelated local change')

const batchesBase=[{id:'batch1',quantity:10,notes:'Inicial'}]
const batchesRemote=[{id:'batch1',quantity:10,notes:'Actualizado remoto'}]
const batchesLocal=[{id:'batch1',quantity:12,notes:'Inicial'}]
const batchesCombined=mergeArrayById(batchesBase,batchesRemote,batchesLocal,'cutBatches')
assert.equal(batchesCombined.ok,true,'Independent fields in same batch should merge')
assert.deepEqual(batchesCombined.value,[{id:'batch1',quantity:12,notes:'Actualizado remoto'}])

const batchClash=mergeArrayById(batchesBase,[{id:'batch1',quantity:11,notes:'Inicial'}],batchesLocal,'cutBatches')
assert.equal(batchClash.ok,false,'Conflicting batch quantity updates must be blocked')

assert.deepEqual(changedTopLevelKeys({orders:[1],stock:2},{orders:[1],stock:3}),['stock'])
assert.deepEqual(changedTopLevelKeys({orders:[1]},{orders:[1]}),[])
console.log('OK: distinct products/orders/batch fields merge, conflicting updates are blocked')
