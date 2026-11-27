import json,pathlib,urllib.request,urllib.error,time
root=pathlib.Path('/tmp/rc-h04-live');s=json.loads((root/'resources.json').read_text());rows=[]
for attempt in range(12):
 pops=[]
 for label in ['probe-iad','probe-lhr']:
  r=next(r for r in s['resources'] if r['label']==label)
  try:
   q=urllib.request.Request('https://'+r['domain']+'/',data=b'{"operation":"get","key":"pulse-k4-admission-absent"}',headers={'content-type':'application/json','x-probe-token':s['probeToken']})
   with urllib.request.urlopen(q,timeout=20) as resp:
    row={'attempt':attempt+1,'probe':label,'status':resp.status,'body':resp.read(300).decode(),'pop':resp.headers.get('x-rc-pop'),'service':resp.headers.get('x-rc-service'),'requestId':resp.headers.get('x-rc-request')};pops.append(row['pop'])
  except urllib.error.HTTPError as e:row={'attempt':attempt+1,'probe':label,'status':e.code,'body':e.read(500).decode()}
  rows.append(row);print({k:v for k,v in row.items() if k!='body'},flush=True);(root/'probe-readiness.json').write_text(json.dumps(rows,indent=2)+'\n')
 if set(pops)=={'IAD','LHR'}:break
 time.sleep(5)
else:raise RuntimeError('Two-region read admission not ready')
