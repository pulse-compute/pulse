#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

function tierFor(eventName, event, ref) {
  if (eventName === 'pull_request') {
    assert(event.pull_request?.base?.ref, 'Missing PR target branch');
    return event.pull_request.base.ref === 'main' ? 'full' : 'fast';
  }
  assert(['push', 'workflow_dispatch'].includes(eventName), `Unsupported validation event: ${eventName}`);
  assert(ref?.startsWith('refs/heads/'), 'Validation requires a branch ref');
  assert(!event.deleted, 'Deleted branches cannot be validated');
  return ref === 'refs/heads/main' ? 'full' : 'fast';
}

async function route({ github, context, core }) {
  const tier = tierFor(context.eventName, context.payload, context.ref);
  let run = true;
  // Never suppress a PR's merge-ref validation or a full main run. A push is
  // redundant only when an open PR already represents this exact head commit.
  if (context.eventName === 'push' && tier === 'fast') {
    try {
      const prs = await github.paginate(github.rest.pulls.list, {
        ...context.repo, state: 'open', head: `${context.repo.owner}:${context.ref.slice('refs/heads/'.length)}`, per_page: 100
      });
      run = !prs.some((pr) => pr.head.sha === context.sha &&
        pr.head.repo?.full_name === `${context.repo.owner}/${context.repo.repo}`);
    } catch (error) {
      core.warning(`Could not establish duplicate PR coverage; validating this push: ${error.message}`);
    }
  }
  core.setOutput('tier', tier);
  core.setOutput('run', String(run));
  core.info(`${tier} validation; ${run ? 'run' : 'push covered by exact-head PR merge validation'}`);
  return { tier, run };
}

function requireTier(eventName, event, ref, needs) {
  const expected = tierFor(eventName, event, ref);
  assert.equal(needs.route?.result, 'success', 'Validation routing did not succeed');
  assert.equal(needs.route.outputs?.tier, expected, 'Routed tier differs from event target');
  assert.equal(needs.route.outputs?.run, 'true', 'Required validation was suppressed');
  for (const job of ['maintenance', 'node-floor', ...(expected === 'fast' ? ['fast-selection', 'fast-portable'] : ['full-portable'])]) {
    assert.equal(needs[job]?.result, 'success', `Required ${expected} check did not succeed: ${job}`);
  }
  return expected;
}

function revisionRange(eventName, event, tested, git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim()) {
  assert(/^[a-f0-9]{40}$/.test(tested), 'Invalid tested SHA');
  assert.equal(git(['rev-parse', 'HEAD']), tested, 'Checkout differs from tested SHA');
  const parents = git(['rev-list', '--parents', '-n', '1', tested]).split(' ').slice(1);
  if (eventName === 'pull_request') {
    const { base, head } = event.pull_request;
    assert.deepEqual(parents, [base.sha, head.sha], 'Tested commit must merge the exact PR base and head');
    return { base: base.sha, head: head.sha, tested, mode: 'merge' };
  }
  assert(['push', 'workflow_dispatch'].includes(eventName), 'Unsupported revision event');
  const before = eventName === 'push' && event.before && !/^0+$/.test(event.before) ? event.before : parents[0];
  assert(/^[a-f0-9]{40}$/.test(before || ''), 'Branch validation requires a prior commit');
  return { base: before, head: tested, tested, mode: 'branch' };
}

function validateWorkflow(source, kind = 'validation') {
  assert(source.includes("branches: ['**']"), 'Validation must cover every branch push');
  assert(source.includes('types: [opened, synchronize, reopened, edited, ready_for_review]'), 'Retargeted PRs must revalidate');
  assert(!/^\s+paths(?:-ignore)?:/m.test(source), 'Required checks must not filter paths');
  assert(source.includes("require('./scripts/maintainer-validation-routing.cjs').route({ github, context, core })"), 'Workflow must share event routing');
  if (kind !== 'validation') return;
  assert(source.includes("needs: [route, maintenance, node-floor, fast-selection, fast-portable, full-portable]"), 'Portable gate must wait for both tiers and common checks');
  assert(source.includes("if: always() && (github.event_name != 'push' || github.ref == 'refs/heads/main' || needs.route.outputs.run != 'false')"), 'Required gate must evaluate failures, including routing failures');
  assert(source.includes('VALIDATION_NEEDS: ${{ toJSON(needs) }}'), 'Gate requires actual job conclusions');
  assert(source.includes('node scripts/maintainer-validation-routing.cjs gate'), 'Missing event-aware required gate');
  for (const [job, tier] of [['fast-selection', 'fast'], ['portable-shards', 'full']]) {
    const block = source.split(`\n  ${job}:\n`)[1]?.split(/\n  [a-z-]+:\n/)[0];
    assert(block?.includes(`needs.route.outputs.tier == '${tier}'`), `Wrong route for ${job}`);
  }
}

module.exports = { tierFor, route, requireTier, revisionRange, validateWorkflow };
if (require.main === module) {
  try {
    const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    if (process.argv[2] === 'gate') {
      const tier = requireTier(process.env.GITHUB_EVENT_NAME, event, process.env.GITHUB_REF, JSON.parse(process.env.VALIDATION_NEEDS));
      console.log(`Required ${tier} validation completed at ${process.env.GITHUB_SHA}`);
    } else throw new Error('Usage: maintainer-validation-routing.cjs gate');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
