const CACHE_KEY='polifan-v2-section-cache'

// Mantiene los datos cacheados para pintar rápido, pero nunca los considera
// "confirmados" después de una recarga completa. Así la V2 muestra el último
// estado conocido de inmediato y revalida sólo el módulo abierto contra Supabase.
export function prepareV2CacheForBoot(){
  try{
    const cached=JSON.parse(localStorage.getItem(CACHE_KEY)||'{}')
    if(!cached||typeof cached!=='object')return
    const next={...cached,keys:[],bootRevalidateAt:Date.now()}
    localStorage.setItem(CACHE_KEY,JSON.stringify(next))
  }catch{}
}

prepareV2CacheForBoot()
