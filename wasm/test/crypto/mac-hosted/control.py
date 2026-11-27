"""Owner-authorized isolated MAC qualification; never modify existing services."""
import argparse, base64, datetime, hashlib, json, os, pathlib, secrets, urllib.error, urllib.parse, urllib.request, uuid

p = argparse.ArgumentParser()
p.add_argument('action', choices=['provision', 'activate', 'inspect', 'cleanup'])
p.add_argument('--auth-dir', required=True)
p.add_argument('--output', required=True)
a = p.parse_args()
root = pathlib.Path(a.output).resolve()
private = pathlib.Path(a.auth_dir).resolve()
token = (private / 'api-token').read_text().strip()
statefile = root / 'resources.json'
state = json.loads(statefile.read_text()) if statefile.exists() else {}

def save():
    statefile.write_text(json.dumps(state, indent=2) + '\n')

def api(route, method='GET', data=None, form=False, raw=None, content_type=None, absent=False):
    headers = {'Fastly-Key': token, 'Accept': 'application/json'}
    if raw is not None:
        body = raw
        headers['Content-Type'] = content_type
    elif data is not None:
        body = urllib.parse.urlencode(data).encode() if form else json.dumps(data).encode()
        headers['Content-Type'] = 'application/x-www-form-urlencoded' if form else 'application/json'
    else:
        body = None
    row = {'time': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'method': method, 'path': route}
    try:
        request = urllib.request.Request('https://api.fastly.com' + route, data=body, headers=headers, method=method)
        with urllib.request.urlopen(request, timeout=40) as response:
            row['status'] = response.status
            result = response.read()
            return json.loads(result) if result else {}
    except urllib.error.HTTPError as error:
        row['status'] = error.code
        if absent and error.code == 404:
            return {'absent': True}
        # No raw API bodies: a failed secret operation may echo its input.
        raise RuntimeError(f'Fastly {method} {route}: HTTP {error.code}') from None
    except Exception as error:
        row['errorType'] = type(error).__name__
        raise RuntimeError(f'Fastly {method} {route}: transport failure') from None
    finally:
        with (root / 'api-audit.jsonl').open('a') as file:
            file.write(json.dumps(row) + '\n')

