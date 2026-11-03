"""Bounded read-only curl cohort with connection reuse and numeric server spans.

Usage: python3 catalog-latency-client.py PLAN.json TOKEN_ADAPTER.mjs NODE OUTPUT.json
Plan: {"origin":"https://...", "requests":[{"label":"health","path":"/health","actor":"admin"}]}
Tokens travel through stdin only. Request/response bodies and raw headers are not retained.
"""
import hashlib
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import time
import urllib.parse

os.umask(0o077)
plan_file, adapter, node, output = sys.argv[1:]
plan = json.loads(pathlib.Path(plan_file).read_text())
origin = plan['origin']
parsed = urllib.parse.urlsplit(origin)
assert parsed.scheme == 'https' and parsed.netloc and not parsed.username and not parsed.password
assert not parsed.query and not parsed.fragment and parsed.path in ['', '/']
requests = plan['requests']
assert 1 <= len(requests) <= 32
assert not pathlib.Path(output).exists(), 'Fresh output required'
actors = sorted({r['actor'] for r in requests})
script = "const m=await import(process.argv[1]);const actors=JSON.parse(process.argv[2]);const tokens={};for(const a of actors)tokens[a]=await m.getToken(a);process.stdout.write(JSON.stringify(tokens));"
tokens = json.loads(subprocess.run([node, '--input-type=module', '-e', script,
                                  pathlib.Path(adapter).resolve().as_uri(), json.dumps(actors)],
                                 capture_output=True, text=True, check=True, timeout=10).stdout)
report = dict(schemaVersion='catalog.latency-client.v1', status='running', startedAt=time.time(),
              planSha256=hashlib.sha256(pathlib.Path(plan_file).read_bytes()).hexdigest(),
              method='GET', concurrency=1, maxRequests=len(requests), deadlineSeconds=180,
              connectionPolicy='One curl process; connection reuse enabled; no retries or redirects', rows=[])
save = lambda: pathlib.Path(output).write_text(json.dumps(report, indent=2))
save()
with tempfile.TemporaryDirectory(prefix='catalog-latency-') as tmp:
    blocks = []
    for i, request in enumerate(requests):
        path = request['path']
        assert path.startswith('/') and not path.startswith('//') and '\r' not in path and '\n' not in path
        assert urllib.parse.urlsplit(origin + path).netloc == parsed.netloc
        token = tokens[request['actor']]
        assert token and '\r' not in token and '\n' not in token
        blocks.append('\n'.join(['silent', 'show-error', 'connect-timeout = 8', 'max-time = 25',
            'max-filesize = 1048576', 'url = ' + json.dumps(origin + path),
            'output = ' + json.dumps(f'{tmp}/{i}.body'), 'dump-header = ' + json.dumps(f'{tmp}/{i}.headers'),
            'header = ' + json.dumps('Authorization: Bearer ' + token),
            'header = "Cache-Control: no-cache"', 'header = ' + json.dumps('x-pulse-probe-id: latency-' + str(i)),
            'write-out = "%{json}\\n"']))
    try:
        result = subprocess.run(['curl', '--config', '-'], input='\nnext\n'.join(blocks),
                                text=True, capture_output=True, timeout=180)
        report['curlExit'] = result.returncode
        for i, line in enumerate(result.stdout.splitlines()):
            raw = json.loads(line)
            row = dict(label=requests[i]['label'], path=requests[i]['path'], **{k: raw.get(k) for k in
                ['http_code', 'exitcode', 'time_namelookup', 'time_connect', 'time_appconnect',
                 'time_pretransfer', 'time_starttransfer', 'time_total', 'num_connects', 'size_download']})
            body = pathlib.Path(f'{tmp}/{i}.body')
            if body.exists(): row['bodySha256'] = hashlib.sha256(body.read_bytes()).hexdigest()
            headers = pathlib.Path(f'{tmp}/{i}.headers')
            if headers.exists():
                values = [s.split(':', 1)[1].strip() for s in headers.read_text().splitlines()
                          if s.lower().startswith('x-pulse-latency:')]
                if values:
                    assert len(values) == 1 and len(values[0].encode()) <= 4096
                    timing = json.loads(values[0])
                    assert set(timing) == {'v', 'valid', 'wallUs', 'open', 'dropped', 'totals', 'spans'}
                    assert timing['v'] == 1 and type(timing['valid']) is bool
                    assert all(type(timing[k]) is int and timing[k] >= 0 for k in ['wallUs', 'open', 'dropped'])
                    for group, size in [('totals', 7), ('spans', 8)]:
                        assert isinstance(timing[group], list) and len(timing[group]) <= 128
                        assert all(isinstance(v, list) and len(v) == size and all(type(n) is int and n >= 0 for n in v) for v in timing[group])
                    row['server'] = timing
            report['rows'].append(row); save()
        assert len(report['rows']) == len(requests), 'Incomplete cohort'
        report['status'] = 'completed' if all(r['http_code'] == 200 and r['exitcode'] == 0 for r in report['rows']) else 'completed-with-failures'
    except Exception as error:
        report['status'] = 'failed'; report['errorType'] = type(error).__name__
        raise
    finally:
        report['completedAt'] = time.time(); save()
print(json.dumps({'status': report['status'], 'requests': len(report['rows']), 'output': output}))
