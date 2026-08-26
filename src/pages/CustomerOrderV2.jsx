import React,{useEffect,useMemo,useState} from 'react'
import {supabase} from '../supabase'
import {normalizeCatalogProducts} from '../lib/catalog'

const money=value=>new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:0}).format(Number(value||0))
const normalize=value=>String(value||'').trim().toLocaleLowerCase('es')

function priceLabel(product){
  if(product?.fixedPrice)return money(product.fixedPrice)
  if(product?.priceUnit)return `Desde ${money(product.priceUnit)}`
  if(product?.category==='Carameleras')return '1 u. $6.000 · 6 u. $25.000 · 12 u. $40.000'
  if(product?.category==='Figuras con luces'||product?.category==='Palabras con luces')return 'Precio según cantidad'
  return 'Consultar precio'
}

export default function CustomerOrderV2(){
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [products,setProducts]=useState([])
  const [search,setSearch]=useState('')
  const [category,setCategory]=useState('Todos')
  const [cart,setCart]=useState({})
  const [selected,setSelected]=useState(null)

  useEffect(()=>{
    let active=true
    ;(async()=>{
      const {data,error}=await supabase.from('app_state').select('data').eq('id','main').maybeSingle()
      if(!active)return
      if(error||!data?.data){setError(error?.message||'No se pudo cargar el catálogo.');setLoading(false);return}
      setProducts(normalizeCatalogProducts(data.data.customerCatalog||[]).filter(p=>p.active!==false))
      setLoading(false)
    })()
    return()=>{active=false}
  },[])

  const categories=useMemo(()=>['Todos',...new Set(products.map(p=>p.category).filter(Boolean))],[products])
  const visible=useMemo(()=>{
    const term=normalize(search)
    return products.filter(p=>(category==='Todos'||p.category===category)&&(!term||normalize(`${p.name} ${p.category} ${p.measure||''}`).includes(term)))
  },[products,search,category])
  const totalQty=Object.values(cart).reduce((a,b)=>a+Number(b||0),0)

  function qty(id){return Number(cart[id]||0)}
  function change(id,delta){setCart(prev=>({...prev,[id]:Math.max(0,Number(prev[id]||0)+delta)}))}

  if(loading)return <div style={styles.loading}>Preparando Catálogo V2…</div>
  if(error)return <div style={styles.loading}>No se pudo cargar el laboratorio: {error}</div>

  return <div style={styles.page}>
    <style>{css}</style>
    <header className="v2-header">
      <div className="v2-brand">
        <img src="/apple-touch-icon.png" alt="Tu Vida En Tinta"/>
        <div><strong>Tu Vida En Tinta</strong><span>Figuras de polifan hechas para destacar</span></div>
      </div>
      <div className="v2-lab">CATÁLOGO V2 · LABORATORIO</div>
    </header>

    <main>
      <section className="v2-hero">
        <div className="v2-hero-copy">
          <span className="v2-eyebrow">Diseños para eventos, regalos y decoración</span>
          <h1>Encontrá tu figura.<br/><em>Nosotros la hacemos realidad.</em></h1>
          <p>Explorá el catálogo, elegí tus modelos favoritos y armá tu pedido de forma simple. Esta es la nueva experiencia que estamos probando.</p>
          <div className="v2-hero-actions">
            <button onClick={()=>document.getElementById('v2-catalog')?.scrollIntoView({behavior:'smooth'})}>Ver figuras</button>
            <span>{products.length} modelos disponibles</span>
          </div>
        </div>
        <div className="v2-hero-card">
          <div><b>Producción real</b><span>Hecho en nuestro taller</span></div>
          <div><b>Compra por cantidad</b><span>Promos que mejoran al sumar</span></div>
          <div><b>Envíos y retiro</b><span>Opciones para GBA/CABA y todo el país</span></div>
        </div>
      </section>

      <section id="v2-catalog" className="v2-catalog">
        <div className="v2-section-head">
          <div><span className="v2-eyebrow">Catálogo</span><h2>Elegí lo que te gusta</h2></div>
          <label className="v2-search"><span>⌕</span><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar figura…"/></label>
        </div>

        <div className="v2-categories" aria-label="Categorías">
          {categories.map(c=><button key={c} className={category===c?'active':''} onClick={()=>setCategory(c)}>{c}</button>)}
        </div>

        <div className="v2-result-row"><b>{visible.length}</b> resultados <span>·</span> {category}</div>

        <div className="v2-grid">
          {visible.map(product=>{
            const count=qty(product.id)
            return <article className="v2-product" key={product.id}>
              <button className="v2-image" onClick={()=>setSelected(product)} aria-label={`Ver ${product.name}`}>
                {product.image?<img src={product.image} alt={product.name} loading="lazy"/>:<div className="v2-placeholder">TVT</div>}
                {count>0&&<span className="v2-count">{count}</span>}
              </button>
              <div className="v2-product-body">
                <span className="v2-product-cat">{product.category}</span>
                <h3>{product.name}</h3>
                {product.measure&&<p>{product.measure}</p>}
                <small>{priceLabel(product)}</small>
                <div className="v2-stepper">
                  <button onClick={()=>change(product.id,-1)} disabled={!count}>−</button>
                  <b>{count}</b>
                  <button onClick={()=>change(product.id,1)}>+</button>
                </div>
              </div>
            </article>
          })}
        </div>
      </section>
    </main>

    <aside className={`v2-cart ${totalQty?'show':''}`}>
      <div><small>Tu selección</small><b>{totalQty} {totalQty===1?'figura':'figuras'}</b></div>
      <button onClick={()=>alert('Laboratorio V2: todavía no envía pedidos. Primero estamos validando la experiencia visual y de selección.')}>Continuar pedido <span>→</span></button>
    </aside>

    {selected&&<div className="v2-modal" onClick={()=>setSelected(null)}>
      <div className="v2-modal-card" onClick={e=>e.stopPropagation()}>
        <button className="v2-close" onClick={()=>setSelected(null)}>×</button>
        {selected.image&&<img src={selected.image} alt={selected.name}/>} 
        <span className="v2-product-cat">{selected.category}</span>
        <h2>{selected.name}</h2>
        <p>{selected.measure||'Figura de polifan'}</p>
        <small>{priceLabel(selected)}</small>
        <button className="v2-add" onClick={()=>{change(selected.id,1);setSelected(null)}}>Agregar a mi selección</button>
      </div>
    </div>}

    <footer className="v2-footer"><b>Tu Vida En Tinta</b><span>Catálogo V2 en desarrollo · ninguna prueba modifica producción ni inventario.</span></footer>
  </div>
}

