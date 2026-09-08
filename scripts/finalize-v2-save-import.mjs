import fs from 'node:fs'

const file='src/AppV2.jsx'
let src=fs.readFileSync(file,'utf8')
const importRx=/import\s*\{([^}]*)\}\s*from\s*['"]\.\/lib\/v2Data['"]/
const match=src.match(importRx)
if(!match)throw new Error('v2 save import: no se encontró import de v2Data')
const names=match[1].split(',').map(x=>x.trim()).filter(Boolean)
if(!names.includes('patchV2Sections'))names.splice(Math.min(1,names.length),0,'patchV2Sections')
const replacement=`import {${[...new Set(names)].join(',')}} from './lib/v2Data'`
src=src.replace(importRx,replacement)
fs.writeFileSync(file,src)
if(!/import\s*\{[^}]*patchV2Sections[^}]*\}\s*from\s*['"]\.\/lib\/v2Data['"]/.test(src))throw new Error('v2 save import: patchV2Sections no quedó importado')
console.log('V2 SAVE IMPORT OK · patchV2Sections disponible en runtime')
