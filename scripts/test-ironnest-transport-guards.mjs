import fs from 'node:fs'
const lib=fs.readFileSync('src/lib/ironnestLab.js','utf8')
const must=(ok,msg)=>{if(!ok)throw new Error('IRONNEST TRANSPORT: '+msg)}
must(lib.includes('408,425,429,500,502,503,504'),'faltan estados HTTP transitorios protegidos')
must(lib.includes('IronNest devolvio una respuesta transitoria'),'HTML/gateway transitorio no está diferenciado')
must(/respuesta transitoria \\\((?:[\s\S]*?)\\\)/.test(lib)||lib.includes('respuesta transitoria \\((?:408|425|429|500|502|503|504)\\)'),'clasificador no contempla respuesta transitoria')
must(lib.includes('timeoutMs=900000'),'timeout principal dejó de ser 15 minutos')
must(lib.includes('timeoutMs:300000'),'crecimiento dejó de tener ventana de 5 minutos')
console.log('IRONNEST TRANSPORT GUARDS OK · gateway, timeout y recuperación protegidos')
