#!/usr/bin/env python3
"""Read-only, task-level scheduling experiment. Never runs/reuses qualifications.
python3 docs/internal/b10-02/analyze.py --root . --inventory audit.json --out OUT
"""
import argparse, collections, hashlib, json, pathlib, re, subprocess
HERE=pathlib.Path(__file__).resolve().parent
sha=lambda b:hashlib.sha256(b).hexdigest()
def read(p):return json.loads(p.read_text())
def simulate(rows, workers=2, compilers=1, layout='mixed', factor=1.0):
    """Mirror runner priority barrier, cost order, locks, after, exclusive hints.
    Durations are fixed task occupancy; controller work/contention not modeled.
    """
    assert workers>=compilers>=1
    queue=sorted(enumerate(rows),key=lambda ir:(-ir[1]['scheduling']['priority'],-ir[1]['scheduling']['cost'],ir[0]))
    ids={r['id'] for r in rows};assert len(ids)==len(rows)
    assert all(set(r['scheduling']['after'])<=ids for r in rows)
    active=[];done=set();timeline=[];now=0
    def eligible(r,w):
        if layout=='mixed':return True
        # Whole cross-target tasks stay intact on the Fastly-capable lane.
        if layout=='host2':return w==(1 if r['lane'] in ['fastly','mixed'] else 0)
        if layout=='host3':return w==({'fastly':1,'mixed':2}.get(r['lane'],0))
        raise ValueError(layout)
    while queue or active:
        priority=max([r['scheduling']['priority'] for _,r in queue]+[x['priority'] for x in active]+[-1])
        free=set(range(workers))-{x['worker'] for x in active}
        i=0
        while i<len(queue) and free:
            _,r=queue[i];h=r['scheduling'];held={lock for x in active for lock in x['resources']}
            available=sorted(w for w in free if eligible(r,w))
            if (h['priority']!=priority or not available or (h['compiler'] and sum(x['compiler'] for x in active)>=compilers)
                or not set(h['after'])<=done or set(h['resources'])&held
                or (h['exclusive'] and active) or any(x['exclusive'] for x in active)):
                i+=1;continue
            worker=available[0];free.remove(worker);queue.pop(i)
            event={'id':r['id'],'worker':worker,'startMs':now,'endMs':now+r['durationMs']*factor,
                   'compiler':h['compiler'],'resources':h['resources'],'priority':h['priority'],'exclusive':h['exclusive']}
            active.append(event);timeline.append(event.copy())
        if not active:
            assert not queue,'Deadlocked/ineligible layout'
            break
        now=min(x['endMs'] for x in active)
        finished=[x for x in active if x['endMs']<=now]
        done.update(x['id'] for x in finished);active=[x for x in active if x['endMs']>now]
    assert done==ids
    occupancy=sum(r['durationMs']*factor for r in rows)
    compiler=sum(r['durationMs']*factor for r in rows if r['scheduling']['compiler'])
    return {'wallMs':now,'workerOccupancyMs':occupancy,'compilerTaskOccupancyMs':compiler,
            'idleWorkerMs':workers*now-occupancy,'floorMs':max(occupancy/workers,compiler/compilers,max([r['durationMs']*factor for r in rows]+[0])),
            'coverage':{'expected':len(rows),'scheduled':len(timeline),'unique':len(done),'idsSha256':sha('\n'.join(sorted(done)).encode())},'timeline':timeline}

