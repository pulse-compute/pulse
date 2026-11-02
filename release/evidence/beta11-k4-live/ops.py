import importlib.util,json,pathlib,secrets,sys,urllib.request,urllib.parse,urllib.error,hashlib,re
ROOT=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('prior_ops',ROOT.parent/'live-571/fastly_ops.py'); prior=importlib.util.module_from_spec(spec);spec.loader.exec_module(prior)
TOKEN=prior.TOKEN
LEDGER=ROOT/'deployment.json'
def load():return json.loads(LEDGER.read_text()) if LEDGER.exists() else {'services':[], 'authority':'User directed deployed K4 qualification and supplied temporary account token; isolated task-owned resources only'}
def save(x):LEDGER.write_text(json.dumps(x,indent=2)+'\n')
def api(method,route,fields=None,json_body=None,package=None):
 if json_body is None:return prior.api(method,route,fields,package)
 req=urllib.request.Request('https://api.fastly.com'+route,data=json.dumps(json_body).encode(),headers={'Fastly-Key':TOKEN,'Accept':'application/json','Content-Type':'application/json'},method=method)
 try:
  with urllib.request.urlopen(req,timeout=40) as r:return json.loads(r.read())
 except urllib.error.HTTPError as e:raise RuntimeError(f'{method} {route}: HTTP {e.code}: '+e.read(2000).decode(errors='replace').replace(TOKEN,'[redacted]')) from None
def provision():
 d=load()
 if 'suffix' not in d:d['suffix']=secrets.token_hex(4);save(d)
 if 'storeId' not in d:
  store=api('POST','/resources/stores/kv',json_body={'name':'pulse-k4-beta11-'+d['suffix']});d['storeId']=store['id'];d['storeCreation']=store;save(d);print('Created isolated KV store',d['storeId'],flush=True)
 for kind,typ in [('compute','wasm'),('iad','vcl'),('lhr','vcl')]:
  row=next((x for x in d['services'] if x['kind']==kind),None)
  if row is None:
   s=api('POST','/service',{'name':'Pulse beta11 K4 '+kind+' '+d['suffix'],'type':typ,'comment':'Temporary isolated user-authorized K4 qualification; task-owned cleanup'})
   row={'kind':kind,'type':typ,'serviceId':s['id'],'serviceVersion':'1','createdByThisTask':True};d['services'].append(row);save(d);print('Created',kind,row['serviceId'],flush=True)
  if 'domain' not in row:
   domain='pulse-k4-'+kind+'-'+d['suffix']+('.edgecompute.app' if kind=='compute' else '.global.ssl.fastly.net')
   api('POST',f'/service/{row["serviceId"]}/version/1/domain',{'name':domain});row['domain']=domain;save(d)
 compute=next(x for x in d['services'] if x['kind']=='compute');prefix=f'/service/{compute["serviceId"]}/version/1'
 if not compute.get('linked'):
  compute['resourceLink']=api('POST',prefix+'/resource',{'name':'k4_catalog','resource_id':d['storeId']});compute['linked']=True;save(d)
 if not compute.get('uploaded'):
  compute['package']=api('PUT',prefix+'/package',package=ROOT/'consumer/dist/pkg/pulse-k4-local.tar.gz');compute['uploaded']=True;save(d)
 if not compute.get('active'):
  compute['activation']=api('PUT',prefix+'/activate');compute['active']=True;save(d);print('Activated Compute',compute['domain'],flush=True)
 build=json.loads((ROOT/'build.json').read_text());auth=(ROOT/'probe-auth').read_text().strip()
 for row in [x for x in d['services'] if x['kind']!='compute']:
  prefix=f'/service/{row["serviceId"]}/version/1'
  if not row.get('backend'):
   row['backend']=api('POST',prefix+'/backend',{'name':'compute_origin','address':compute['domain'],'port':443,'use_ssl':1,'ssl_check_cert':1,'ssl_sni_hostname':compute['domain'],'ssl_cert_hostname':compute['domain'],'override_host':compute['domain'],'shield':'iad-va-us' if row['kind']=='iad' else 'london-uk','connect_timeout':5000,'first_byte_timeout':15000,'between_bytes_timeout':10000,'auto_loadbalance':0});save(d)
  snippets={
   'recv':'''if (req.http.x-pulse-k4-auth != "__AUTH__") { error 601 "Unauthorized"; }
if (req.method != "POST") { error 602 "POST required"; }
set var.fastly_req_do_shield = true;
''',
   'fetch':'''if (!req.backend.is_shield) {
 set beresp.http.X-Pulse-K4-Pop = server.datacenter;
 set beresp.http.X-Pulse-K4-Request = uuid.version4();
 set beresp.http.X-Pulse-K4-Service = "__SERVICE__";
 set beresp.http.X-Pulse-K4-Version = "1";
 set beresp.http.X-Pulse-K4-Store = "__STORE__";
 set beresp.http.X-Pulse-K4-Module = "__MODULE__";
 set beresp.http.X-Pulse-K4-Compute-Served-By = beresp.http.X-Served-By;
}
set beresp.ttl = 0s;
return(pass);
''',
   'error':'''if (obj.status == 601 || obj.status == 602) {
 set obj.status = 401;
 synthetic "unauthorized";
 return(deliver);
}
'''}
  for name,template in snippets.items():
   key='snippet_'+name
   if row.get(key):continue
   content=template.replace('__AUTH__',auth).replace('__SERVICE__',compute['serviceId']).replace('__STORE__',d['storeId']).replace('__MODULE__',build['moduleSha256'])
   api('POST',prefix+'/snippet',{'name':'k4_'+name,'type':name,'priority':50,'dynamic':0,'content':content});row[key]=True;save(d)
   (ROOT/('relay-'+name+'-template.vcl')).write_text(template)
  if not row.get('valid'):
   result=api('GET',prefix+'/validate');assert result.get('status')=='ok',result;row['valid']=True;row['validation']=result;save(d)
  if not row.get('active'):
   row['activation']=api('PUT',prefix+'/activate');row['active']=True;save(d);print('Activated relay',row['kind'],row['domain'],flush=True)
 d['identity']={'serviceId':compute['serviceId'],'serviceVersion':'1','storeId':d['storeId'],'moduleSha256':build['moduleSha256']};save(d)
