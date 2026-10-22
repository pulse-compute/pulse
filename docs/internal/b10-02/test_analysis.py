#!/usr/bin/env python3
"""Model guardrails: no qualification execution; small independent scheduling oracles."""
import unittest
from analyze import simulate

def task(id,ms,**hints):
    lane=hints.pop('lane','shared')
    return {'id':id,'durationMs':ms,'lane':lane,'scheduling':{'priority':0,'cost':10,'compiler':False,'resources':[],'after':[],'exclusive':False,**hints}}
class SchedulingTests(unittest.TestCase):
    def test_compiler_limit_is_whole_task_not_asc_phase(self):
        rows=[task('a',10,compiler=True),task('b',6,compiler=True),task('c',5)]
        self.assertEqual(simulate(rows)['wallMs'],16)
        self.assertEqual(simulate(rows,compilers=2)['wallMs'],11)
    def test_priority_is_completion_barrier(self):
        r=simulate([task('early',10,priority=2),task('late',100,cost=1000)])
        self.assertEqual(r['wallMs'],110)
        self.assertEqual(next(x for x in r['timeline'] if x['id']=='late')['startMs'],10)
    def test_dependencies_and_locks_survive_cost_order(self):
        rows=[task('after',3,cost=50,after=['first']),task('first',7,resources=['port']),task('same-port',5,resources=['port'])]
        r=simulate(rows);by={x['id']:x for x in r['timeline']}
        self.assertGreaterEqual(by['after']['startMs'],by['first']['endMs'])
        self.assertGreaterEqual(by['same-port']['startMs'],by['first']['endMs'])
    def test_exclusive_task_runs_alone(self):
        r=simulate([task('ordinary',7),task('exclusive',11,exclusive=True),task('other',3)])
        e=next(x for x in r['timeline'] if x['id']=='exclusive')
        self.assertTrue(all(x['endMs']<=e['startMs'] or x['startMs']>=e['endMs'] for x in r['timeline'] if x!=e))
    def test_mixed_tasks_are_never_split_or_duplicated(self):
        rows=[task('cross',20,lane='mixed'),task('fastly',10,lane='fastly'),task('node',5,lane='node')]
        r=simulate(rows,layout='host2');self.assertEqual(r['wallMs'],30)
        self.assertEqual(r['coverage']['unique'],3)
        self.assertEqual([x['worker'] for x in r['timeline'] if x['id']=='cross'],[1])
    def test_invalid_coverage_and_deadlock_fail(self):
        for rows in [[task('x',1),task('x',1)],[task('x',1,after=['missing'])],[task('x',1,after=['y']),task('y',1,after=['x'])]]:
            with self.assertRaises(AssertionError):simulate(rows)
if __name__=='__main__':unittest.main()
