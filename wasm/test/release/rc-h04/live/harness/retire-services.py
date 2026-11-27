from control import *
for r in state()['resources']:
 if r['deleted']:continue
 if not r.get('deactivated'):
  api('/service/'+r['id']+'/version/'+str(r['version'])+'/deactivate','PUT');r['deactivated']=True;r['deactivatedAt']=time.time();update(r)
 api('/service/'+r['id'],'DELETE');r['deleted']=True;update(r)
 print('Retired service',r['label'],flush=True)