def inspect():
 d=load();rows=[]
 for row in d['services']:
  sid=row['serviceId'];versions=api('GET',f'/service/{sid}/version');active=[str(v['number']) for v in versions if v.get('active')];assert active==[row['serviceVersion']],(row['kind'],active)
  domains=api('GET',f'/service/{sid}/version/1/domain');assert row['domain'] in [x['name'] for x in domains]
  out={'kind':row['kind'],'serviceId':sid,'activeVersions':active,'domain':row['domain']}
  if row['kind']=='compute':
   pkg=api('GET',f'/service/{sid}/version/1/package');assert pkg['metadata']['files_hash']==row['package']['metadata']['files_hash'];out['filesHash']=pkg['metadata']['files_hash']
   links=api('GET',f'/service/{sid}/version/1/resource');assert any(x['name']=='k4_catalog' and x['resource_id']==d['storeId'] for x in links)
  else:
   b=api('GET',f'/service/{sid}/version/1/backend/compute_origin');assert b['shield']==row['backend']['shield'];out['shield']=b['shield']
  rows.append(out)
 return {'status':'passed','deployments':rows,'identity':d['identity']}
def cleanup():
 d=load()
 for row in reversed(d['services']):
  assert row['createdByThisTask'];sid=row['serviceId']
  if row.get('deleted'):continue
  if row.get('active'):row['deactivation']=api('PUT',f'/service/{sid}/version/1/deactivate');row['active']=False;save(d)
  row['deletion']=api('DELETE','/service/'+sid);row['deleted']=True;save(d);print('Deleted owned service',row['kind'],sid,flush=True)
 # Retain the isolated authority/tombstone store and keys as required by K4.
 d['cleanup']={'servicesDeleted':all(x.get('deleted') for x in d['services']),'storeRetainedForEvidence':True,'storeId':d.get('storeId'),'tokenRevoked':False};save(d)
if __name__=='__main__':
 try:
  if sys.argv[1]=='inspect':
   r=inspect();(ROOT/(sys.argv[2] if len(sys.argv)>2 else 'inspection.json')).write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r))
  else:{'provision':provision,'cleanup':cleanup}[sys.argv[1]]()
 except Exception as e:print(str(e).replace(TOKEN,'[redacted]'),file=sys.stderr);sys.exit(1)