if a.action == 'provision':
    assert not state, 'Fresh run only; inspect/clean up an existing run instead of recreating it'
    name = 'pulse-mac-proof-' + uuid.uuid4().hex[:12]
    state.update(name=name, createdAt=datetime.datetime.now(datetime.timezone.utc).isoformat(), createdResources=[])
    save()
    service = api('/service', 'POST', {'name': name, 'type': 'wasm', 'comment': 'Temporary exact-artifact MAC proof; retire after qualification'}, form=True)
    state['serviceId'] = service['id']
    state['createdResources'].append('service')
    save()
    versions = api('/service/' + service['id'] + '/version')
    state['serviceVersion'] = versions[-1]['number']
    state['url'] = 'https://' + name + '.edgecompute.app/'
    save()
    store = api('/resources/stores/secret', 'POST', {'name': name})
    state['storeId'] = store['id']
    state['createdResources'].append('secretStore')
    save()
    values = {'REQUEST_PROOF_KEY': secrets.token_bytes(32), 'MAC03_SHORT_KEY': secrets.token_bytes(31), 'MAC03_LONG_KEY': secrets.token_bytes(4097)}
    fd = os.open(private / 'proof-secrets.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as file:
        json.dump({name: base64.b64encode(value).decode() for name, value in values.items()}, file)
    state['secrets'] = []
    for key, value in values.items():
        api('/resources/stores/secret/' + store['id'] + '/secrets', 'POST', {'name': key, 'secret': base64.b64encode(value).decode()})
        state['secrets'].append({'name': key, 'bytes': len(value)})
        save()
    base = '/service/' + service['id'] + '/version/' + str(state['serviceVersion'])
    api(base + '/domain', 'POST', {'name': name + '.edgecompute.app'}, form=True)
    api(base + '/resource', 'POST', {'name': 'app_secrets', 'resource_id': store['id']}, form=True)
    state['provisioned'] = True
    save()
    print(json.dumps({'status': 'provisioned', 'serviceId': state['serviceId'], 'version': state['serviceVersion'], 'storeId': state['storeId'], 'url': state['url']}))

elif a.action == 'activate':
    assert state.get('provisioned') and not state.get('activationAttempted')
    package = json.loads((root / 'package.json').read_text())
    archive = pathlib.Path(package['archive']).read_bytes()
    assert hashlib.sha256(archive).hexdigest() == package['archiveSha256']
    base = '/service/' + state['serviceId'] + '/version/' + str(state['serviceVersion'])
    boundary = 'pulse' + uuid.uuid4().hex
    body = ('--' + boundary + '\r\nContent-Disposition: form-data; name="package"; filename="mac03-package.tar.gz"\r\nContent-Type: application/gzip\r\n\r\n').encode() + archive + ('\r\n--' + boundary + '--\r\n').encode()
    uploaded = api(base + '/package', 'PUT', raw=body, content_type='multipart/form-data; boundary=' + boundary)
    assert uploaded['metadata']['hashsum'] == hashlib.sha512(archive).hexdigest()
    assert uploaded['metadata']['files_hash'] == package['filesHash']
    state['package'] = {'archiveSha256': package['archiveSha256'], 'filesHash': package['filesHash'], 'wasmSha256': package['wasmSha256']}
    save()
    validation = api(base + '/validate')
    assert validation.get('status') == 'ok', 'Service validation failed'
    state['activationAttempted'] = True
    save()
    api(base + '/activate', 'PUT')
    state['activated'] = True
    save()
    config = {'version': 'pulse.mac03-hosted-config.v1', 'serviceId': state['serviceId'], 'serviceVersion': state['serviceVersion'], 'url': state['url'], 'package': package['archive'], 'filesHash': package['filesHash'], 'cli': package['cli']}
    (root / 'hosted-config.json').write_text(json.dumps(config, indent=2) + '\n')
    print(json.dumps({'status': 'activated', 'serviceId': state['serviceId'], 'version': state['serviceVersion']}))

elif a.action == 'inspect':
    base = '/service/' + state['serviceId'] + '/version/' + str(state['serviceVersion'])
    version = api(base)
    assert version['active'] is True
    package = api(base + '/package')
    assert package['metadata']['files_hash'] == state['package']['filesHash']
    links = api(base + '/resource')
    assert any(link['name'] == 'app_secrets' and link['resource_id'] == state['storeId'] for link in links)
    result = {'status': 'passed', 'serviceId': state['serviceId'], 'serviceVersion': state['serviceVersion'], 'active': True, 'filesHash': state['package']['filesHash'], 'storeId': state['storeId'], 'binding': 'app_secrets', 'url': state['url']}
    output = root / ('identity-after.json' if (root / 'identity-before.json').exists() else 'identity-before.json')
    assert not output.exists(), 'Keep each inspection immutable'
    output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))

elif a.action == 'cleanup':
    # Exact recorded identities only. This never lists or modifies unrelated services.
    if state.get('serviceId') and not state.get('serviceDeleted'):
        base = '/service/' + state['serviceId']
        if state.get('serviceVersion'):
            version = api(base + '/version/' + str(state['serviceVersion']))
            if version.get('active'):
                api(base + '/version/' + str(state['serviceVersion']) + '/deactivate', 'PUT')
            state['deactivated'] = True
            save()
        api(base, 'DELETE')
        state['serviceDeleted'] = True
        save()
    if state.get('storeId') and not state.get('storeDeleted'):
        api('/resources/stores/secret/' + state['storeId'], 'DELETE')
        state['storeDeleted'] = True
        save()
    checks = []
    for route in (['/service/' + state['serviceId']] if state.get('serviceId') else []) + (['/resources/stores/secret/' + state['storeId']] if state.get('storeId') else []):
        result = api(route, absent=True)
        if result.get('absent') is True:
            checks.append({'path': route, 'status': 404})
        else:
            # Fastly retains deleted service metadata; stores return 404.
            assert route == '/service/' + state['serviceId']
            assert result.get('id') == state['serviceId'] and result.get('deleted_at')
            assert datetime.datetime.fromisoformat(result['deleted_at'].replace('Z', '+00:00'))
            assert result.get('versions') and all(version.get('active') is False for version in result['versions'])
            checks.append({'path': route, 'status': 200, 'deletedAt': result['deleted_at'], 'allVersionsInactive': True, 'disposition': 'deleted-service-tombstone'})
    (private / 'proof-secrets.json').unlink(missing_ok=True)
    receipt = {'status': 'passed', 'serviceId': state.get('serviceId'), 'storeId': state.get('storeId'), 'deactivated': state.get('deactivated'), 'serviceDeleted': state.get('serviceDeleted'), 'storeDeleted': state.get('storeDeleted'), 'localProofKeysRemoved': True, 'absenceChecks': checks, 'scope': 'Only the service and secret store created by this run; original management token not revoked'}
    (root / 'cleanup.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(receipt))
