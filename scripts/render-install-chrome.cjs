const {execSync}=require('node:child_process')
const fs=require('node:fs')
const path=require('node:path')

const target='srv-da9fv9pf2nfc73fefn4g'
if(String(process.env.RENDER_SERVICE_ID||'')!==target){
  console.log('render-install-chrome: skip outside Via Cargo service')
  process.exit(0)
}

const cacheDir=process.env.PUPPETEER_CACHE_DIR||path.join(process.cwd(),'.cache','puppeteer')
fs.mkdirSync(cacheDir,{recursive:true})
console.log('render-install-chrome: installing Chrome into '+cacheDir)
execSync('npx puppeteer browsers install chrome',{stdio:'inherit',env:{...process.env,PUPPETEER_CACHE_DIR:cacheDir}})
console.log('render-install-chrome: Chrome ready')
