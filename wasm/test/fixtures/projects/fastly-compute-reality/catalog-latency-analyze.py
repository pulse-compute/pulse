"""Reproduce the bounded read cohort breakdown from retained JSON files.
Usage: python3 catalog-latency-analyze.py BASELINE.json DIAGNOSTIC.json EFFECT_MAP.json
"""
import collections
import json
import statistics
import sys

baseline, diagnostic, effect_map = [json.load(open(p)) for p in sys.argv[1:]]
assert baseline['status'] == diagnostic['status'] == 'completed'
assert baseline['planSha256'] == diagnostic['planSha256']
a, b = baseline['rows'], diagnostic['rows']
assert len(a) == len(b)
names = {x['index']: x['kind'] for x in effect_map}
kind_names = {}
for old, row in zip(a, b):
    assert old['label'] == row['label'] and old['path'] == row['path']
    assert old['http_code'] == row['http_code'] == 200
    assert old['bodySha256'] == row['bodySha256'], 'Response body differs'
    timing = row['server']
    assert timing['valid'] and timing['open'] == timing['dropped'] == 0
    for span in timing['spans']:
        name = names[span[0]]
        assert kind_names.get(span[1], name) == name
        kind_names[span[1]] = name
    # This sample must be serial before adding wait intervals as a wall partition.
    end = 0
    for span in sorted(timing['spans'], key=lambda x: x[2]):
        assert span[2] >= end - 1, 'Overlapping spans require critical-path analysis'
        end = span[2] + span[3]
    assert end <= timing['wallUs'] + 1

authenticated = [r for r in b if r['label'] != 'health']
assert authenticated
totals = collections.defaultdict(lambda: [0] * 6)
for row in authenticated:
    for total in row['server']['totals']:
        for i, value in enumerate(total[1:]): totals[kind_names[total[0]]][i] += value
wall = sum(r['server']['wallUs'] for r in authenticated)
wait = sum(t[2] for t in totals.values())
assert 0 <= wait <= wall
n = len(authenticated)
routes = []
for label in dict.fromkeys(r['label'] for r in b):
    rows = [r for r in b if r['label'] == label]
    routes.append(dict(label=label, requests=len(rows),
                       clientMeanMs=statistics.mean(r['time_total']*1000 for r in rows),
                       serverMeanMs=statistics.mean(r['server']['wallUs']/1000 for r in rows)))
report = dict(schemaVersion='catalog.live-latency-breakdown.v1',
              requests=len(b), authenticatedRequests=n, bodyMatches=len(b),
              observedApplicationOverlap=False, serverMeanMs=wall/n/1000,
              readinessWaitMeanMs=wait/n/1000, readinessWaitSharePct=100*wait/wall,
              otherServerMeanMs=(wall-wait)/n/1000,
              operations={name: dict(count=t[0], elapsedMs=t[1]/1000, waitMs=t[2]/1000,
                   credentialMs=t[3]/1000, signingMs=t[4]/1000, bodyMs=t[5]/1000,
                   meanWaitPerOperationMs=t[2]/t[0]/1000, waitShareOfServerPct=100*t[2]/wall)
                   for name,t in totals.items()}, routes=routes,
              limitations=['Three observations per route; no capacity or percentile claim.',
                 'Wall spans, not CPU attribution. Remaining time includes app, framework, hostcalls and measurement overhead.',
                 'Read-only sample; write behavior and long-tail failures remain unmeasured.',
                 'Separate cohorts are not a controlled estimate of instrumentation overhead.'])
print(json.dumps(report, indent=2))
