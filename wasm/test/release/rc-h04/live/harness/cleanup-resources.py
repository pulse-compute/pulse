from control import *
from concurrent.futures import ThreadPoolExecutor
s=state();assert all(r['deleted'] for r in s['resources'])
proof=json.loads((ROOT/'k4-deployed.json').read_text());assert proof['status']=='passed'
prefix=proof['keyPrefix'];expected=[prefix+'-'+str(i) for i in range(3)]+[prefix+'-lost'];sid=s['kvStore']['id']
listed=api('/resources/stores/kv/'+sid+'/keys?consistency=strong');assert sorted(listed['data'])==sorted(expected)
rows=[]
for key in expected:
 result=api('/resources/stores/kv/'+sid+'/keys/'+key)
 assert result.get('__pulseKv')==1 and result.get('value')=={'deleted':True}, result
 rows.append({'key':key,'retainedTombstoneBeforeTeardown':True,'valueSha256':hashlib.sha256(json.dumps(result,sort_keys=True).encode()).hexdigest()})
(ROOT/'kv-before-teardown.json').write_text(json.dumps({'status':'passed','storeId':sid,'scope':'Administrative teardown observation after completed Pulse proof; not additional CAS evidence','keys':rows},indent=2)+'\n')
for row in rows:
 api('/resources/stores/kv/'+sid+'/keys/'+row['key'],'DELETE');row['deleted']=True
assert api('/resources/stores/kv/'+sid+'/keys?consistency=strong')['data']==[]
api('/resources/stores/kv/'+sid,'DELETE');s['kvStoreDeleted']=True;save(s)
absence=json.loads((ROOT/'s3-absence.json').read_text());assert absence['status']=='passed-observed-absence'
api('/resources/object-storage/access-keys/'+s['objectKey']['access_key'],'DELETE');s['objectKeyRevoked']=True;save(s)
api('/resources/stores/secret/'+s['secretStore']['id'],'DELETE');s['secretStoreDeleted']=True;save(s)
# Read only the exact owned identities; no global discovery or broad deletion.
def absence_status(path):
 try:api(path)
 except RuntimeError as e:
  if 'Fastly 404 ' in str(e):return 404
  raise
 raise RuntimeError('Owned resource still present: '+path)
checks=[('/service/'+r['id']) for r in s['resources']]+['/resources/stores/kv/'+sid,'/resources/stores/secret/'+s['secretStore']['id']]
with ThreadPoolExecutor(max_workers=4) as pool:statuses=list(pool.map(absence_status,checks))
report={'status':'passed','services':[{'label':r['label'],'id':r['id'],'version':r['version'],'domain':r['domain'],'deactivated':r['deactivated'],'deleted':r['deleted']} for r in s['resources']],'kv':{'storeId':sid,'keys':rows,'emptyStrongListObserved':True,'deleted':True},'s3':{'bucket':s['target']['bucket'],'prefix':s['target']['prefix'],'keys':1,'absenceObservedTwice':True,'objectKeyRevoked':True},'secretStore':{'id':s['secretStore']['id'],'deleted':True},'resourceAbsenceChecks':[{'path':p,'status':st} for p,st in zip(checks,statuses)],'managementTokenRevoked':False,'scope':'Only exact resources created in this run and recorded owned object key; existing QA bucket and unrelated services unchanged'}
(ROOT/'cleanup.json').write_text(json.dumps(report,indent=2)+'\n');print('Cleanup passed: 9 services, 1 KV store/4 keys, 1 secret store, 1 S3 object and scoped object key')
