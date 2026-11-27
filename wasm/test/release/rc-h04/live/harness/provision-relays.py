from control import *
s=state();target=next(r for r in s['resources'] if r['label']=='kv');assert target['active']
for label,shield in [('probe-iad','iad-va-us'),('probe-lhr','london-uk')]:
 r=next((r for r in state()['resources'] if r['label']==label),None)
 if r is None:
  r=create(label,'vcl');r['domain']=r['name']+'.global.ssl.fastly.net';r['shield']=shield;update(r)
  api('/service/'+r['id']+'/version/1/domain','POST',{'name':r['domain']})
  backend(r,'kv_origin',target['domain'],shield)
 else:
  assert not r['active'] and r['shield']==shield
  assert api('/service/'+r['id']+'/version/1/backend')[0]['address']==target['domain']
 path='/service/'+r['id']+'/version/1/snippet'
 api(path,'POST',{'name':'rc_guard','type':'recv','priority':10,'dynamic':0,'content':'if (req.http.x-probe-token != "'+s['probeToken']+'") { error 403; }\n'})
 api(path,'POST',{'name':'rc_no_cache','type':'fetch','priority':100,'dynamic':0,'content':'set beresp.ttl = 0s;\nset beresp.http.Cache-Control = "private, no-store";\nreturn(pass);\n'})
 activate(r);print('Relay active',label,r['id'],r['domain'],flush=True)
