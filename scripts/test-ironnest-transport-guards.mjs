import fs from 'node:fs'
const lib=fs.readFileSync('src/lib/ironnestLab.js','utf8')
const motor=fs.readFileSync('src/pages/MotorDefinitivo.jsx','utf8')
const must=(ok,msg)=>{if(!ok)throw new Error('IRONNEST TRANSPORT: '+msg)}
must(lib.includes('408,425,429,500,502,503,504'),'faltan estados HTTP transitorios protegidos')
must(lib.includes('IronNest devolvio una respuesta transitoria'),'HTML/gateway transitorio no está diferenciado')
must(lib.includes('respuesta transitoria \\((?:408|425|429|500|502|503|504)\\)'),'clasificador no contempla respuesta transitoria')
must(lib.includes('timeoutMs=900000'),'timeout principal dejó de ser 15 minutos')
must(lib.includes('const baseVariants=uniqueKitVariants(ordered,baseTarget)'),'IronNest dejó de generar variantes de base productiva')
must(lib.includes('base productiva ·'),'IronNest dejó de probar variantes de 10 completas')
must(lib.includes('probando crecimiento a'),'IronNest dejó de crecer incrementalmente después de la base')
must(motor.includes('isIronNestTransientError(error)'),'Motor perdió la recuperación de errores transitorios')
must(motor.includes('loadActiveJob()?.jobId'),'Motor volvió a prometer recuperación sin jobId')
console.log('IRONNEST TRANSPORT GUARDS OK · gateway, timeout y recuperación protegidos')
