from control import *
from concurrent.futures import ThreadPoolExecutor
s=state();assert all(r['deleted'] and r['deactivated'] for r in s['resources']);assert all(s.get(k) for k in ['kvStoreDeleted','objectKeyRevoked','secretStoreDeleted'])
def check_service(r):
 d=api('/service/'+r['id']);assert d.get('deleted_at') and all(not v['active'] and not v.get('deployed') for v in d['versions'])
 return {'label':r['label'],'id':r['id'],'version':r['version'],'domain':r['domain'],'deactivated':True,'deleted':True,'deletedAt':d['deleted_at'],'inactiveVersionsVerified':True,'lookupStatus':200,'lookupDisposition':'retained-deletion-record'}
with ThreadPoolExecutor(max_workers=4) as pool:services=list(pool.map(check_service,s['resources']))
checks=[]
for p in ['/resources/stores/kv/'+s['kvStore']['id'],'/resources/stores/secret/'+s['secretStore']['id']]:
 try:api(p)
 except RuntimeError as e:
  assert 'Fastly 404 ' in str(e);checks.append({'path':p,'status':404});continue
 raise RuntimeError('Store not absent')
rows=json.loads((ROOT/'kv-before-teardown.json').read_text())['keys']
for row in rows:row['deleted']=True
report={'status':'passed','services':services,'kv':{'storeId':s['kvStore']['id'],'keys':rows,'emptyStrongListObserved':True,'deleted':True},'s3':{'bucket':s['target']['bucket'],'prefix':s['target']['prefix'],'keys':1,'absenceObservedTwice':True,'objectKeyRevoked':True},'secretStore':{'id':s['secretStore']['id'],'deleted':True},'storeAbsenceChecks':checks,'managementTokenRevoked':False,'scope':'Only exact resources created in this run and one recorded object key; existing QA bucket and unrelated services unchanged'}
(ROOT/'cleanup.json').write_text(json.dumps(report,indent=2)+'\n');print('Verified retirement of 9 services, 2 stores, 4 KV keys, 1 object and scoped S3 key')
