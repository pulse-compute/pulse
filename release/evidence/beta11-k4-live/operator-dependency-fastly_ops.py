import hashlib
import json
import secrets
import sys
import tarfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TOKEN = (ROOT / 'fastly-token').read_text().strip()
LEDGER = ROOT / 'deployments.json'

def save(data):
    LEDGER.write_text(json.dumps(data, indent=2) + '\n')

def api(method, route, fields=None, package=None):
    headers = {'Fastly-Key': TOKEN, 'Accept': 'application/json'}
    body = None
    if package:
        boundary = 'pulse571' + secrets.token_hex(12)
        body = (f'--{boundary}\r\nContent-Disposition: form-data; name="package"; filename="package.tar.gz"\r\nContent-Type: application/gzip\r\n\r\n'.encode()
                + Path(package).read_bytes() + f'\r\n--{boundary}--\r\n'.encode())
        headers['Content-Type'] = 'multipart/form-data; boundary=' + boundary
    elif fields is not None:
        body = urllib.parse.urlencode(fields).encode()
        headers['Content-Type'] = 'application/x-www-form-urlencoded'
    elif method in ('PUT', 'POST'):
        body = b''
    req = urllib.request.Request('https://api.fastly.com' + route, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=40) as response:
            raw = response.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as error:
        detail = error.read(4000).decode(errors='replace').replace(TOKEN, '[redacted]')
        raise RuntimeError(f'{method} {route}: HTTP {error.code}: {detail}') from None

def deploy():
    items = json.loads((ROOT / 'packages.json').read_text())
    ledger = json.loads(LEDGER.read_text()) if LEDGER.exists() else []
    origin = urllib.parse.urlsplit((ROOT / 'origin-url.txt').read_text().strip()).hostname
    for item in items:
        package = Path(item['package'])
        assert hashlib.sha256(package.read_bytes()).hexdigest() == item['packageSha256']
        with tarfile.open(package) as archive:
            names = [m for m in archive.getmembers() if m.name.endswith('bin/main.wasm')]
            assert len(names) == 1
            assert hashlib.sha256(archive.extractfile(names[0]).read()).hexdigest() == item['artifactSha256']
        row = next((d for d in ledger if d['id'] == item['id']), None)
        if row is None:
            if item['id'] == 'fanout':
                service = json.loads((ROOT / 'service-fanout.json').read_text())
            else:
                service = api('POST', '/service', {'name': 'Pulse 571 live qualification ' + item['id'], 'type': 'wasm', 'comment': 'User-approved isolated temporary PR571 qualification'})
            row = {**item, 'serviceId': service['id'], 'serviceVersion': 1, 'createdByThisTask': True}
            ledger.append(row)
            save(ledger)
            print('Created', item['id'], row['serviceId'], flush=True)
        sid = row['serviceId']
        prefix = f'/service/{sid}/version/1'
        if not row.get('productEnabled'):
            row['productEvidence'] = api('PUT', f'/enabled-products/v1/{item["product"]}/services/{sid}')
            row['productEnabled'] = True
            save(ledger)
        if not row.get('url'):
            domain = 'pulse-571-' + item['id'] + '-' + secrets.token_hex(4) + '.edgecompute.app'
            api('POST', prefix + '/domain', {'name': domain})
            row['url'] = 'https://' + domain
            save(ledger)
        if not row.get('backendCreated'):
            api('POST', prefix + '/backend', {'name': 'terminal_origin', 'address': origin, 'port': 443, 'use_ssl': 1, 'ssl_check_cert': 1, 'ssl_sni_hostname': origin, 'ssl_cert_hostname': origin, 'override_host': origin})
            row['backendCreated'] = True
            row['origin'] = origin
            save(ledger)
        if not row.get('uploaded'):
            row['uploadEvidence'] = api('PUT', prefix + '/package', package=package)
            assert row['uploadEvidence']['metadata']['files_hash'] == item['filesHash']
            row['uploaded'] = True
            save(ledger)
        if not row.get('active'):
            row['activationEvidence'] = api('PUT', prefix + '/activate')
            row['active'] = True
            save(ledger)
        print('Activated', item['id'], row['url'], flush=True)
    config = {'version': 'pulse.terminal-hosted-config.v1', 'cli': json.loads((ROOT / 'cli-pin.json').read_text()), 'cases': [{k: row[k] for k in ['id', 'url', 'serviceId', 'serviceVersion', 'package', 'filesHash']} for row in ledger]}
    (ROOT / 'scoped-config.json').write_text(json.dumps(config, indent=2) + '\n')

def cleanup():
    ledger = json.loads(LEDGER.read_text()) if LEDGER.exists() else []
    if not ledger and (ROOT / 'service-fanout.json').exists():
        ledger = [{'id': 'fanout', 'serviceId': json.loads((ROOT / 'service-fanout.json').read_text())['id'], 'serviceVersion': 1, 'createdByThisTask': True}]
    for row in ledger:
        assert row['createdByThisTask'] is True
        if row.get('deleted'):
            continue
        sid = row['serviceId']
        if row.get('active'):
            row['deactivationEvidence'] = api('PUT', f'/service/{sid}/version/{row["serviceVersion"]}/deactivate')
            row['active'] = False
            save(ledger)
        row['deleteEvidence'] = api('DELETE', '/service/' + sid)
        row['deleted'] = True
        save(ledger)
        print('Deleted owned test service', row['id'], sid, flush=True)

if __name__ == '__main__':
    {'deploy': deploy, 'cleanup': cleanup}[sys.argv[1]]()
