import json,pathlib,importlib.util,hashlib,sys
root=pathlib.Path(sys.argv[1]).resolve() if len(sys.argv)>1 else pathlib.Path(__file__).resolve().parents[3]
def read(p):return json.loads(p.read_text())
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
spec=importlib.util.spec_from_file_location('model',root/'docs/internal/b10-02/analyze.py');model=importlib.util.module_from_spec(spec);spec.loader.exec_module(model)
reports={};projections={}
for label,directory in [('control','b10-ci04-control-2'),('corrected','b10-ci04-corrected')]:
 d=root/'.pulse-seal'/directory;x=read(d/'result.json');assert x['status']=='passed'
 samples=[json.loads(l)for l in (d/'process/process-samples.jsonl').read_text().splitlines()]
 final=x['observer']['remainingObservedProcesses'];rootkey=x['observer']['rootProcess']
 other=[p for p in final if p['key']!=rootkey];assert len(other)==1
 sampler=other[0]['key'];assert other[0]['parent']==int(rootkey.split(':')[0])
 cpu={};rss=0;asc=0
 initial=next(p['cpuTicks']for p in samples[0]['processes']if p['key']==rootkey)
 for s in samples:
  ps=[p for p in s['processes']if p['key']!=sampler]
  rss=max(rss,sum(p['rssKiB']for p in ps));asc=max(asc,sum(p['asc']is True for p in ps))
  for p in ps:cpu[p['key']]=max(cpu.get(p['key'],0),p['cpuTicks'])
 rows=[{'id':r['name'],'durationMs':r['durationMs'],'scheduling':x['hints'][r['name']]} for r in x['results']]
 reports[label]={'candidate':x['candidate'],'reportSha256':sha(d/'result.json'),'elapsedMs':x['elapsedMs'],
  'driverSha256':x['driverSha256'],'node':x['node'],'nodeSha256':x['nodeSha256'],'inputs':x['inputs'],
  'passed':len(rows),'cleanup':x['workerCleanup'],'logs':x['logs'],
  'tasks':[{'id':r['id'],'durationMs':r['durationMs'],'compiler':r['scheduling']['compiler']}for r in rows],
  'compilerTaskOccupancyMs':sum(r['durationMs']for r in rows if r['scheduling']['compiler']),
  'observer':{'rawReportSha256':sha(d/'process/process-summary.json'),'rawSamplesSha256':sha(d/'process/process-samples.jsonl'),
    'samplerExcluded':sampler,'controllerInitialTicksSubtracted':initial,'ticksPerSecond':100,
    'sampledCpuMs':(sum(cpu.values())-initial)*10,'peakSummedRssKiB':rss,'peakRecognizedAscProcesses':asc,
    'samples':len(samples),'maxGapMs':x['observer']['maxGapMs'],'readErrors':x['observer']['readErrors'],
    'remainingWorkloadDescendants':[]}}
 if label=='corrected':
  for c in [1,2]:
   m=model.simulate(rows,workers=2,compilers=c)
   projections[f'corrected-2-{c}']={k:v for k,v in m.items()if k!='timeline'}
assert reports['control']['driverSha256']==reports['corrected']['driverSha256']
assert reports['control']['inputs']==reports['corrected']['inputs']
assert reports['control']['nodeSha256']==reports['corrected']['nodeSha256']
result={'schema':'pulse.b10-ci04.bounded-comparison.v1','qualification':False,
 'scope':'Ten real tasks, two isolated workers, one compiler, 6144 MiB admission; no checkpoints. Setup and final worker removal excluded from elapsed task stage. Normal task cleanup; full input scans at experiment barriers only. Warm sequential control then corrected; one pair, no hosted speedup claim.',
 'limits':'Sampled CPU is a lower bound; summed RSS double-counts shared pages. Raw observer includes its sampler despite its label: derived metrics exclude the final sole non-controller observer process and subtract initial controller CPU. Sampling includes final input/cleanup checks. asc parent/relaunch pairs are actual processes, not independent logical compilations. Projections use only the ten corrected measured durations, omit controller overhead/contention, and do not forecast 190+11 release qualification.',
 'observations':reports,'observedAddedWallMs':reports['corrected']['elapsedMs']-reports['control']['elapsedMs'],'projections':projections}
print(json.dumps(result,indent=2))
