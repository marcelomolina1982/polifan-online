const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()

export const LOGISTICS_ZONES=[
  {id:'ZONA 1',price:4000,places:['caba','ciudad autonoma de buenos aires','capital federal','vicente lopez','san isidro','san fernando','general san martin','gral san martin','tres de febrero']},
  {id:'GBA 1',price:5000,places:['tigre','malvinas argentinas','hurlingham','ituzaingo','moron','la matanza norte','lanus','avellaneda']},
  {id:'GBA 2',price:6000,places:['escobar','maschwitz','ingeniero maschwitz','garin','del viso','derqui','presidente derqui','jose c paz','jose c. paz','san miguel','moreno','merlo','la matanza','esteban echeverria','ezeiza','almirante brown','florencio varela','berazategui','quilmes']},
  {id:'GBA 3',price:8500,places:['zarate','campana','villa rosa','pilar','general rodriguez','gral rodriguez','marcos paz','lujan','canuelas','san vicente','ensenada','berisso','la plata']}
]

const LOCALITY_ALIASES={
  'jose leon suarez':'general san martin','villa ballester':'general san martin','san martin':'general san martin','billinghurst':'general san martin','villa maipu':'general san martin',
  'olivos':'vicente lopez','florida':'vicente lopez','munro':'vicente lopez','villa martelli':'vicente lopez','carapachay':'vicente lopez','la lucila':'vicente lopez',
  'martinez':'san isidro','acassuso':'san isidro','beccar':'san isidro','boulogne':'san isidro','villa adelina':'san isidro',
  'victoria':'san fernando','virreyes':'san fernando','carupa':'san fernando',
  'caseros':'tres de febrero','santos lugares':'tres de febrero','saenz pena':'tres de febrero','ciudad jardin':'tres de febrero','ciudadela':'tres de febrero',
  'don torcuato':'tigre','general pacheco':'tigre','pacheco':'tigre','el talar':'tigre','benavidez':'tigre','ricardo rojas':'tigre',
  'grand bourg':'malvinas argentinas','los polvorines':'malvinas argentinas','tortuguitas':'malvinas argentinas','villa de mayo':'malvinas argentinas',
  'villa tesei':'hurlingham','william morris':'hurlingham','castelar':'moron','haedo':'moron','el palomar':'moron',
  'remedios de escalada':'lanus','valentin alsina':'lanus','monte chingolo':'lanus','wilde':'avellaneda','sarandi':'avellaneda','dock sud':'avellaneda','gerli':'avellaneda',
  'ingeniero maschwitz':'escobar','belen de escobar':'escobar','matheu':'escobar','garin':'escobar','del viso':'pilar','presidente derqui':'pilar','derqui':'pilar','villa rosa':'pilar',
  'bella vista':'san miguel','muniz':'san miguel','francisco alvarez':'moreno','paso del rey':'moreno','trujui':'moreno','san antonio de padua':'merlo','libertad':'merlo','parque san martin':'merlo',
  'monte grande':'esteban echeverria','luis guillon':'esteban echeverria','el jaguel':'esteban echeverria','tristan suarez':'ezeiza','canning':'ezeiza',
  'adrogue':'almirante brown','burzaco':'almirante brown','longchamps':'almirante brown','claypole':'almirante brown','glew':'almirante brown','bosques':'florencio varela','ingeniero allan':'florencio varela',
  'ranelagh':'berazategui','hudson':'berazategui','platanos':'berazategui','bernal':'quilmes','ezpeleta':'quilmes','don bosco':'quilmes',
  'city bell':'la plata','gonnet':'la plata','tolosa':'la plata','los hornos':'la plata','villa elisa':'la plata'
}

const zoneForName=raw=>{
  const n=normalize(raw)
  if(!n)return null
  const aliased=normalize(LOCALITY_ALIASES[n]||n)
  for(const zone of LOGISTICS_ZONES){if(zone.places.some(place=>aliased===normalize(place)))return zone}
  return null
}

export function resolveLogisticsZone({locality='',district='',province='',postalCode=''}={}){
  const provinceN=normalize(province)
  if(provinceN&&!(provinceN.includes('buenos aires')||provinceN==='caba'||provinceN.includes('capital federal')))return null
  const districtZone=zoneForName(district)
  const localityZone=zoneForName(locality)
  const zone=districtZone||localityZone
  if(!zone)return null
  return {...zone,locality:String(locality||'').trim(),district:String(district||'').trim(),postalCode:String(postalCode||'').trim(),source:districtZone?'district':'locality'}
}

// Regression checks for money-sensitive logistics. Quantity is intentionally absent:
// local logistics price MUST depend only on the resolved zone, never order size.
export const LOGISTICS_MONEY_REGRESSION_CASES=[
  [{locality:'José León Suárez',district:'General San Martín',province:'Buenos Aires'},'ZONA 1',4000],
  [{locality:'Boulogne',district:'San Isidro',province:'Buenos Aires'},'ZONA 1',4000],
  [{locality:'Villa Tesei',district:'Hurlingham',province:'Buenos Aires'},'GBA 1',5000],
  [{locality:'Don Torcuato',district:'Tigre',province:'Buenos Aires'},'GBA 1',5000],
  [{locality:'Bernal',district:'Quilmes',province:'Buenos Aires'},'GBA 2',6000],
  [{locality:'Del Viso',district:'Pilar',province:'Buenos Aires'},'GBA 3',8500],
  [{locality:'City Bell',district:'La Plata',province:'Buenos Aires'},'GBA 3',8500]
]

export function runLogisticsMoneyRegression(){
  const failures=[]
  for(const [input,expectedZone,expectedPrice] of LOGISTICS_MONEY_REGRESSION_CASES){
    const got=resolveLogisticsZone(input)
    if(!got||got.id!==expectedZone||got.price!==expectedPrice)failures.push({input,expectedZone,expectedPrice,got})
  }
  const outside=resolveLogisticsZone({locality:'Rosario',district:'Rosario',province:'Santa Fe'})
  if(outside!==null)failures.push({input:'Rosario/Santa Fe',expected:null,got:outside})
  return {ok:failures.length===0,total:LOGISTICS_MONEY_REGRESSION_CASES.length+1,failures}
}
