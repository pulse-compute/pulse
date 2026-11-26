from control import *
import base64
from urllib.parse import urlparse
s=state();assert 'objectKey' not in s;target=json.loads((ROOT/'target.json').read_text());s['target']=target
s['objectKey']=api('/resources/object-storage/access-keys','POST',{'description':'pulse-rc-h04-'+uuid.uuid4().hex[:10],'permission':'read-write-objects','buckets':[target['bucket']]});save(s)
store=s['secretStore']['id']
for name,value in [('S3_ID',s['objectKey']['access_key']),('S3_SECRET',s['objectKey']['secret_key'])]:api('/resources/stores/secret/'+store+'/secrets','POST',{'name':name,'secret':base64.b64encode(value.encode()).decode()})
r=create('origins');domain(r)
api('/service/'+r['id']+'/version/1/resource','POST',{'name':'app_secrets','resource_id':store})
backend(r,'object_origin',urlparse(target['endpoint']).hostname)
fhost=urlparse((ROOT/'origins/fetch-url.txt').read_text().strip()).hostname
backend(r,'fetch_origin',fhost)
api('/service/'+r['id']+'/version/1/backend','POST',{'name':'failed_origin','address':fhost,'port':1,'use_ssl':'1','ssl_check_cert':'1','ssl_cert_hostname':fhost,'ssl_sni_hostname':fhost,'override_host':fhost,'connect_timeout':250,'first_byte_timeout':500})
package(r,ROOT/'origin-build/main.wasm');activate(r);print('Origin proof active',r['id'],r['domain'],flush=True)
