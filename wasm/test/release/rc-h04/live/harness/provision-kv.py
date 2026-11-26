from control import *
import base64,secrets
# Private values remain only in mode-0600 state; receipts copy identifiers only.
s=state();assert 'secretStore' not in s
s['secretStore']=api('/resources/stores/secret','POST',{'name':'pulse-rch04-'+uuid.uuid4().hex[:10]});s['probeToken']=secrets.token_hex(32);save(s)
store=s['secretStore']['id']
api('/resources/stores/secret/'+store+'/secrets','POST',{'name':'PROBE_TOKEN','secret':base64.b64encode(s['probeToken'].encode()).decode()})
s=state();s['kvStore']=api('/resources/stores/kv','POST',{'name':'pulse-rch04-'+uuid.uuid4().hex[:10]});save(s)
r=create('kv');domain(r)
api('/service/'+r['id']+'/version/1/resource','POST',{'name':'app_secrets','resource_id':store})
api('/service/'+r['id']+'/version/1/resource','POST',{'name':'k4_catalog','resource_id':s['kvStore']['id']})
package(r,ROOT/'k4-build/main.wasm');activate(r)
print('KV active',r['id'],r['domain'],flush=True)
