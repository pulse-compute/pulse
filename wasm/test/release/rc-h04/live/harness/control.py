import urllib.request,urllib.parse,urllib.error,json,pathlib,os,hashlib,io,tarfile,uuid,time
ROOT=pathlib.Path('/tmp/rc-h04-live')
def api(path,method='GET',data=None,raw=None,content_type=None):
 key=(ROOT/'api-key').read_text().strip()
 headers={'Fastly-Key':key,'Accept':'application/json'}
 body=None
 if raw is not None:body=raw;headers['Content-Type']=content_type
 elif data is not None:
  if path.startswith('/resources/'):
   body=json.dumps(data).encode();headers['Content-Type']='application/json'
  else:body=urllib.parse.urlencode(data).encode();headers['Content-Type']='application/x-www-form-urlencoded'
 try:
  with urllib.request.urlopen(urllib.request.Request('https://api.fastly.com'+path,data=body,headers=headers,method=method),timeout=40) as r:
   b=r.read();return json.loads(b) if b else {}
 except urllib.error.HTTPError as e:raise RuntimeError('Fastly '+str(e.code)+' '+path+' '+e.read(1500).decode().replace(key,'[redacted]')) from None
STATE=ROOT/'resources.json'
def state():return json.loads(STATE.read_text()) if STATE.exists() else {'resources':[]}
def save(s):
 f=os.open(STATE,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
 with os.fdopen(f,'w') as o:json.dump(s,o,indent=2)
def create(label,kind='wasm'):
 s=state();assert not any(x['label']==label for x in s['resources'])
 name='pulse-rch04-'+label+'-'+uuid.uuid4().hex[:8]
 svc=api('/service','POST',{'name':name,'type':kind})
 r={'label':label,'id':svc['id'],'name':name,'version':1,'kind':kind,'active':False,'deleted':False};s['resources'].append(r);save(s)
 return r
def update(r):
 s=state();s['resources']=[r if x['id']==r['id'] else x for x in s['resources']];save(s)
def backend(r,name,host,shield=None):
 data={'name':name,'address':host,'port':443,'use_ssl':'1','ssl_check_cert':'1','override_host':host,'ssl_cert_hostname':host,'ssl_sni_hostname':host,'connect_timeout':5000,'first_byte_timeout':15000,'between_bytes_timeout':15000}
 if shield:data['shield']=shield
 return api('/service/'+r['id']+'/version/1/backend','POST',data)
def domain(r):
 r['domain']=r['name']+'.edgecompute.app';update(r)
 return api('/service/'+r['id']+'/version/1/domain','POST',{'name':r['domain']})
def package(r,wasm):
 root=ROOT/r['label'];root.mkdir(exist_ok=True)
 toml=('manifest_version = 3\nname = "'+r['name']+'"\nlanguage = "other"\ndescription = "Isolated RC-H04 proof"\nauthors = []\n').encode()
 buf=io.BytesIO()
 with tarfile.open(fileobj=buf,mode='w:gz') as t:
  for name,b in [('package/fastly.toml',toml),('package/bin/main.wasm',pathlib.Path(wasm).read_bytes())]:
   i=tarfile.TarInfo(name);i.size=len(b);i.mode=0o644;i.mtime=0;t.addfile(i,io.BytesIO(b))
 b=buf.getvalue();p=root/'package.tar.gz';p.write_bytes(b);boundary='pulse'+uuid.uuid4().hex
 body=('--'+boundary+'\r\nContent-Disposition: form-data; name="package"; filename="package.tar.gz"\r\nContent-Type: application/gzip\r\n\r\n').encode()+b+('\r\n--'+boundary+'--\r\n').encode()
 result=api('/service/'+r['id']+'/version/1/package','PUT',raw=body,content_type='multipart/form-data; boundary='+boundary)
 assert result['metadata']['hashsum']==hashlib.sha512(b).hexdigest()
 r['package']=str(p);r['filesHash']=result['metadata']['files_hash'];r['wasmSha256']=hashlib.sha256(pathlib.Path(wasm).read_bytes()).hexdigest();update(r)
def activate(r):
 p='/service/'+r['id']+'/version/1';v=api(p+'/validate');assert v['status']=='ok',v
 r['activationAttempted']=True;update(r);api(p+'/activate','PUT');r['active']=True;update(r)
def retire_all():
 for r in state()['resources']:
  if r['deleted']:continue
  if r.get('activationAttempted') and not r.get('deactivated'):
   api('/service/'+r['id']+'/version/1/deactivate','PUT');r['deactivated']=True;update(r)
  api('/service/'+r['id'],'DELETE');r['deleted']=True;update(r)
  print('retired',r['label'],flush=True)
if __name__=='__main__':
 import sys
 if sys.argv[1:] == ['retire']:retire_all()
