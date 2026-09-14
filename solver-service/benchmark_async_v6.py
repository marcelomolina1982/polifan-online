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
        _jobs[job_id].update(result)


@app.get('/upload-benchmark-v6')
def upload_benchmark_v6_page():
    return '''<!doctype html>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Motor V6</title>
<body style="font-family:Arial;max-width:720px;margin:24px auto;padding:18px">
<h2>Motor V6 · prueba 1230×580</h2>
<p style="line-height:1.45">En celular tocá <b>Elegir archivo</b> y seleccioná el SVG desde <b>Archivos / Mis archivos</b>. Este selector ya no está limitado a imágenes.</p>
<input id="f" type="file" style="display:block;margin:14px 0">
<details style="margin:14px 0"><summary>Alternativa si Android no muestra el archivo</summary><p>Pegá acá el contenido completo del SVG.</p><textarea id="t" rows="8" style="width:100%;box-sizing:border-box" placeholder="<svg ...>...</svg>"></textarea></details>
<button id="b" style="margin:16px 0;padding:12px 18px">Buscar placa</button>
<div id="s"></div><pre id="r" style="white-space:pre-wrap;overflow-wrap:anywhere"></pre>
<script>
const f=document.getElementById('f'),t=document.getElementById('t'),b=document.getElementById('b'),s=document.getElementById('s'),r=document.getElementById('r');
b.onclick=async()=>{
  const file=f.files[0], raw=(t.value||'').trim();
  if(!file&&!raw)return alert('Elegí un archivo SVG o pegá su contenido.');
  if(file&&!file.name.toLowerCase().endsWith('.svg'))return alert('El archivo tiene que ser .svg');
  if(raw&&!raw.includes('<svg'))return alert('El texto pegado no parece un SVG válido.');
  b.disabled=true;s.textContent='Procesando… podés dejar esta pestaña abierta.';r.textContent='';
  let fd=new FormData(); if(file)fd.append('file',file); else fd.append('svg_text',raw);
  try{
    let x=await fetch('/benchmark-v6-start',{method:'POST',body:fd});let j=await x.json();
    if(!j.jobId){s.textContent='Error';r.textContent=JSON.stringify(j,null,2);b.disabled=false;return}
    let id=j.jobId;let timer=setInterval(async()=>{
      try{
        let q=await fetch('/benchmark-v6-status?id='+encodeURIComponent(id));let z=await q.json();
        if(z.status==='running'||z.status==='queued'){s.textContent='Procesando… '+Math.round((Date.now()-j.startedAt*1000)/1000)+' s';return}
        clearInterval(timer);b.disabled=false;s.textContent=z.status==='done'?'Terminado':'No encontró una placa válida';r.textContent=JSON.stringify(z.result,null,2)
      }catch(e){clearInterval(timer);b.disabled=false;s.textContent='Error consultando el resultado';r.textContent=String(e)}
    },2000)
  }catch(e){b.disabled=false;s.textContent='Error al iniciar';r.textContent=String(e)}
};
</script></body>'''


@app.post('/benchmark-v6-start')
def benchmark_v6_start():
    up = request.files.get('file')
    raw_text = str(request.form.get('svg_text') or '').strip()
    if not up and not raw_text:
        return jsonify(ok=False,error='Falta archivo SVG o contenido SVG'),400
    try:
        svg_text = up.read().decode('utf-8-sig') if up else raw_text
    except Exception as exc:
        return jsonify(ok=False,error=str(exc)),422
    if '<svg' not in svg_text.lower():
        return jsonify(ok=False,error='El contenido no parece ser un SVG válido'),422
    job_id = uuid.uuid4().hex
    started = time.time()
    with _lock:
        _jobs[job_id] = {'status':'queued','startedAt':started}
    threading.Thread(target=_work,args=(job_id,svg_text),daemon=True).start()
    return jsonify(ok=True,jobId=job_id,status='running',startedAt=started)


@app.get('/benchmark-v6-status')
def benchmark_v6_status():
    job_id = str(request.args.get('id') or '')
    with _lock:
        job = dict(_jobs.get(job_id) or {})
    if not job:
        return jsonify(ok=False,error='Trabajo no encontrado'),404
    job['ok'] = True
    return jsonify(job)
