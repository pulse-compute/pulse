"""Explicit QA control plane. State contains secrets: keep it outside git, mode 0600."""
import datetime, argparse, base64, hashlib, io, json, os, pathlib, secrets, tarfile, urllib.request, urllib.parse, urllib.error, uuid
p=argparse.ArgumentParser();p.add_argument('action',choices=['bootstrap','activate','metrics','deactivate','retire','inspect']);p.add_argument('--key-file',required=True);p.add_argument('--state',required=True);p.add_argument('--target');p.add_argument('--artifact');p.add_argument('--cleanup-receipt');p.add_argument('--since');p.add_argument('--out');a=p.parse_args()
key=pathlib.Path(a.key_file).read_text().strip();statepath=pathlib.Path(a.state)
s=json.loads(statepath.read_text()) if statepath.exists() else {}
def save():
 fd=os.open(statepath,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
 with os.fdopen(fd,'w') as f:json.dump(s,f)
def api(path,method='GET',data=None,form=False,raw=None,content_type=None,host='https://api.fastly.com'):
 headers={'Fastly-Key':key,'Accept':'application/json'}
 if raw is not None: body=raw;headers['Content-Type']=content_type
 elif data is not None:
  body=urllib.parse.urlencode(data).encode() if form else json.dumps(data).encode();headers['Content-Type']='application/x-www-form-urlencoded' if form else 'application/json'
 else:body=None
 try:
  with urllib.request.urlopen(urllib.request.Request(host+path,data=body,headers=headers,method=method),timeout=45) as r:
   b=r.read();return json.loads(b) if b else {}
 except urllib.error.HTTPError as e:
  # Redact all credentials before exposing bounded API diagnostics.
  detail=e.read(8192).decode('utf8','replace')
  for value in [key,s.get('probeToken',''),s.get('objectKey',{}).get('access_key',''),s.get('objectKey',{}).get('secret_key','')]:
   if value:
    detail=detail.replace(value,'[redacted]').replace(base64.b64encode(value.encode()).decode(),'[redacted]')
  raise RuntimeError('Fastly API '+str(e.code)+' '+path+' '+detail[:1200]) from None
if a.action=='bootstrap':
 if s:raise RuntimeError('Use a fresh state file; no repeated resource creation')
 s={'target':json.loads(pathlib.Path(a.target).read_text()),'name':'pulse-upload-live-'+uuid.uuid4().hex[:10],'created':[]};save()
 def record(name,value):s[name]=value;s['created'].append(name);save();print(name+' created',flush=True)
 record('objectKey',api('/resources/object-storage/access-keys','POST',{'description':s['name'],'permission':'read-write-objects','buckets':[s['target']['bucket']]}))
 record('secretStore',api('/resources/stores/secret','POST',{'name':s['name']}))
 store=s['secretStore']['id'];s['probeToken']=secrets.token_hex(32);save()
 for name,value in [('PROBE_TOKEN',s['probeToken']),('S3_ID',s['objectKey']['access_key']),('S3_SECRET',s['objectKey']['secret_key'])]:
  api('/resources/stores/secret/'+store+'/secrets','POST',{'name':name,'secret':base64.b64encode(value.encode()).decode()})
 record('service',api('/service','POST',{'name':s['name'],'type':'wasm','comment':'Temporary bounded Pulse upload QA; retire after qualification'},form=True))
 sid=s['service']['id'];versions=api('/service/'+sid+'/version');s['version']=versions[-1]['number'];save();v=str(s['version'])
 s['domain']=s['name']+'.edgecompute.app';save()
 api('/service/'+sid+'/version/'+v+'/domain','POST',{'name':s['domain']},form=True)
 host=urllib.parse.urlparse(s['target']['endpoint']).hostname
 api('/service/'+sid+'/version/'+v+'/backend','POST',{'name':'object_origin','address':host,'port':443,'use_ssl':1,'ssl_check_cert':1,'ssl_sni_hostname':host,'ssl_cert_hostname':host,'override_host':host,'connect_timeout':3000,'first_byte_timeout':15000,'between_bytes_timeout':15000},form=True)
 api('/service/'+sid+'/version/'+v+'/resource','POST',{'name':'app_secrets','resource_id':store},form=True)
 s['bootstrapped']=True;save();print(json.dumps({'service':sid,'version':v,'domain':s['domain']}))
elif a.action=='activate':
 if not s.get('bootstrapped') or s.get('activated'):raise RuntimeError('Unexpected deployment state')
 root=pathlib.Path(a.artifact);wasm=(root/'bin/main.wasm').read_bytes();receipt=json.loads((root/'artifact.json').read_text())
 if hashlib.sha256(wasm).hexdigest()!=receipt['wasmSha256'] or receipt['target']!=s['target']:raise RuntimeError('Artifact identity/target mismatch')
 buf=io.BytesIO()
 with tarfile.open(fileobj=buf,mode='w:gz') as tar:
  for directory in ['package','package/bin']:
   info=tarfile.TarInfo(directory);info.type=tarfile.DIRTYPE;info.mode=0o755;info.mtime=0;tar.addfile(info)
  for name in ['fastly.toml','bin/main.wasm']:
   data=(root/name).read_bytes();info=tarfile.TarInfo('package/'+name);info.size=len(data);info.mode=0o644;info.mtime=0;tar.addfile(info,io.BytesIO(data))
 package=buf.getvalue();(root/'package.tar.gz').write_bytes(package);boundary='pulse'+uuid.uuid4().hex
 body=('--'+boundary+'\r\nContent-Disposition: form-data; name="package"; filename="package.tar.gz"\r\nContent-Type: application/gzip\r\n\r\n').encode()+package+('\r\n--'+boundary+'--\r\n').encode()
 path='/service/'+s['service']['id']+'/version/'+str(s['version'])
 s['package']=api(path+'/package','PUT',raw=body,content_type='multipart/form-data; boundary='+boundary);s['artifact']=receipt;s['packageSha256']=hashlib.sha256(package).hexdigest();s['packageSha512']=hashlib.sha512(package).hexdigest();save()
 if s['package']['metadata']['hashsum']!=s['packageSha512']:raise RuntimeError('Remote package hash mismatch')
 validation=api(path+'/validate');s['validation']=validation;save()
 if validation.get('status')!='ok':raise RuntimeError('Service validation did not pass')
 s['activation']=api(path+'/activate','PUT');s['activated']=True;save();print(json.dumps({'activated':True,'service':s['service']['id'],'domain':s['domain'],'wasmSha256':receipt['wasmSha256']}))
elif a.action=='inspect':
 sid=s['service']['id'];v=str(s['version']);detail=api('/service/'+sid+'/details');package=api('/service/'+sid+'/version/'+v+'/package')
 localhash=hashlib.sha512((pathlib.Path(a.artifact)/'package.tar.gz').read_bytes()).hexdigest()
 active=detail['active_version'];assert active['number']==s['version'] and active['active']
 assert package['metadata']['hashsum']==localhash
 assert any(d['name']==s['domain'] for d in active['domains'])
 result={'status':'passed','service':sid,'version':s['version'],'active':True,'domain':s['domain'],'wasmSha256':s['artifact']['wasmSha256'],'packageSha256':s['packageSha256'],'packageSha512':localhash,'remotePackage':package['metadata'],'backend':[{'name':b['name'],'address':b['address'],'use_ssl':b['use_ssl'],'ssl_check_cert':b['ssl_check_cert']} for b in active['backends']]}
 pathlib.Path(a.out).write_text(json.dumps(result,indent=2)+'\n');print('Active version/domain and exact package hash verified')
elif a.action=='metrics':
 d=api('/v1/channel/'+s['service']['id']+'/ts/'+a.since,host='https://rt.fastly.com')
 pathlib.Path(a.out).write_text(json.dumps(d,indent=2)+'\n');print(json.dumps({'records':len(d.get('Data',[])),'timestamp':d.get('Timestamp')}))
elif a.action in ['deactivate','retire','inspect']:
 # Only resources whose exact identities were persisted by this run.
 if a.action=='retire':
  if not a.cleanup_receipt:raise RuntimeError('Retirement requires the completed cleanup receipt')
  cleanup=json.loads(pathlib.Path(a.cleanup_receipt).read_text())
  if cleanup.get('status')!='passed-observed-absence' or cleanup.get('service')!=s['service']['id'] or cleanup.get('prefix')!=s['target']['prefix']:raise RuntimeError('Cleanup receipt does not qualify retirement')
 if s.get('activated') and not s.get('deactivated'):
  api('/service/'+s['service']['id']+'/version/'+str(s['version'])+'/deactivate','PUT');s['deactivated']=True;s['deactivatedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();save()
 if a.action=='retire' and s.get('objectKey') and not s.get('keyRevoked'):
  api('/resources/object-storage/access-keys/'+s['objectKey']['access_key'],'DELETE');s['keyRevoked']=True;save()
 if a.action=='retire':
  if s.get('service') and not s.get('serviceDeleted'):
   api('/service/'+s['service']['id'],'DELETE');s['serviceDeleted']=True;save()
  if s.get('secretStore') and not s.get('storeDeleted'):
   api('/resources/stores/secret/'+s['secretStore']['id'],'DELETE');s['storeDeleted']=True;save()
 print(json.dumps({'deactivated':s.get('deactivated',False),'keyRevoked':s.get('keyRevoked',False),'serviceDeleted':s.get('serviceDeleted',False),'storeDeleted':s.get('storeDeleted',False)}))
