import pathlib,json,tarfile,hashlib
root=pathlib.Path('/tmp/rc-h05');repo=pathlib.Path.cwd();oldroot=pathlib.Path('/tmp/rc-h04-live/terminal-ci/bundle');newroot=root/'terminal-bundle-2'
old=json.loads((oldroot/'installed.json').read_text());new=json.loads((newroot/'installed.json').read_text());result=[]
def contents(root,p):
 data=(root/p['file']).read_bytes();assert hashlib.sha256(data).hexdigest()==p['sha256']
 with tarfile.open(root/p['file']) as t:return {m.name:t.extractfile(m).read() for m in t if m.isfile()}
for p in new['packages']:
 before=next(x for x in old['packages'] if x['name']==p['name']);a=contents(oldroot,before);b=contents(newroot,p);changes=[]
 for n in sorted(a.keys()|b.keys()):
  if a.get(n)==b.get(n):continue
  changes.append({'file':n,'change':'added' if n not in a else 'removed' if n not in b else 'version-only' if a[n].replace(b'1.0.0-beta.11',b'1.0.0-rc.1')==b[n] else 'content','before':hashlib.sha256(a[n]).hexdigest() if n in a else None,'after':hashlib.sha256(b[n]).hexdigest() if n in b else None})
 result.append({'package':p['name'],'beforeTarball':before['sha256'],'afterTarball':p['sha256'],'unchangedFiles':sum(a.get(n)==b[n] for n in b),'changes':changes})
(root/'evidence/package-file-delta.json').write_text(json.dumps({'schemaVersion':'pulse.rc-h05-package-delta.v1','old':old['candidate'],'current':new['candidate'],'packages':result},indent=2)+'\n')
for p in result:
 code=[x for x in p['changes'] if '/src/' in x['file'] and '/examples/' not in x['file']]
 print(p['package'], 'changed',len(p['changes']),'implementation',[(x['file'],x['change']) for x in code])
