"""Bounded replay of the retained HEX-04 artifacts; no build or deployment."""
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import tarfile


def digest(data):
    return hashlib.sha256(data).hexdigest()


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def main():
    root = Path(sys.argv[1]).resolve()
    root.mkdir(parents=True, exist_ok=False)
    results = root / 'results'
    results.mkdir()
    owner = Path(__file__).resolve().parent
    repo = owner.parents[2]
    receipt = {
        'version': 'hex04.local-replay.v1', 'status': 'running',
        'kind': 'local engine acceptance; not hosted Fastly or release qualification',
        'sourceRevision': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip(),
        'workingTree': subprocess.check_output(['git', 'status', '--porcelain'], cwd=repo, text=True),
        'platform': platform.platform(), 'node': subprocess.check_output(['node', '--version'], text=True).strip(),
        'runId': os.environ.get('GITHUB_RUN_ID'), 'runAttempt': os.environ.get('GITHUB_RUN_ATTEMPT'),
        'probeSha256': digest((owner / 'probe-hex04-local.cjs').read_bytes()),
        'downloads': [],
    }

    def save():
        (results / 'replay.json').write_text(json.dumps(receipt, indent=2) + '\n')

    def download(url, name, expected):
        dest = root / name
        with (results / 'downloads.log').open('a') as log:
            subprocess.run(['curl', '--fail', '--location', '--silent', '--show-error',
                            '--connect-timeout', '10', '--max-time', '60', '-o', str(dest), url],
                           stdout=log, stderr=log, check=True, timeout=65)
        require(digest(dest.read_bytes()) == expected, 'Download digest mismatch: ' + name)
        receipt['downloads'].append({'url': url, 'sha256': expected, 'file': name})
        save()
        return dest

    save()
    try:
        ledger = json.loads((owner / 'hex04-validation.json').read_text())
        archive = owner / ledger['archive']['file']
        index = owner / ledger['archive']['indexFile']
        require(digest(archive.read_bytes()) == ledger['archive']['sha256'], 'Evidence archive mismatch')
        require(digest(index.read_bytes()) == ledger['archive']['indexSha256'], 'Evidence index mismatch')
        receipt['evidenceArchiveSha256'] = ledger['archive']['sha256']
        receipt['packedSource'] = ledger['candidate']
        entries = {e['path']: e for e in json.loads(index.read_text())['files']}
        proof_dir = root / 'proof'
        proof_dir.mkdir()
        with tarfile.open(archive) as bundle:
            def read(name):
                data = bundle.extractfile('hex04-evidence/' + name).read()
                require(len(data) == entries[name]['bytes'] and digest(data) == entries[name]['sha256'],
                        'Evidence member mismatch: ' + name)
                return data
            engines = json.loads(read('engines.json'))
            for name in ['proof.json', 'fanout.wasm', 'websocket.wasm']:
                (proof_dir / name).write_bytes(read('candidate/' + name))
        proof = json.loads((proof_dir / 'proof.json').read_text())
        require(proof['status'] == 'passed', 'Installed qualification did not pass')
        receipt['artifacts'] = {name: digest((proof_dir / (name + '.wasm')).read_bytes())
                                for name in ['fanout', 'websocket']}
        for name, sha in receipt['artifacts'].items():
            require(sha == proof['fixtures'][name]['sha256'], 'Packed Wasm mismatch')
        viceroy_archive = download(
            'https://github.com/fastly/Viceroy/releases/download/v0.18.0/viceroy_v0.18.0_linux-amd64.tar.gz',
            'viceroy.tar.gz', engines['viceroy']['archiveSha256'])
        viceroy = root / 'viceroy'
        with tarfile.open(viceroy_archive) as bundle:
            viceroy.write_bytes(bundle.extractfile('viceroy').read())
        require(digest(viceroy.read_bytes()) == engines['viceroy']['binarySha256'], 'Viceroy binary mismatch')
        viceroy.chmod(0o755)
        pushpin = root / 'pushpin'
        package = download(engines['pushpin']['archive'], 'pushpin.deb', engines['pushpin']['archiveSha256'])
        subprocess.run(['dpkg-deb', '-x', str(package), str(pushpin)], check=True, timeout=20)
        for dependency in engines['pushpin']['dependencies']:
            directory = 'universe/libb/libb2/' if dependency['file'].startswith('libb2-') else 'universe/q/qt6-base/'
            url = engines['pushpin']['dependencySource'] + '/pool/' + directory + dependency['file']
            package = download(url, dependency['file'], dependency['sha256'])
            subprocess.run(['dpkg-deb', '-x', str(package), str(pushpin)], check=True, timeout=20)
        for binary in engines['pushpin']['binaries']:
            require(digest((pushpin / 'usr/bin' / binary['name']).read_bytes()) == binary['sha256'],
                    'Pushpin binary mismatch: ' + binary['name'])
        (results / 'engines.json').write_text(json.dumps(engines, indent=2) + '\n')
        with (results / 'probe.log').open('w') as log:
            subprocess.run(['node', str(owner / 'probe-hex04-local.cjs'), str(proof_dir), str(viceroy),
                            str(pushpin), str(results / 'local.json')], stdout=log, stderr=log,
                           check=True, timeout=90)
        local = json.loads((results / 'local.json').read_text())
        expected = {
            ('fanout', 'ordinary branch bypasses origin'), ('fanout', 'HTTP handoff'),
            ('fanout', 'GRIP hold and publish via real Pushpin'),
            ('websocket', 'ordinary branch bypasses origin'), ('websocket', 'HTTP handoff'),
            ('websocket', 'WebSocket upgrade and bidirectional frame'),
        }
        actual = {(case['fixture'], case['scenario']) for case in local['cases']}
        require(local['status'] == 'passed' and local.get('pushpin', {}).get('status') == 'passed',
                'Local transport incomplete: ' + json.dumps(local.get('pushpin')))
        require(actual == expected and len(local['cases']) == 6, 'Incomplete or duplicate local case coverage')
        require(local['cleanup'] is True, 'Probe cleanup incomplete')
        for case in local['cases']:
            require(case['artifactSha256'] == receipt['artifacts'][case['fixture']], 'Executed artifact mismatch')
        receipt['completedCases'] = 6
        receipt['status'] = 'passed'
    except Exception as error:
        receipt['status'] = 'failed'
        receipt['error'] = str(error)
        raise
    finally:
        save()
        print(json.dumps(receipt, indent=2))


if __name__ == '__main__':
    main()
