from control import *
import datetime
s=state();r=next(r for r in s['resources'] if r['label']=='origins');assert r['active'] and not r.get('deactivated')
api('/service/'+r['id']+'/version/1/deactivate','PUT');r['deactivated']=True;r['deactivatedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();update(r)
assert api('/service/'+r['id']+'/version/1')['active']==False
private={'target':s['target'],'objectKey':s['objectKey'],'service':{'id':r['id']},'deactivated':True,'deactivatedAt':r['deactivatedAt']}
p=ROOT/'s3-cleanup-state.json';fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
with os.fdopen(fd,'w') as f:json.dump(private,f)
print('S3/fetch service deactivated; starting 45-second quiescence',flush=True)
time.sleep(45)
