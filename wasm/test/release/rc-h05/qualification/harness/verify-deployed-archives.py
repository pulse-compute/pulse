import pathlib,json,tarfile,hashlib
root=pathlib.Path('/tmp/rc-h05');binding=json.loads((root/'evidence/provider-binding.json').read_text());mapping={'fanout':'fanout','fanout-router':'fanout-router','websocket':'websocket','websocket-router':'websocket-router','independent':'independent','k4':'kv','origin':'origins'}
for a in binding['artifacts']:
 if a['id'] not in mapping:continue
 p=pathlib.Path('wasm/test/release/rc-h04/live/packages')/(mapping[a['id']]+'.tar.gz')
 with tarfile.open(p) as t:
  members=[m for m in t if m.name.endswith('.wasm')];assert len(members)==1
  assert hashlib.sha256(t.extractfile(members[0]).read()).hexdigest()==a['sha256']
 a['deployedPackageFile']=str(p);a['deployedPackageSha256']=hashlib.sha256(p.read_bytes()).hexdigest();a['deployedModuleFile']=members[0].name
(root/'evidence/provider-binding.json').write_text(json.dumps(binding,indent=2)+'\n')
print('Verified seven modules against retained deployed archives')
