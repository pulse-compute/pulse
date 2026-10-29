#!/usr/bin/env python3
"""Extract hash-pinned Linux amd64 engines; never install/start a system service."""
import hashlib, json, pathlib, subprocess, sys, urllib.request
pins = json.loads(pathlib.Path(__file__).with_name('engines.json').read_text())
root = pathlib.Path(sys.argv[1]).resolve()
root.mkdir(parents=True, exist_ok=True)
def download(url, name, digest):
    target = root / name
    if not target.exists():
        with urllib.request.urlopen(url, timeout=60) as response:
            target.write_bytes(response.read())
    assert hashlib.sha256(target.read_bytes()).hexdigest() == digest, name + ': digest mismatch'
    return str(target)
def deb(url, name, digest):
    subprocess.run(['dpkg-deb', '-x', download(url, name, digest), str(root/'pushpin')], check=True)
v = pins['viceroy']
(root/'viceroy').mkdir(exist_ok=True)
subprocess.run(['tar', '--no-same-owner', '-xzf', download(v['archive'], 'viceroy.tar.gz', v['archiveSha256']), '-C', str(root/'viceroy')], check=True)
p = pins['pushpin']
deb(p['archive'], 'pushpin.deb', p['archiveSha256'])
for dep in p['dependencies']:
    directory = 'universe/libb/libb2/' if dep['file'].startswith('libb2') else 'universe/q/qt6-base/'
    deb(p['dependencySource']+'/pool/'+directory+dep['file'], dep['file'], dep['sha256'])
print('Extracted engines. The local runner verifies executable hashes before execution.')
