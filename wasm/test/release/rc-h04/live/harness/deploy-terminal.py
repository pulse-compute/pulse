from control import *
from urllib.parse import urlparse
import subprocess
origin=urlparse((ROOT/'origins/terminal-url.txt').read_text().strip()).hostname
cli=pathlib.Path('/workspace/scratch/ef4956ac6b89/pulse/.validation-tools/fastly/fastly')
config={'version':'pulse.terminal-hosted-config.v1','cli':{'file':str(cli),'sha256':hashlib.sha256(cli.read_bytes()).hexdigest(),'version':subprocess.check_output([str(cli),'version'],timeout=20,text=True).strip()},'cases':[]}
for label in ['fanout','websocket','fanout-router','websocket-router','independent']:
 r=create(label);print('created',label,r['id'],flush=True)
 domain(r);backend(r,'terminal_origin',origin)
 product='websockets' if label.startswith('websocket') else 'fanout'
 api('/enabled-products/v1/'+product+'/services/'+r['id'],'PUT');r['product']=product;update(r)
 package(r,ROOT/'terminal-ci/bundle'/(label+'.wasm'));activate(r)
 config['cases'].append({'id':label,'serviceId':r['id'],'serviceVersion':r['version'],'url':'https://'+r['domain']+'/','package':r['package'],'filesHash':r['filesHash']})
 (ROOT/'terminal-hosted-config.json').write_text(json.dumps(config,indent=2)+'\n')
 print('activated',label,r['domain'],flush=True)
