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
    return '''<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Motor V6</title><body style="font-family:Arial;max-width:720px;margin:40px auto;padding:20px"><h2>Motor V6 · prueba 1230×580</h2><input id="f" type="file" accept=".svg"><button id="b" style="margin:16px;padding:10px 16px">Buscar placa</button><div id="s"></div><pre id="r" style="white-space:pre-wrap"></pre><script>const f=document.getElementById('f'),b=document.getElementById('b'),s=document.getElementById('s'),r=document.getElementById('r');b.onclick=async()=>{if(!f.files[0])return alert('Elegí un SVG');b.disabled=true;s.textContent='Procesando… podés dejar esta pestaña abierta.';r.textContent='';let fd=new FormData();fd.append('file',f.files[0]);let x=await fetch('/benchmark-v6-start',{method:'POST',body:fd});let j=await x.json();if(!j.jobId){s.textContent='Error';r.textContent=JSON.stringify(j,null,2);b.disabled=false;return}let id=j.jobId;let t=setInterval(async()=>{let q=await fetch('/benchmark-v6-status?id='+encodeURIComponent(id));let z=await q.json();if(z.status==='running'){s.textContent='Procesando… '+Math.round((Date.now()-j.startedAt*1000)/1000)+' s';return}clearInterval(t);b.disabled=false;s.textContent=z.status==='done'?'Terminado':'No encontró una placa válida';r.textContent=JSON.stringify(z.result,null,2)},2000)};</script></body>'''


@app.post('/benchmark-v6-start')
def benchmark_v6_start():
    up = request.files.get('file')
    if not up:
        return jsonify(ok=False,error='Falta archivo SVG'),400
    try:
        svg_text = up.read().decode('utf-8-sig')
    except Exception as exc:
        return jsonify(ok=False,error=str(exc)),422
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
