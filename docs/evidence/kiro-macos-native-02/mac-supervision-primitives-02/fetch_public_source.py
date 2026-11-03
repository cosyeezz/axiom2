#!/usr/bin/env python3
"""Own background Chrome; anonymous fixed public fetch only, no target execution."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import resource
import shutil
import signal
import subprocess
import time
import uuid

HERE = Path(__file__).resolve().parent
OUT = HERE / 'browser-results'
URL = 'https://raw.githubusercontent.com/apple-oss-distributions/xnu/{}/bsd/kern/kern_proc.c'
API = 'https://api.github.com/repos/apple-oss-distributions/xnu/commits/main'


def write_new(name, raw):
    path = OUT / name
    with path.open('xb') as stream:
        stream.write(raw)
        stream.flush()
        os.fchmod(stream.fileno(), 0o400)
    return path


def main():
    OUT.mkdir(mode=0o700)
    resource.setrlimit(resource.RLIMIT_CPU, (15, 15))
    signal.alarm(60)
    started = time.monotonic()
    session = 'axiom-xnu-browser02-' + uuid.uuid4().hex
    page = None
    executable = shutil.which('opencli')
    if not executable:
        raise RuntimeError('opencli executable unavailable')
    env = {k: os.environ[k] for k in ['HOME', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL'] if k in os.environ}
    calls, requests = [], []

    def cli(label, args, cleanup=False):
        remaining = (55 if cleanup else 45) - (time.monotonic() - started)
        if remaining <= 0:
            raise RuntimeError('case deadline')
        argv = [executable, 'browser'] + args + ['--session', session, '--window', 'background']
        write_new(label + '.command.json', json.dumps(argv, indent=2).encode())
        stdout = (OUT / (label + '.stdout')).open('xb')
        stderr = (OUT / (label + '.stderr')).open('xb')
        timed_out = False
        def limits():
            resource.setrlimit(resource.RLIMIT_FSIZE, (2 * 1024 * 1024, 2 * 1024 * 1024))
        with stdout, stderr:
            child = subprocess.Popen(argv, env=env, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr, preexec_fn=limits)
            try:
                child.wait(timeout=min(12, remaining))
            except subprocess.TimeoutExpired:
                timed_out = True
                child.kill()
                child.wait(timeout=2)
            stdout.flush()
            stderr.flush()
            os.fchmod(stdout.fileno(), 0o400)
            os.fchmod(stderr.fileno(), 0o400)
        record = {'label': label, 'argv': argv, 'pid': child.pid, 'exit': child.returncode, 'timedOut': timed_out,
                  'stdin': 'DEVNULL', 'output': 'regular files held until original child exit, not pipe-EOF proof'}
        calls.append(record)
        if child.returncode != 0 or timed_out:
            return {'ok': False, 'error': {'message': 'original CLI child failed; see raw outputs'}}
        raw = (OUT / (label + '.stdout')).read_bytes()
        if len(raw) > 2 * 1024 * 1024:
            raise RuntimeError('CLI output cap')
        return json.loads(raw)

    def fetch(label, url):
        script = r'''(async()=>{
const url=URL_VALUE, cap=524288, ac=new AbortController();
if(location.href!=='about:blank') return {url,status:null,complete:false,error:{name:'OwnedPageMismatch',message:'not expected blank page'}};
const timer=setTimeout(()=>ac.abort(),8000);
let status=null, total=0, complete=false, capped=false, parts=[];
try {
 const r=await fetch(url,{credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',cache:'no-store',signal:ac.signal});
 status=r.status;
 const reader=r.body.getReader();
 while(true){
  const v=await reader.read(); if(v.done){complete=true;break;}
  if(total+v.value.length>cap){capped=true;await reader.cancel();break;}
  total+=v.value.length;parts.push(v.value);
 }
 const all=new Uint8Array(total);let at=0;for(const p of parts){all.set(p,at);at+=p.length;}
 let binary='';for(let i=0;i<all.length;i+=16384)binary+=String.fromCharCode(...all.subarray(i,i+16384));
 return {url,status,complete,capped,bytes:total,bodyBase64:btoa(binary),contentType:r.headers.get('content-type'),responseUrl:r.url};
} catch(e){return {url,status,complete:false,capped,bytes:total,error:{name:e.name,message:String(e.message).slice(0,512)}};}
finally{clearTimeout(timer);}
})()'''.replace('URL_VALUE', json.dumps(url))
        write_new(label + '.js', script.encode())
        response = cli(label, ['eval', script, '--tab', page])
        if not response.get('ok'):
            result = {'url': url, 'httpStatus': None, 'complete': False, 'error': response.get('error')}
        else:
            result = response.get('data')
            for unused in range(3):
                if isinstance(result, str):
                    result = json.loads(result)
                elif isinstance(result, dict) and 'url' not in result and 'result' in result:
                    result = result['result']
                else:
                    break
            if not isinstance(result, dict) or result.get('url') != url:
                raise RuntimeError('unexpected eval envelope; retain raw and stop')
            encoded = result.pop('bodyBase64', None)
            if encoded is not None:
                body = base64.b64decode(encoded, validate=True)
                if len(body) > 524288 or len(body) != result['bytes']:
                    raise RuntimeError('public response cap/length')
                write_new(label + '.body', body)
                result['sha256'] = hashlib.sha256(body).hexdigest()
        requests.append(result)
        write_new(label + '.result.json', json.dumps(result, indent=2).encode())
        return result

    cleanup = None
    error = None
    try:
        opened = cli('00-open', ['tab', 'new'])
        if not opened.get('ok'):
            raise RuntimeError('documented own blank-tab creation failed; no public fetch')
        page = opened.get('data', {}).get('page')
        if not isinstance(page, str) or not page:
            raise RuntimeError('no own page identity; no public fetch')
        first = fetch('01-exact-tag', URL.format('xnu-12377.161.14'))
        if not (first.get('status') == 200 and first.get('complete') and not first.get('capped')):
            second = fetch('02-main-commit', API)
            if second.get('status') == 200 and second.get('complete') and not second.get('capped'):
                data = json.loads((OUT / '02-main-commit.body').read_bytes())
                pin = data.get('sha')
                if isinstance(pin, str) and re.fullmatch('[0-9a-f]{40}', pin):
                    fetch('03-pinned-file', URL.format(pin))
    except Exception as exc:
        error = {'name': type(exc).__name__, 'message': str(exc)[:512]}
    finally:
        try:
            cleanup = cli('99-close', ['close'], cleanup=True)
        except Exception as exc:
            cleanup = {'ok': False, 'error': str(exc)[:512]}
    size = sum(p.stat().st_size for p in OUT.iterdir() if p.is_file())
    manifest = {'scope': 'anonymous fixed public source only; own background blank session', 'session': session,
                'calls': calls, 'requests': requests, 'cleanup': cleanup, 'error': error,
                'seconds': time.monotonic() - started, 'artifactBytesBeforeManifest': size,
                'withinEvidenceCap': size <= 24 * 1024 * 1024, 'officialRuns': 0, 'modelRequests': 0,
                'OSHardRealtimeOrWholeTreeClaim': False}
    write_new('manifest.json', json.dumps(manifest, indent=2).encode())
    print(json.dumps({'requests': len(requests), 'statuses': [r.get('status') for r in requests],
                      'cleanup': cleanup, 'error': error, 'seconds': manifest['seconds'], 'bytes': size}))
    return 0 if error is None and cleanup and cleanup.get('ok') and manifest['withinEvidenceCap'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