const styles={page:{minHeight:'100vh',background:'#f7f5f3',color:'#102238'},loading:{minHeight:'100vh',display:'grid',placeItems:'center',fontFamily:'Inter,system-ui,sans-serif',background:'#f7f5f3',color:'#102238'}}

const css=`
*{box-sizing:border-box}.v2-header,.v2-hero,.v2-catalog,.v2-footer{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.v2-header{position:sticky;top:0;z-index:20;display:flex;align-items:center;justify-content:space-between;padding:14px clamp(18px,4vw,64px);background:rgba(247,245,243,.92);backdrop-filter:blur(18px);border-bottom:1px solid rgba(16,34,56,.08)}.v2-brand{display:flex;align-items:center;gap:12px}.v2-brand img{width:48px;height:48px;border-radius:50%;box-shadow:0 8px 24px rgba(16,34,56,.12)}.v2-brand div{display:flex;flex-direction:column}.v2-brand strong{font-size:15px;letter-spacing:.02em}.v2-brand span{font-size:12px;color:#687386}.v2-lab{font-size:11px;font-weight:800;letter-spacing:.14em;color:#a93570;background:#f7e8f0;border:1px solid #edc8da;padding:8px 12px;border-radius:999px}.v2-hero{max-width:1440px;margin:auto;display:grid;grid-template-columns:minmax(0,1.4fr) minmax(280px,.6fr);gap:36px;padding:clamp(54px,8vw,110px) clamp(20px,5vw,78px) 64px}.v2-hero-copy{max-width:850px}.v2-eyebrow{text-transform:uppercase;letter-spacing:.16em;font-size:11px;font-weight:800;color:#a93570}.v2-hero h1{font-size:clamp(42px,7vw,92px);line-height:.95;letter-spacing:-.055em;margin:18px 0 26px;font-weight:800}.v2-hero h1 em{font-style:normal;color:#12a8b5}.v2-hero p{font-size:clamp(17px,2vw,21px);line-height:1.6;max-width:700px;color:#617083}.v2-hero-actions{display:flex;gap:18px;align-items:center;margin-top:30px}.v2-hero-actions button,.v2-cart button,.v2-add{border:0;background:#102238;color:white;border-radius:14px;padding:15px 22px;font-weight:800;cursor:pointer;box-shadow:0 12px 30px rgba(16,34,56,.18)}.v2-hero-actions span{font-size:13px;color:#687386;font-weight:700}.v2-hero-card{align-self:end;background:#102238;color:white;padding:28px;border-radius:28px;box-shadow:0 30px 80px rgba(16,34,56,.18)}.v2-hero-card div{display:flex;flex-direction:column;gap:5px;padding:18px 0;border-bottom:1px solid rgba(255,255,255,.12)}.v2-hero-card div:last-child{border-bottom:0}.v2-hero-card b{font-size:15px}.v2-hero-card span{font-size:13px;color:#b9c3cf}.v2-catalog{max-width:1440px;margin:auto;padding:50px clamp(20px,5vw,78px) 130px}.v2-section-head{display:flex;align-items:end;justify-content:space-between;gap:24px;margin-bottom:24px}.v2-section-head h2{font-size:clamp(30px,4vw,52px);letter-spacing:-.04em;margin:7px 0 0}.v2-search{width:min(390px,100%);display:flex;align-items:center;gap:9px;background:white;border:1px solid #dedede;border-radius:16px;padding:0 16px;box-shadow:0 8px 26px rgba(16,34,56,.06)}.v2-search input{width:100%;border:0;outline:0;background:transparent;padding:15px 0;font-size:15px}.v2-categories{display:flex;gap:9px;overflow:auto;padding:5px 0 12px;scrollbar-width:none}.v2-categories button{flex:none;border:1px solid #d9d9d9;background:white;color:#334257;padding:10px 15px;border-radius:999px;font-weight:700;cursor:pointer;transition:.2s ease}.v2-categories button.active{background:#102238;color:white;border-color:#102238;transform:translateY(-1px)}.v2-result-row{font-size:13px;color:#758092;margin:10px 0 18px}.v2-result-row b{color:#102238}.v2-result-row span{padding:0 5px}.v2-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18px}.v2-product{background:white;border-radius:22px;overflow:hidden;border:1px solid rgba(16,34,56,.07);box-shadow:0 12px 36px rgba(16,34,56,.055);transition:transform .22s ease,box-shadow .22s ease}.v2-product:hover{transform:translateY(-4px);box-shadow:0 20px 50px rgba(16,34,56,.11)}.v2-image{display:block;position:relative;width:100%;aspect-ratio:1/1;border:0;padding:0;background:#eee;cursor:zoom-in;overflow:hidden}.v2-image img{width:100%;height:100%;object-fit:cover;transition:transform .35s ease}.v2-product:hover .v2-image img{transform:scale(1.035)}.v2-placeholder{width:100%;height:100%;display:grid;place-items:center;font-weight:900;font-size:32px;color:#a4adb7;background:linear-gradient(135deg,#eef1f2,#fafafa)}.v2-count{position:absolute;right:12px;top:12px;display:grid;place-items:center;min-width:31px;height:31px;padding:0 8px;border-radius:999px;background:#12a8b5;color:#fff;font-weight:900;box-shadow:0 6px 20px rgba(18,168,181,.35)}.v2-product-body{padding:17px}.v2-product-cat{display:block;color:#a93570;text-transform:uppercase;letter-spacing:.11em;font-size:10px;font-weight:900}.v2-product h3{font-size:18px;margin:6px 0 5px;line-height:1.2}.v2-product p{font-size:12px;color:#7b8491;margin:0 0 8px}.v2-product small,.v2-modal-card small{display:block;color:#4d5a6a;font-weight:700;min-height:34px}.v2-stepper{display:grid;grid-template-columns:40px 1fr 40px;align-items:center;margin-top:14px;background:#f3f4f4;border-radius:13px;overflow:hidden}.v2-stepper button{height:40px;border:0;background:transparent;font-size:20px;cursor:pointer}.v2-stepper button:disabled{opacity:.25}.v2-stepper b{text-align:center}.v2-cart{position:fixed;z-index:30;left:50%;bottom:18px;transform:translate(-50%,140%);width:min(720px,calc(100% - 28px));display:flex;align-items:center;justify-content:space-between;gap:20px;padding:13px 14px 13px 20px;border-radius:20px;background:rgba(255,255,255,.96);border:1px solid rgba(16,34,56,.1);box-shadow:0 18px 65px rgba(16,34,56,.2);backdrop-filter:blur(18px);transition:transform .3s cubic-bezier(.2,.8,.2,1)}.v2-cart.show{transform:translate(-50%,0)}.v2-cart div{display:flex;flex-direction:column}.v2-cart small{color:#788493}.v2-cart button{padding:13px 18px}.v2-cart button span{padding-left:10px}.v2-modal{position:fixed;z-index:100;inset:0;background:rgba(9,21,35,.55);display:grid;place-items:center;padding:20px;backdrop-filter:blur(10px)}.v2-modal-card{position:relative;width:min(480px,100%);max-height:90vh;overflow:auto;background:white;border-radius:28px;padding:18px;box-shadow:0 35px 100px rgba(0,0,0,.25);font-family:Inter,system-ui,sans-serif}.v2-modal-card>img{width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:20px;margin-bottom:18px}.v2-modal-card h2{font-size:30px;letter-spacing:-.03em;margin:7px 0}.v2-modal-card p{color:#697687}.v2-close{position:absolute;z-index:2;right:28px;top:28px;width:38px;height:38px;border-radius:50%;border:0;background:rgba(16,34,56,.88);color:white;font-size:24px;cursor:pointer}.v2-add{width:100%;margin-top:18px}.v2-footer{max-width:1440px;margin:auto;padding:25px clamp(20px,5vw,78px) 110px;display:flex;justify-content:space-between;gap:20px;color:#788493;font-size:12px}.v2-footer b{color:#102238}@media(max-width:1000px){.v2-grid{grid-template-columns:repeat(3,1fr)}.v2-hero{grid-template-columns:1fr}.v2-hero-card{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.v2-hero-card div{border:0;padding:5px}}@media(max-width:720px){.v2-header{padding:10px 14px}.v2-brand img{width:42px;height:42px}.v2-brand span{display:none}.v2-lab{font-size:8px;padding:7px 9px}.v2-hero{padding:48px 18px 36px;gap:24px}.v2-hero h1{font-size:46px}.v2-hero p{font-size:16px}.v2-hero-actions{align-items:flex-start;flex-direction:column}.v2-hero-card{grid-template-columns:1fr;padding:20px;border-radius:22px}.v2-hero-card div{padding:8px 0}.v2-catalog{padding:36px 14px 120px}.v2-section-head{align-items:stretch;flex-direction:column}.v2-search{width:100%}.v2-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.v2-product{border-radius:17px}.v2-product-body{padding:12px}.v2-product h3{font-size:15px}.v2-product small{font-size:11px;min-height:38px}.v2-stepper{grid-template-columns:34px 1fr 34px}.v2-cart{bottom:10px}.v2-cart button{font-size:12px;padding:12px}.v2-footer{padding:20px 16px 110px;flex-direction:column}}@media(max-width:390px){.v2-grid{grid-template-columns:1fr 1fr}.v2-hero h1{font-size:40px}}
`