def source_paths(root,primary,extra):
    # Literal helper edges are navigation, NOT an executable call-graph proof.
    # Do not traverse imported registries/runners or product module implementations.
    seen=set();pending=[primary,*extra]
    for rel in pending:
        assert (root/rel).is_file() and not (root/rel).is_symlink(), 'Missing explicit source: '+rel
    while pending:
        rel=pending.pop()
        if rel in seen:continue
        p=root/rel
        if not p.is_file() or p.is_symlink():continue
        seen.add(rel);s=p.read_text()
        for name in re.findall(r"(?:require\(|from\s+)[\"']([^\"']+)",s):
            if not name.startswith('.'):continue
            base=(p.parent/name).resolve()
            for f in [base,pathlib.Path(str(base)+'.cjs'),pathlib.Path(str(base)+'.js')]:
                if not f.is_file():continue
                target=f.relative_to(root).as_posix() if f.is_relative_to(root) else ''
                if (target.startswith('wasm/test/') or re.match(r'packages/[^/]+/test/',target)) and not target.startswith('wasm/test/suite/') and f.suffix in ['.cjs','.js','.ts']:
                    pending.append(target)
                break
    return sorted(seen)

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--root',type=pathlib.Path,required=True);ap.add_argument('--inventory',type=pathlib.Path,required=True);ap.add_argument('--out',type=pathlib.Path,required=True);a=ap.parse_args();root=a.root.resolve()
    inventory=read(a.inventory);review=read(HERE/'review.json');timings=read(HERE/'timing-input.json')
    ids=inventory['profiles']['release']+inventory['installedGates'];assert len(ids)==len(set(ids))==201
    assert set(ids)==set(review['tasks'])==set(timings['tasks'])
    assert inventory['inventorySource']['revision']==review['candidate'] and not inventory['inventorySource']['dirty']
    # The captured inventory is fixed at the clean candidate; changed analyzed
    # source bytes must fail even if a later analysis/report commit is checked out.
    owners=inventory['inventorySource']['ownerHashes']
    for p,digest in owners.items():assert sha((root/p).read_bytes())==digest,p
    definitions={r['id']:r for r in inventory['tasks']};matrix=[];sources={}
    boundaries=read(HERE/'boundaries.json')
    for id in ids:
        task=definitions[id];curated=review['tasks'][id];inv=task['invocation'];primary=inv.get('args',inv.get('files'))[0]
        if pathlib.Path(primary).is_absolute():
            primary=primary.split('/pulse/',1)[1] if '/pulse/' in primary else pathlib.Path(primary).relative_to(root).as_posix()
        otherFiles=[f.split('/pulse/',1)[1] if '/pulse/' in f else f for f in inv.get('files',[])]
        paths=source_paths(root,primary,[*otherFiles,*boundaries.get('extraSources',{}).get(id,[])])
        refs=[];operations=[];writes=[];cleanup=[];tools={'node','frozen-dependencies'}
        for rel in paths:
            p=root/rel;data=p.read_bytes();sources[rel]=sha(data)
            for n,line in enumerate(data.decode().splitlines(),1):
                # Compact source anchors support review; matches are not claims
                # that every branch executes under this task invocation.
                pattern=r'(?:execute\w+|compile\w+|buildProject|runProjectTests|packRelease|copySharedPack|verifyInstalled|replayCorpus|qualifyViceroy|startFastlyComputeServer)\s*\('
                if re.search(pattern,line) and not re.match(r'\s*(?://|\*)',line):operations.append({'path':rel,'line':n,'text':line.strip()[:240]})
                if re.search(r'\b(?:writeFileSync|mkdirSync|mkdtempSync|symlinkSync|copyFileSync|cpSync)\s*\(',line):writes.append({'path':rel,'line':n,'text':line.strip()[:180]})
                if re.search(r'\b(?:rmSync|cleanup\w*|closeServer|kill)\s*\(',line):cleanup.append({'path':rel,'line':n,'text':line.strip()[:180]})
            if re.search(r'typescript|tsc\.js|transpile',data.decode()):tools.add('typescript')
            if re.search(r'cargo|rustc',data.decode()):tools.add('rust-toolchain-or-prebuilt-guest (inspect selected path)')
        targets=curated['targets'];node=any(k.startswith('node-') for k in targets);fastly=any(k.startswith('fastly-') for k in targets)
        lane='mixed' if node and fastly else 'node' if node else 'fastly' if fastly else 'shared'
        installed=task['installedGate'] or id in boundaries['installedInsideRelease']
        preparation='private-installed-consumer' if installed else 'task-owned-fixtures'
        if id=='release-artifact-determinism':preparation='verified-first-pack-plus-independent-fresh-pack'
        if id=='release-packages':preparation='verified-shared-pack-private-copy'
        if any(mode in ['build','abi-fixture','local-http','viceroy','abi-fixture; optional-viceroy'] for k,mode in targets.items() if k.endswith('native')):tools.update(['assemblyscript','binaryen-as-required-by-realization'])
        if targets.get('fastly-javascript')=='js-compute-build':tools.update(['esbuild','js-compute'])
        if 'viceroy' in targets.values():tools.add('fastly-cli-managed-local-engine')
        if any('optional-viceroy' in mode for mode in targets.values()):tools.add('conditional-PULSE_VICEROY_BIN')
        if installed:tools.add('npm/private-cache/loopback-registry-or-local-tarballs')
        hints=task['sealScheduling'];responsibilities=['shared-contract-or-compiler']
        responsibilities+=list(targets)
        if node and fastly or len(targets)>1:responsibilities.append('cross-target-or-composed')
        if installed:responsibilities.append('installed-consumer')
        if id in boundaries['authorityTasks']:responsibilities.append('release-authority-validation')
        if id in boundaries['independentConstruction']:responsibilities.append('independent-determinism')
        time=timings['tasks'][id]
        assert time['status']=='passed' and time['cleanup']=='passed'
        matrix.append({'id':id,'stage':'installed' if task['installedGate'] else 'release','description':task['description'],
          'invocation':inv,'targets':targets,'responsibilities':responsibilities,'lane':lane,'notes':curated['notes'],
          'preparationOwner':preparation,'prerequisites':['exact-clean-candidate','pinned-built-inputs','exclusive-verified-worker','shared-pack-ready']+hints['after'],
          'mutableOwnership':'Private worker checkout, task temp root and owned artifact outputs; retain source/dependency/build reconciliation before reuse.',
          'toolDependencies':sorted(tools),'scheduling':hints,'sourceFiles':paths,'primary':primary,
          'operationAnchors':operations,'writeAnchors':writes,'cleanupAnchors':cleanup,
          'unresolved':'Literal helper closure is review navigation, not complete JS dataflow; dynamic imports/CLI/package execution follow the documented boundaries. No independence inferred from absent locks.',
          'durationMs':time['durationMs'],'durationProvenance':timings['candidate'],'currentCandidateMeasured':False})
    for rel in boundaries['providerBoundarySources']:
        sources[rel]=sha((root/rel).read_bytes())
    changed=subprocess.check_output(['git','diff','--name-only',review['candidate'],'--',*sources],cwd=root,text=True).splitlines()
    assert not changed, 'Analyzed source differs from pinned candidate: '+str(changed)
    tracked=set(subprocess.check_output(['git','ls-tree','-r','--name-only',review['candidate']],cwd=root,text=True).splitlines())
    assert set(sources)<=tracked, 'Untracked source cannot be candidate evidence'
    historicalChanged=set(subprocess.check_output(['git','diff','--name-only',timings['candidate'],review['candidate']],cwd=root,text=True).splitlines())
    sourceDrift=sorted(set(sources)&historicalChanged)
    for row in matrix:row['sourceDriftFromTimingCandidate']=sorted(set(row['sourceFiles'])&historicalChanged)
    scenarios=[]
    specs=[('current-mixed-2w-1c',2,1,'mixed',False,1),('host-2w-1c',2,1,'host2',False,1),
           ('mixed-2w-2c',2,2,'mixed',False,1),('host-2w-2c',2,2,'host2',False,1),
           ('mixed-3w-2c',3,2,'mixed',False,1),('host-3w-2c',3,2,'host3',False,1),
           ('mixed-2w-1c-overlap-stages',2,1,'mixed',True,1),('mixed-2w-2c-overlap-stages',2,2,'mixed',True,1),
           ('mixed-2w-2c-slowdown-1.078',2,2,'mixed',False,1.078),('mixed-2w-2c-slowdown-1.25',2,2,'mixed',False,1.25)]
    for name,w,c,layout,overlap,factor in specs:
        stages=[matrix] if overlap else [[r for r in matrix if r['stage']==stage] for stage in ['release','installed']]
        runs=[simulate(rows,w,c,layout,factor) for rows in stages]
        for rows,run in zip(stages,runs):
            by={event['id']:event for event in run['timeline']}
            assert set(by)=={row['id'] for row in rows}
            for row in rows:
                event=by[row['id']]
                assert all(by[dep]['endMs']<=event['startMs'] for dep in row['scheduling']['after'])
            for instant in sorted({event['startMs'] for event in by.values()}):
                active=[event for event in by.values() if event['startMs']<=instant<event['endMs']]
                assert len(active)<=w and len({event['worker'] for event in active})==len(active)
                assert sum(event['compiler'] for event in active)<=c
                locks=[lock for event in active for lock in event['resources']]
                assert len(locks)==len(set(locks))
                assert not any(event['exclusive'] for event in active) or len(active)==1
        scenarios.append({'name':name,'workers':w,'compilers':c,'layout':layout,'overlapStages':overlap,'durationFactor':factor,
                          'wallMs':sum(run['wallMs'] for run in runs),'stages':runs,'scope':'Fixed-duration projection only; no setup/cleanup-controller cost model, memory model, qualification or implementation authority.'})
    counts=collections.Counter(r['lane'] for r in matrix)
    output={'schema':'pulse.b10-02.analysis.v1','inventorySource':inventory['inventorySource'],'durationSource':{k:v for k,v in timings.items() if k!='tasks'},
      'coverage':{'release':len(inventory['profiles']['release']),'installed':len(inventory['installedGates']),'distinct':len(matrix),'laneCounts':dict(counts)},
      'sourceHashes':sources,'sourceDriftFromTimingCandidate':sourceDrift,'tasks':matrix,'scenarios':scenarios}
    a.out.mkdir(parents=True,exist_ok=True);(a.out/'analysis.json').write_text(json.dumps(output,indent=2)+'\n')
    compact={**output,'tasks':[{k:v for k,v in r.items() if k not in ['operationAnchors','writeAnchors','cleanupAnchors','unresolved']} for r in matrix],
             'scenarios':[{**s,'stages':[{k:v for k,v in t.items() if k!='timeline'} for t in s['stages']]} for s in scenarios]}
    (a.out/'results.json').write_text(json.dumps(compact,indent=2)+'\n')
    lines=['# B10-02 task responsibility matrix','','Candidate `'+review['candidate']+'`. Targets describe responsibilities, not fresh execution claims. Every task remains atomic. Source links are pinned to this candidate. See README for modes, common prerequisites and independent boundaries.','','| Task | Stage / lane | Target responsibility and method | Preparation | Source |','| --- | --- | --- | --- | --- |']
    for r in matrix:
        url='https://github.com/pulse-compute/pulse/blob/'+review['candidate']+'/'+r['primary']
        lines.append('| `'+r['id']+'` | '+r['stage']+' / '+r['lane']+' | '+('; '.join(k+': '+v for k,v in r['targets'].items()) or 'shared contracts / lowering / evidence')+' | '+r['preparationOwner']+' | [body]('+url+') |')
    (a.out/'matrix.md').write_text('\n'.join(lines)+'\n')
    print(json.dumps({'coverage':output['coverage'],'sourceFiles':len(sources),'scenarios':[{k:s[k] for k in ['name','wallMs']} for s in scenarios]},indent=2))
if __name__=='__main__':main()
