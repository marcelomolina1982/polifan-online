const puppeteer=require('puppeteer')

const FORM_URL=process.env.VIACARGO_FORM_URL||'https://formularios.viacargo.com.ar/'

function parseOfficial(value){
  const match=String(value||'').trim().match(/^(.+?)\s*\((\d{4})\)\s*-\s*(.+)$/)
  if(!match)return null
  return {destination:String(value).trim(),locality:match[1].trim(),cp:match[2],province:match[3].trim()}
}

async function selectAll(page){
  await page.keyboard.down('Control');await page.keyboard.press('a');await page.keyboard.up('Control')
}

async function readInput(page,index){return page.evaluate(i=>document.querySelectorAll('input')[i]?.value||'',index)}

async function fillAutocomplete(page,index,value){
  await page.evaluate(i=>{const input=document.querySelectorAll('input')[i];if(!input)throw new Error('input '+i+' missing');input.focus()},index)
  await selectAll(page)
  await page.keyboard.type(String(value),{delay:3})
  for(const wait of [350,650,1000]){
    await new Promise(resolve=>setTimeout(resolve,wait))
    await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await new Promise(resolve=>setTimeout(resolve,100))
    const selected=await readInput(page,index)
    if(/\(\d{4}\)/.test(selected))return selected
  }
  return readInput(page,index)
}

async function resolveViaCargoDestination(input={}){
  const query=String(input.query||input.cp||input.locality||'').trim()
  if(!query)throw new Error('Ingresá un código postal o una localidad')
  let browser=null,page=null
  try{
    browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-first-run','--no-zygote']})
    page=await browser.newPage()
    await page.setRequestInterception(true)
    page.on('request',request=>['image','font','media','stylesheet'].includes(request.resourceType())?request.abort():request.continue())
    await page.goto(FORM_URL,{waitUntil:'domcontentloaded',timeout:25000})
    const selected=await fillAutocomplete(page,1,query)
    const official=parseOfficial(selected)
    if(!official)throw new Error('Vía Cargo no encontró un destino válido para "'+query+'"')
    return {ok:true,...official,query}
  }finally{
    if(page)await page.close().catch(()=>{})
    if(browser)await browser.close().catch(()=>{})
  }
}

module.exports={resolveViaCargoDestination,parseOfficial}
