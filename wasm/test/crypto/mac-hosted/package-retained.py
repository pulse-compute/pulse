"""Package a retained MAC-03 build without invoking a compiler or annotator."""
import argparse, gzip, hashlib, io, json, os, pathlib, re, subprocess, tarfile

p = argparse.ArgumentParser()
p.add_argument('--bundle', required=True)
p.add_argument('--cli', required=True)
p.add_argument('--output', required=True)
a = p.parse_args()
root = pathlib.Path(a.output).resolve()
root.mkdir(parents=True, exist_ok=True)
bundle = pathlib.Path(a.bundle).resolve()
cli = pathlib.Path(a.cli).resolve()
archive = root / 'mac03-package.tar.gz'
assert not archive.exists() and not (root / 'package.json').exists(), 'Use fresh output paths'
sha = lambda data: hashlib.sha256(data).hexdigest()
receipt = json.loads((bundle / 'installed.json').read_text())
assert receipt['status'] == 'passed'
expected = next(row['sha256'] for row in receipt['artifacts'] if row['file'] == 'build/bin/main.wasm')
wasm = (bundle / 'build/bin/main.wasm').read_bytes()
assert sha(wasm) == expected
assert sha(cli.read_bytes()) == '56bdd56d086d419ba335488fb3ed814050c75e2b16741c5676af2163bc40bbc1'
buf = io.BytesIO()
with tarfile.open(fileobj=buf, mode='w', format=tarfile.USTAR_FORMAT) as tar:
    for name in ['fastly.toml', 'bin/main.wasm']:
        data = (bundle / 'build' / name).read_bytes()
        info = tarfile.TarInfo('package/' + name)
        info.size, info.mode, info.mtime = len(data), 0o644, 0
        tar.addfile(info, io.BytesIO(data))
archive.write_bytes(gzip.compress(buf.getvalue(), mtime=0))
with tarfile.open(archive) as tar:
    assert tar.extractfile('package/bin/main.wasm').read() == wasm
env = {key: value for key, value in os.environ.items() if key not in ('FASTLY_API_TOKEN', 'FASTLY_API_KEY', 'MAC03_PROOF_KEY_BASE64')}
version = subprocess.check_output([str(cli), 'version'], env=env, text=True, timeout=20).strip()
output = subprocess.check_output([str(cli), 'compute', 'hash-files', '--package', str(archive), '--skip-build'], env=env, text=True, timeout=30)
digests = re.findall(r'\b[a-f0-9]{128}\b', output)
assert len(digests) == 1
result = {'version': 'pulse.mac-hosted-package.v1', 'archive': str(archive), 'archiveSha256': sha(archive.read_bytes()), 'filesHash': digests[0], 'wasmSha256': sha(wasm), 'bytes': len(wasm), 'cli': {'file': str(cli), 'sha256': sha(cli.read_bytes()), 'version': version}, 'metadataAnnotations': False, 'compilation': 'none; deterministic archive of retained fastly.toml and bin/main.wasm'}
(root / 'package.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'status': 'packaged', 'wasmSha256': expected, 'archiveSha256': result['archiveSha256']}))
