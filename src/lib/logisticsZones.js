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

// Money-sensitive regression: local logistics price depends ONLY on zone, never order quantity.
export const LOGISTICS_MONEY_REGRESSION_CASES=[
  [{locality:'José León Suárez',district:'General San Martín',province:'Buenos Aires'},'ZONA 1',4000,'localidad + partido'],
  [{locality:'Boulogne',district:'San Isidro',province:'Buenos Aires'},'ZONA 1',4000,'alias localidad'],
  [{locality:'Villa Tesei',district:'Hurlingham',province:'Buenos Aires'},'GBA 1',5000,'GBA 1'],
  [{locality:'Don Torcuato',district:'Tigre',province:'Buenos Aires'},'GBA 1',5000,'GBA 1 alias'],
  [{locality:'Bernal',district:'Quilmes',province:'Buenos Aires'},'GBA 2',6000,'GBA 2'],
  [{locality:'Del Viso',district:'Pilar',province:'Buenos Aires'},'GBA 3',8500,'partido prevalece sobre alias de zona menor'],
  [{locality:'City Bell',district:'La Plata',province:'Buenos Aires'},'GBA 3',8500,'GBA 3'],
  [{locality:'Localidad no listada',district:'Quilmes',province:'Buenos Aires'},'GBA 2',6000,'localidad desconocida pero partido cubierto'],
  [{locality:'Bernal',district:'La Plata',province:'Buenos Aires'},'GBA 3',8500,'partido prevalece ante datos contradictorios']
]

export function runLogisticsMoneyRegression(){
  const failures=[]
  for(const [input,expectedZone,expectedPrice,label] of LOGISTICS_MONEY_REGRESSION_CASES){
    const got=resolveLogisticsZone(input)
    if(!got||got.id!==expectedZone||got.price!==expectedPrice)failures.push({label,input,expectedZone,expectedPrice,got})
    for(const quantity of [1,6,12,24,50]){
      const again=resolveLogisticsZone({...input,quantity})
      if(!again||again.id!==expectedZone||again.price!==expectedPrice)failures.push({label:`${label} · quantity=${quantity}`,input,expectedZone,expectedPrice,got:again})
    }
  }
  const outsideCases=[
    {locality:'Rosario',district:'Rosario',province:'Santa Fe'},
    {locality:'Córdoba',district:'Capital',province:'Córdoba'},
    {locality:'Localidad desconocida',district:'Partido desconocido',province:'Buenos Aires'}
  ]
  for(const input of outsideCases){const got=resolveLogisticsZone(input);if(got!==null)failures.push({label:'sin cobertura debe quedar sin precio',input,expected:null,got})}
  return {ok:failures.length===0,total:LOGISTICS_MONEY_REGRESSION_CASES.length*6+outsideCases.length,failures}
}
