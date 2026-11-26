from control import *
for r in state()['resources']:
 if r['label'] not in ['fanout','websocket','fanout-router','websocket-router','independent']:continue
 assert not r['deleted']
 api('/service/'+r['id']+'/version/'+str(r['version'])+'/deactivate','PUT');r['deactivated']=True;r['deactivatedAt']=time.time();update(r)
 api('/service/'+r['id'],'DELETE');r['deleted']=True;update(r)
 print('Retired terminal service',r['label'],flush=True)
