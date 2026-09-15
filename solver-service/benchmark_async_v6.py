import threading, time, uuid
from flask import jsonify, request
import benchmark_routes as br

app = br.app
_jobs = {}
_lock = threading.Lock()


def _work(job_id, svg_text):
    with _lock:
        _jobs[job_id] = {'status':'running','startedAt':time.time()}
    try:
        payload, status = br._execute_svg(svg_text)
        result = {'status':'done' if status < 400 else 'error','httpStatus':status,'result':payload,'finishedAt':time.time()}
    except Exception as exc:
        result = {'status':'error','httpStatus':500,'result':{'ok':False,'error':str(exc)},'finishedAt':time.time()}
    with _lock:
        _jobs.setdefault(job_id,{}).update(result)


@app.get('/upload-benchmark-v6')
def upload_benchmark_v6_page():
    return '''<!doctype html>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Motor V6</title>
<body style="font-family:Arial;max-width:720px;margin:24px auto;padding:18px">
<h2>Motor V6 · prueba 1230×580</h2>
<p style="line-height:1.45">Prueba aislada: SVG → motor → resultado. No usa el estado de pedidos ni Supabase.</p>
<input id="f" type="file" style="display:block;margin:14px 0">
<details style="margin:14px 0"><summary>Alternativa si Android no muestra el archivo</summary><p>Pegá acá el contenido completo del SVG.</p><textarea id="t" rows="8" style="width:100%;box-sizing:border-box" placeholder="<svg ...>...</svg>"></textarea></details>
<button id="b" style="margin:16px 0;padding:12px 18px">Buscar placa</button>
<div id="s"></div><pre id="r" style="white-space:pre-wrap;overflow-wrap:anywhere"></pre>
<script>
const f=document.getElementById('f'),t=document.getElementById('t'),b=document.getElementById('b'),s=document.getElementById('s'),r=document.getElementById('r');
const sleep=ms=>new Promise(x=>setTimeout(x,ms));
async function getJSON(url,opt,tries=4){let last;for(let i=0;i<tries;i++){try{let x=await fetch(url,opt);let txt=await x.text();let j=JSON.parse(txt);if(!x.ok&&x.status>=500)throw new Error('HTTP '+x.status);return j}catch(e){last=e;if(i<tries-1)await sleep(1200*(i+1))}}throw last}
b.onclick=async()=>{
 const file=f.files[0],raw=(t.value||'').trim();if(!file&&!raw)return alert('Elegí un archivo SVG o pegá su contenido.');if(file&&!file.name.toLowerCase().endsWith('.svg'))return alert('El archivo tiene que ser .svg');if(raw&&!raw.includes('<svg'))return alert('El texto pegado no parece un SVG válido.');
 b.disabled=true;s.textContent='Procesando…';r.textContent='';let fd=new FormData();if(file)fd.append('file',file);else fd.append('svg_text',raw);
 try{let j=await getJSON('/benchmark-v6-start',{method:'POST',body:fd});if(!j.jobId){s.textContent='Error';r.textContent=JSON.stringify(j,null,2);b.disabled=false;return}let id=j.jobId;
  while(true){await sleep(2000);try{let z=await getJSON('/benchmark-v6-status?id='+encodeURIComponent(id),undefined,3);if(z.status==='running'||z.status==='queued'){s.textContent='Procesando… '+Math.round((Date.now()-j.startedAt*1000)/1000)+' s';continue}b.disabled=false;s.textContent=z.status==='done'?'Terminado':'No encontró una placa válida';r.textContent=JSON.stringify(z.result,null,2);break}catch(e){s.textContent='Reconectando con el resultado…';await sleep(2500)}}
 }catch(e){b.disabled=false;s.textContent='Error al iniciar';r.textContent=String(e)}
};
</script></body>'''


@app.post('/benchmark-v6-start')
def benchmark_v6_start():
    up=request.files.get('file');raw_text=str(request.form.get('svg_text') or '').strip()
    if not up and not raw_text:return jsonify(ok=False,error='Falta archivo SVG o contenido SVG'),400
    try:svg_text=up.read().decode('utf-8-sig') if up else raw_text
    except Exception as exc:return jsonify(ok=False,error=str(exc)),422
    if '<svg' not in svg_text.lower():return jsonify(ok=False,error='El contenido no parece ser un SVG válido'),422
    job_id=uuid.uuid4().hex;started=time.time()
    with _lock:_jobs[job_id]={'status':'queued','startedAt':started}
    threading.Thread(target=_work,args=(job_id,svg_text),daemon=True).start()
    return jsonify(ok=True,jobId=job_id,status='running',startedAt=started,isolatedBenchmark=True)


@app.get('/benchmark-v6-status')
def benchmark_v6_status():
    job_id=str(request.args.get('id') or '')
    with _lock:job=dict(_jobs.get(job_id) or {})
    if not job:return jsonify(ok=False,error='Trabajo de benchmark no encontrado'),404
    job['ok']=True;job['isolatedBenchmark']=True
    return jsonify(job)


@app.get('/benchmark-v6-health')
def benchmark_v6_health():
    return jsonify(ok=True,isolatedBenchmark=True,externalState=False,supabase=False,jobStore='memory')
