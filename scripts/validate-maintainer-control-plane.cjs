#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  MAINTENANCE_POLICY,
  BOUNDARY_BY_ID,
  matchesPattern,
  synchronizeMaintenancePolicy
} = require('./maintenance-policy.cjs');
const {
  collectInputs,
  parseDeclaration,
  reportForInputs
} = require('./maintainer-scope.cjs');
const { RELEASE_VERSION } = require('./package-support.cjs');
const { validatePublicationControlPlane } = require('./validate-publication-workflows.cjs');

const CONTROL_PLANE_SCHEMA = 'pulse.maintainer-control-plane-validation.v1';
const repoRoot = path.resolve(__dirname, '..');

function fail(message) {
  const error = new Error(message);
  error.code = 'PULSE_MAINTAINER_CONTROL_PLANE_INVALID';
  throw error;
}

function slash(value) { return String(value).replace(/\\/g, '/'); }
function read(relativeFile) { return fs.readFileSync(path.join(repoRoot, relativeFile), 'utf8'); }
function exists(relativeFile) { return fs.existsSync(path.join(repoRoot, relativeFile)); }
function stableJson(value) { return `${JSON.stringify(value, null, 2)}\n`; }

function filesUnder(root, predicate = () => true, out = []) {
  if (!fs.existsSync(root)) return out;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.pulse-docs-site' || entry.name === '.pulse-publication' || entry.name === '.pulse-documentation-deployment') continue;
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) filesUnder(file, predicate, out);
    else if (entry.isFile() && predicate(file)) out.push(file);
  }
  return out;
}

function requireFiles(relativeFiles, context) {
  for (const relativeFile of relativeFiles) if (!exists(relativeFile)) fail(`${context} is missing ${relativeFile}`);
}

function includes(source, needle, context) {
  if (!source.includes(needle)) fail(`${context} is missing ${needle}`);
}

function count(source, needle) {
  return String(source).split(needle).length - 1;
}

function entryPointSections(source, context) {
  const marker = '## Pulse entry points';
  const start = source.indexOf(marker);
  if (start < 0) fail(`${context} is missing ${marker}`);
  const bodyStart = start + marker.length;
  const nextSection = source.indexOf('\n## ', bodyStart);
  const block = source.slice(bodyStart, nextSection < 0 ? source.length : nextSection);
  const headings = [...block.matchAll(/^### ([a-z][a-z0-9-]+)\s*$/gm)];
  if (headings.length === 0) fail(`${context} defines no Entry Points`);
  const names = headings.map((match) => match[1]);
  if (new Set(names).size !== names.length) fail(`${context} defines duplicate Entry Point names`);
  const requiredLanes = ['**Use for**', '**Contracts**', '**Write**', '**Read**', '**Evidence**', '**Supplements**', '**Exclude**'];
  for (let index = 0; index < headings.length; index += 1) {
    const section = block.slice(headings[index].index, headings[index + 1]?.index || block.length);
    let previous = -1;
    for (const lane of requiredLanes) {
      const position = section.indexOf(lane);
      if (position < 0) fail(`${context} Entry Point ${names[index]} is missing ${lane}`);
      if (position <= previous) fail(`${context} Entry Point ${names[index]} has lanes out of order at ${lane}`);
      previous = position;
    }
    const derived = section.indexOf('**Derived**');
    if (derived >= 0 && (derived <= section.indexOf('**Write**') || derived >= section.indexOf('**Read**'))) {
      fail(`${context} Entry Point ${names[index]} must place Derived between Write and Read`);
    }
  }
  return Object.freeze(names);
}

function validatePolicyAndGeneratedOutputs() {
  if (MAINTENANCE_POLICY.releaseVersion !== RELEASE_VERSION) fail('maintenance policy release does not match the release manifest');
  const synchronization = synchronizeMaintenancePolicy({ repoRoot, write: false });
  const generatedCopy = JSON.parse(read('docs/maintainers/maintenance-policy.json'));
  if (JSON.stringify(generatedCopy) !== JSON.stringify(MAINTENANCE_POLICY)) fail('generated maintenance-policy JSON does not match its release owner');
  if (MAINTENANCE_POLICY.maintainerModel.agentMayMerge || MAINTENANCE_POLICY.maintainerModel.agentMayPublish || MAINTENANCE_POLICY.maintainerModel.agentMayChangeRepositorySettings || MAINTENANCE_POLICY.maintainerModel.agentMayApproveProtectedBoundaryChanges) {
    fail('resident maintainer has forbidden authority');
  }
  return Object.freeze({
    policyVersion: MAINTENANCE_POLICY.policyVersion,
    changeClasses: Object.keys(MAINTENANCE_POLICY.changeClasses).length,
    scopeStates: Object.keys(MAINTENANCE_POLICY.scopeStates).length,
    boundaries: MAINTENANCE_POLICY.protectedBoundaries.length,
    pathRules: MAINTENANCE_POLICY.pathRules.length,
    checks: Object.keys(MAINTENANCE_POLICY.checks).length,
    labels: MAINTENANCE_POLICY.labels.length,
    actionPins: Object.keys(MAINTENANCE_POLICY.github.actionPins).length,
    codexEnvironment: MAINTENANCE_POLICY.github.codexEnvironment,
    protectedEnvironments: Object.keys(MAINTENANCE_POLICY.github.protectedEnvironments).length,
    generatedFiles: synchronization.expectedFiles
  });
}

function ancestorAgentFiles(relativeAgent) {
  const directory = path.posix.dirname(slash(relativeAgent));
  const parts = directory === '.' ? [] : directory.split('/');
  const candidates = ['AGENTS.md'];
  let current = '';
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    candidates.push(`${current}/AGENTS.md`);
  }
  return candidates.filter((entry, index, all) => all.indexOf(entry) === index && exists(entry));
}

function validateAgentInstructions() {
  const required = [
    'AGENTS.md',
    'docs/AGENTS.md',
    'wasm/AGENTS.md',
    'wasm/packages/compiler/AGENTS.md',
    'wasm/packages/cli/AGENTS.md',
    'packages/AGENTS.md',
    'packages/provider-fastly/AGENTS.md',
    '.github/AGENTS.md',
    'release/AGENTS.md'
  ];
  requireFiles(required, 'AGENTS hierarchy');
  const root = read('AGENTS.md');
  for (const marker of [
    'Never add a silent JavaScript fallback',
    'Keep host authority outside the guest',
    'A human retains architecture, merge, repository-setting, and release authority',
    'release/maintenance-policy.json',
    'npm run maintainer:check'
  ]) includes(root, marker, 'root AGENTS.md');
  includes(root, 'A `Derived` section classifies generated outputs', 'root AGENTS.md');

  const expectedRootEntryPoints = Object.freeze([
    'runtime-effects',
    'schema-codecs',
    'package-lowering'
  ]);
  const rootEntryPoints = entryPointSections(root, 'root AGENTS.md');
  if (JSON.stringify(rootEntryPoints) !== JSON.stringify(expectedRootEntryPoints)) {
    fail(`root AGENTS.md Entry Points are ${rootEntryPoints.join(', ')}, expected ${expectedRootEntryPoints.join(', ')}`);
  }
  const expectedNestedEntryPoints = Object.freeze({
    'packages/AGENTS.md': Object.freeze(['package-surface']),
    'wasm/packages/cli/AGENTS.md': Object.freeze(['project-workflow']),
    'docs/AGENTS.md': Object.freeze(['documentation-current']),
    'release/AGENTS.md': Object.freeze(['release-readiness', 'documentation-release', 'release-seal']),
    'packages/provider-fastly/AGENTS.md': Object.freeze(['provider-fastly'])
  });
  const nestedEntryPoints = {};
  for (const [file, expected] of Object.entries(expectedNestedEntryPoints)) {
    const actual = entryPointSections(read(file), file);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      fail(`${file} Entry Points are ${actual.join(', ')}, expected ${expected.join(', ')}`);
    }
    nestedEntryPoints[file] = actual;
  }
  const allEntryPoints = [...rootEntryPoints, ...Object.values(nestedEntryPoints).flat()];
  if (new Set(allEntryPoints).size !== allEntryPoints.length) fail('Entry Point names must be unique across the AGENTS hierarchy');
  if (allEntryPoints.includes('sprint-seal')) fail('sprint-seal must remain renamed to release-seal');

  const allAgents = filesUnder(repoRoot, (file) => path.basename(file) === 'AGENTS.md').map((file) => slash(path.relative(repoRoot, file))).sort();
  if (allAgents.length !== required.length) fail(`expected ${required.length} AGENTS.md files, found ${allAgents.length}`);
  let largestChain = 0;
  let largestChainFor = '';
  for (const agent of allAgents) {
    const chain = ancestorAgentFiles(agent);
    const bytes = chain.reduce((sum, entry) => sum + Buffer.byteLength(read(entry)), 0);
    if (bytes > largestChain) {
      largestChain = bytes;
      largestChainFor = agent;
    }
    if (bytes > 32 * 1024) fail(`combined AGENTS.md chain for ${agent} is ${bytes} bytes, above the 32 KiB Codex default limit`);
  }
  for (const nested of required.filter((entry) => entry !== 'AGENTS.md')) {
    const source = read(nested);
    if (/Codex\s+(?:may|can)\s+(?:merge|publish|approve)/i.test(source)) fail(`${nested} grants forbidden authority`);
  }
  return Object.freeze({
    files: allAgents.length,
    rootEntryPoints,
    nestedEntryPoints: Object.freeze(nestedEntryPoints),
    largestCombinedBytes: largestChain,
    largestChainFor
  });
}

function workflowFiles() {
  return filesUnder(path.join(repoRoot, '.github', 'workflows'), (file) => file.endsWith('.yml') || file.endsWith('.yaml')).map((file) => slash(path.relative(repoRoot, file))).sort();
}

function validateWorkflowSecurity() {
  const required = [
    '.github/workflows/maintainer-scope.yml',
    '.github/workflows/validate.yml',
    '.github/workflows/codex-maintainer-review.yml',
    '.github/workflows/maintainer-labels.yml',
    '.github/workflows/documentation.yml',
    '.github/workflows/npm-publish.yml',
    '.github/workflows/documentation-deploy.yml'
  ];
  requireFiles(required, 'GitHub workflow set');
  const workflows = workflowFiles();
  const reviewedPins = MAINTENANCE_POLICY.github.actionPins;
  const usedPins = new Set();
  for (const file of workflows) {
    const source = read(file);
    if (/\bpull_request_target\s*:/u.test(source)) fail(`${file} must not use pull_request_target`);
    if (/\bissue_comment\s*:/u.test(source)) fail(`${file} must not expose privileged maintenance through issue_comment`);
    for (const match of source.matchAll(/^\s*uses:\s*([^\s#]+)(?:\s+#\s*(\S.*))?\s*$/gm)) {
      const specification = match[1];
      const comment = (match[2] || '').trim();
      if (specification.startsWith('./')) continue;
      const separator = specification.lastIndexOf('@');
      if (separator <= 0) fail(`${file} action ${specification} must use an explicit commit SHA`);
      const action = specification.slice(0, separator);
      const ref = specification.slice(separator + 1);
      const pin = reviewedPins[action];
      if (!pin) fail(`${file} uses unreviewed external action ${action}`);
      if (ref !== pin.sha) fail(`${file} action ${action} must be pinned to ${pin.sha}, found ${ref}`);
      if (comment !== pin.version) fail(`${file} action ${action}@${ref} must retain reviewed version comment # ${pin.version}`);
      usedPins.add(action);
    }
  }
  for (const action of Object.keys(reviewedPins)) if (!usedPins.has(action)) fail(`reviewed GitHub Action pin ${action} is stale because no workflow uses it`);

  const scope = read('.github/workflows/maintainer-scope.yml');
  includes(scope, 'name: Maintainer scope', 'maintainer scope workflow');
  includes(scope, 'name: scope', 'maintainer scope job');
  includes(scope, 'git archive "$BASE" | tar -x -C .pulse-maintainer-trusted', 'maintainer scope workflow');
  includes(scope, 'node .pulse-maintainer-trusted/scripts/maintainer-scope.cjs', 'maintainer scope workflow');
  includes(scope, '--event .pulse-maintainer-input/event.json', 'maintainer scope workflow');
  includes(scope, '--changed-files0-file .pulse-maintainer-input/changed-files.z', 'maintainer scope workflow');
  includes(scope, 'process.env.GITHUB_EVENT_PATH', 'maintainer scope workflow');
  if (scope.includes('node scripts/maintainer-scope.cjs')) fail('required scope workflow must execute the classifier from the trusted base archive');
  if (/pull_request:[\s\S]{0,300}\n\s+paths:/u.test(scope)) fail('required maintainer scope check must not use pull-request path filtering');

  const validation = read('.github/workflows/validate.yml');
  includes(validation, 'name: Repository validation', 'repository validation workflow');
  includes(validation, 'name: maintenance', 'repository validation workflow');
  includes(validation, 'name: portable', 'repository validation workflow');
  includes(validation, 'npm run maintainer:check', 'repository validation workflow');
  includes(validation, "publication.pnpmVersion", 'repository validation workflow');
  includes(validation, 'corepack prepare "pnpm@$pnpm_version" --activate', 'repository validation workflow');
  includes(validation, 'pnpm install --frozen-lockfile --ignore-scripts', 'repository validation workflow');
  includes(validation, 'pnpm run build', 'repository validation workflow');
  for (const profile of ['unit', 'native', 'javascript', 'conformance']) {
    includes(validation, `--profile ${profile} --report .test-results/${profile}.json`, 'repository validation workflow');
  }
  includes(validation, 'Upload Node 22 failure evidence', 'repository validation workflow');
  includes(validation, 'Upload portable failure evidence', 'repository validation workflow');
  includes(validation, 'path: wasm/.test-results', 'repository validation workflow');
  includes(validation, 'include-hidden-files: true', 'repository validation workflow');
  if (/pull_request:[\s\S]{0,300}\n\s+paths:/u.test(validation)) fail('required repository validation must not use pull-request path filtering');

  const documentation = read('.github/workflows/documentation.yml');
  includes(documentation, 'name: Documentation', 'documentation workflow');
  includes(documentation, 'build:', 'documentation workflow');
  includes(documentation, 'Upload generated preview', 'documentation workflow');
  includes(documentation, 'documentation-deployment.cjs seal', 'documentation workflow');
  if (documentation.includes('deploy-pages') || documentation.includes('upload-pages-artifact') || documentation.includes('pages: write') || documentation.includes('github-pages')) fail('documentation validation workflow must not deploy to GitHub Pages');

  const npmPublication = read('.github/workflows/npm-publish.yml');
  includes(npmPublication, 'name: npm publication', 'npm publication workflow');
  includes(npmPublication, `environment: ${MAINTENANCE_POLICY.github.protectedEnvironments['npm-publish'] ? 'npm-publish' : '__missing__'}`, 'npm publication workflow');
  includes(npmPublication, 'id-token: write', 'npm publication workflow');
  includes(npmPublication, 'publish-release.cjs publish', 'npm publication workflow');
  if (npmPublication.includes('NODE_AUTH_TOKEN') || npmPublication.includes('NPM_TOKEN')) fail('npm publication workflow must not use a long-lived registry token');

  const documentationDeployment = read('.github/workflows/documentation-deploy.yml');
  includes(documentationDeployment, 'name: Documentation deployment', 'documentation deployment workflow');
  includes(documentationDeployment, `environment: ${MAINTENANCE_POLICY.github.protectedEnvironments['documentation-production'] ? 'documentation-production' : '__missing__'}`, 'documentation deployment workflow');
  includes(documentationDeployment, '--phase immutable', 'documentation deployment workflow');
  includes(documentationDeployment, '--phase promote', 'documentation deployment workflow');
  includes(documentationDeployment, 'documentation-deployment.cjs verify-public', 'documentation deployment workflow');
  if (documentationDeployment.includes('--delete') || documentationDeployment.includes('delete-object')) fail('documentation deployment workflow must never delete Object Storage history');

  const codex = read('.github/workflows/codex-maintainer-review.yml');
  includes(codex, 'name: Codex maintainer review', 'Codex workflow');
  includes(codex, 'workflow_dispatch:', 'Codex workflow');
  if (/^  pull_request:\s*$/mu.test(codex) || /^  push:\s*$/mu.test(codex) || /^  schedule:\s*$/mu.test(codex)) fail('Codex policy workflow must remain manually dispatched');
  includes(codex, 'if: github.ref_name == github.event.repository.default_branch', 'Codex workflow');
  includes(codex, `environment: ${MAINTENANCE_POLICY.github.codexEnvironment}`, 'Codex workflow');
  includes(codex, `uses: openai/codex-action@${reviewedPins['openai/codex-action'].sha} # ${reviewedPins['openai/codex-action'].version}`, 'Codex workflow');
  includes(codex, "permission-profile: ':read-only'", 'Codex workflow');
  includes(codex, 'safety-strategy: drop-sudo', 'Codex workflow');
  includes(codex, 'persist-credentials: false', 'Codex workflow');
  includes(codex, 'git clone --quiet --no-checkout --no-hardlinks . .pulse-maintainer-trusted', 'Codex workflow');
  includes(codex, 'git -C .pulse-maintainer-trusted checkout --quiet --detach "$BASE"', 'Codex workflow');
  includes(codex, 'refs/pulse-review/base', 'Codex workflow');
  includes(codex, 'refs/pulse-review/head', 'Codex workflow');
  includes(codex, 'git -C .pulse-maintainer-trusted remote remove origin', 'Codex workflow');
  includes(codex, "find . -mindepth 1 -maxdepth 1 ! -name '.pulse-maintainer-trusted' -exec rm -rf -- {} +", 'Codex workflow');
  includes(codex, 'working-directory: .pulse-maintainer-trusted', 'Codex workflow');
  includes(codex, '--changed-files0-file .pulse-maintainer-review/changed-files.z', 'Codex workflow');
  includes(codex, 'prompt-file: .pulse-maintainer-trusted/.github/codex/prompts/pull-request-review.md', 'Codex workflow');
  includes(codex, 'output-schema-file: .pulse-maintainer-trusted/.github/codex/schemas/maintainer-review.schema.json', 'Codex workflow');
  if (codex.includes('sandbox:') || codex.includes('git archive "$BASE" | tar -x -C .pulse-maintainer-trusted')) fail('Codex workflow must use a nested trusted Git checkout and the read-only permission profile');
  includes(codex, `secrets.${MAINTENANCE_POLICY.github.openAiSecret}`, 'Codex workflow');
  includes(codex, 'outputs.final-message', 'Codex workflow');
  includes(codex, 'post structured review', 'Codex workflow');
  const codexActionAt = codex.indexOf(`uses: openai/codex-action@${reviewedPins['openai/codex-action'].sha}`);
  const postJobAt = codex.indexOf('\n  post:');
  if (codexActionAt < 0 || postJobAt < codexActionAt) fail('Codex workflow must separate the review and posting jobs');
  const reviewTail = codex.slice(codexActionAt, postJobAt);
  if (/\n\s{6}-\s+(?:name:|uses:|run:)/u.test(reviewTail.slice(reviewTail.indexOf('\n') + 1))) fail('Codex action must be the last step in the privileged review job');
  const postJob = codex.slice(postJobAt);
  if (postJob.includes('openai/codex-action') || postJob.includes(`secrets.${MAINTENANCE_POLICY.github.openAiSecret}`) || postJob.includes('actions/checkout')) fail('posting job must not run Codex, receive the OpenAI secret, or check out pull-request code');
  includes(postJob, 'issues: write', 'Codex posting job');
  includes(postJob, 'pull-requests: write', 'Codex posting job');

  const labels = read('.github/workflows/maintainer-labels.yml');
  includes(labels, 'workflow_dispatch:', 'maintainer labels workflow');
  includes(labels, 'if: github.ref_name == github.event.repository.default_branch', 'maintainer labels workflow');
  includes(labels, 'issues: write', 'maintainer labels workflow');
  includes(labels, 'release/maintenance-policy.json', 'maintainer labels workflow');

  const secretOccurrences = workflows.filter((file) => read(file).includes(`secrets.${MAINTENANCE_POLICY.github.openAiSecret}`));
  if (secretOccurrences.length !== 1 || secretOccurrences[0] !== '.github/workflows/codex-maintainer-review.yml') fail(`${MAINTENANCE_POLICY.github.openAiSecret} must appear only in the manual Codex workflow`);

  const requiredChecks = new Set(MAINTENANCE_POLICY.github.requiredStatusChecks);
  for (const expected of [
    'Maintainer scope / scope',
    'Repository validation / maintenance',
    'Repository validation / portable',
    'Documentation / build'
  ]) if (!requiredChecks.has(expected)) fail(`maintenance policy is missing required status check ${expected}`);

  return Object.freeze({
    files: workflows.length,
    requiredStatusChecks: requiredChecks.size,
    actionPins: usedPins.size,
    codexTrigger: 'workflow_dispatch',
    codexEnvironment: MAINTENANCE_POLICY.github.codexEnvironment,
    protectedEnvironments: Object.keys(MAINTENANCE_POLICY.github.protectedEnvironments).length,
    codexPermissionProfile: ':read-only',
    trustedBasePolicy: true,
    trustedBaseWorkingTree: true
  });
}

function extractIssueLabels(source) {
  const match = /^labels:\s*\n([\s\S]*?)(?=^body:\s*$)/m.exec(source);
  if (!match) return [];
  return [...match[1].matchAll(/^\s+-\s+([^#\n]+?)\s*$/gm)].map((entry) => entry[1].trim().replace(/^['"]|['"]$/g, ''));
}

function validateCommunityFiles() {
  const required = [
    '.github/PULL_REQUEST_TEMPLATE.md',
    '.github/ISSUE_TEMPLATE/config.yml',
    '.github/ISSUE_TEMPLATE/bug.yml',
    '.github/ISSUE_TEMPLATE/documentation.yml',
    '.github/ISSUE_TEMPLATE/scope-proposal.yml',
    '.github/ISSUE_TEMPLATE/support.yml',
    'CONTRIBUTING.md',
    'SUPPORT.md',
    'SECURITY.md'
  ];
  requireFiles(required, 'community files');

  const template = read('.github/PULL_REQUEST_TEMPLATE.md');
  const declaration = MAINTENANCE_POLICY.pullRequestDeclaration;
  if (count(template, declaration.startMarker) !== 1 || count(template, declaration.endMarker) !== 1) fail('pull-request template must contain exactly one maintainer declaration');
  for (const field of Object.keys(declaration.fields)) includes(template, `${field}:`, 'pull-request template');
  includes(template, 'npm run maintainer:check', 'pull-request template');

  const knownLabels = new Set(MAINTENANCE_POLICY.labels.map((entry) => entry.name));
  for (const [form, contract] of Object.entries(MAINTENANCE_POLICY.issueForms)) {
    const relativeFile = `.github/ISSUE_TEMPLATE/${form}`;
    const source = read(relativeFile);
    const labels = extractIssueLabels(source);
    if (JSON.stringify(labels) !== JSON.stringify(contract.labels)) fail(`${relativeFile} labels do not match release/maintenance-policy.json`);
    for (const label of labels) if (!knownLabels.has(label)) fail(`${relativeFile} references unknown label ${label}`);
    includes(source, 'validations:', relativeFile);
  }
  const config = read('.github/ISSUE_TEMPLATE/config.yml');
  includes(config, 'blank_issues_enabled: false', 'issue chooser');
  includes(config, '/security/advisories/new', 'issue chooser');
  includes(read('SECURITY.md'), '/security/advisories/new', 'security policy');
  return Object.freeze({ files: required.length, issueForms: Object.keys(MAINTENANCE_POLICY.issueForms).length, labels: knownLabels.size });
}

function allRepositoryFiles() {
  return filesUnder(repoRoot).map((file) => slash(path.relative(repoRoot, file))).sort();
}

function validatePathRules() {
  const files = allRepositoryFiles();
  let patterns = 0;
  const unmatchedPatterns = [];
  for (const rule of MAINTENANCE_POLICY.pathRules) {
    let ruleMatches = 0;
    for (const pattern of rule.patterns) {
      patterns += 1;
      const matches = files.filter((file) => matchesPattern(file, pattern));
      ruleMatches += matches.length;
      if (matches.length === 0) unmatchedPatterns.push(`${rule.id}:${pattern}`);
    }
    if (ruleMatches === 0) fail(`path rule ${rule.id} does not match any repository file`);
  }
  if (unmatchedPatterns.length) fail(`maintenance path patterns are stale: ${unmatchedPatterns.join(', ')}`);
  for (const boundary of MAINTENANCE_POLICY.protectedBoundaries) if (!BOUNDARY_BY_ID[boundary.id]) fail(`boundary lookup is missing ${boundary.id}`);
  return Object.freeze({ repositoryFiles: files.length, rules: MAINTENANCE_POLICY.pathRules.length, patterns });
}

function declaration(changeClass, scope, boundaries, decision) {
  return [
    MAINTENANCE_POLICY.pullRequestDeclaration.startMarker,
    `Change class: ${changeClass}`,
    `Scope: ${scope}`,
    `Protected boundaries: ${boundaries.length ? boundaries.join(', ') : 'none'}`,
    `Human decision: ${decision}`,
    MAINTENANCE_POLICY.pullRequestDeclaration.endMarker
  ].join('\n');
}

function scopeReport(files, body) {
  return reportForInputs({
    pullRequestNumber: 89,
    base: 'base',
    head: 'head',
    body,
    files
  }, {});
}

function validateScopeClassifier() {
  const cases = [
    {
      name: 'documentation pass',
      files: ['docs/getting-started.md'],
      body: declaration('documentation', 'inside-developer-preview', [], 'not-required'),
      expected: 'pass'
    },
    {
      name: 'protected defect pass',
      files: ['API.md'],
      body: declaration('defect', 'inside-developer-preview', ['public-authoring-api'], 'not-required'),
      expected: 'pass'
    },
    {
      name: 'missing boundary fail',
      files: ['API.md'],
      body: declaration('defect', 'inside-developer-preview', [], 'not-required'),
      expected: 'fail'
    },
    {
      name: 'architecture decision exposed',
      files: ['release/maintenance-policy.json'],
      body: declaration('architecture', 'architecture-change', ['maintenance-control-plane'], 'required'),
      expected: 'decision-required'
    },
    {
      name: 'scope decision exposed',
      files: ['docs/preview-scope.md'],
      body: declaration('scope-expansion', 'scope-expansion', [], 'required'),
      expected: 'decision-required'
    },
    {
      name: 'unclassified path exposed',
      files: ['new-unclassified-surface.xyz'],
      body: declaration('hardening', 'inside-developer-preview', [], 'required'),
      expected: 'decision-required'
    }
  ];
  for (const test of cases) {
    const parsed = parseDeclaration(test.body);
    if (parsed.errors.length) fail(`synthetic declaration ${test.name} is invalid: ${parsed.errors.join(', ')}`);
    const report = scopeReport(test.files, test.body);
    if (report.status !== test.expected) fail(`scope classifier ${test.name} expected ${test.expected}, found ${report.status}: ${report.consistency.errors.join(', ')}`);
  }

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-maintainer-scope-'));
  try {
    const eventFile = path.join(temp, 'event.json');
    const changedFile = path.join(temp, 'changed.z');
    fs.writeFileSync(eventFile, stableJson({
      action: 'synchronize',
      pull_request: {
        number: 89,
        body: declaration('documentation', 'inside-developer-preview', [], 'not-required'),
        base: { sha: 'a'.repeat(40) },
        head: { sha: 'b'.repeat(40) }
      }
    }));
    fs.writeFileSync(changedFile, Buffer.from('docs/getting-started.md\0'));
    const inputs = collectInputs({ eventFile, changedFiles0File: changedFile }, temp);
    if (inputs.base !== 'a'.repeat(40) || inputs.head !== 'b'.repeat(40) || JSON.stringify(inputs.files) !== JSON.stringify(['docs/getting-started.md'])) {
      fail('explicit changed-file input did not preserve trusted range metadata');
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
  return Object.freeze({ cases: cases.length, trustedChangedFileInput: true });
}

function validateDocumentationAndArchitecture() {
  const publicDocs = [
    'docs/maintainers/README.md',
    'docs/maintainers/maintainer-charter.md',
    'docs/maintainers/scope-policy.md',
    'docs/maintainers/codex-maintainer.md',
    'docs/maintainers/repository-setup.md',
    'docs/maintainers/support-and-triage.md',
    'docs/maintainers/maintenance-policy.md',
    'docs/maintainers/maintenance-policy.json',
    'docs/architecture/current-contracts.md',
    'docs/maintainers/npm-publishing.md',
    'docs/maintainers/documentation-deployment.md'
  ];
  requireFiles(publicDocs, 'maintainer documentation');
  const combined = publicDocs.filter((file) => file.endsWith('.md')).map(read).join('\n');
  for (const marker of [
    'human architecture',
    'merge',
    'release authority',
    'read-only',
    'release/maintenance-policy.json',
    'Maintainer scope / scope'
  ]) if (!combined.toLowerCase().includes(marker.toLowerCase())) fail(`Maintainer documentation does not explain ${marker}`);
  const currentContracts = read('docs/architecture/current-contracts.md');
  includes(currentContracts, 'Human CODEOWNERS retain', 'current architecture contracts');
  includes(currentContracts, 'deterministic checks', 'current architecture contracts');
  includes(currentContracts, 'current contract update', 'current architecture contracts');
  const setup = read('docs/maintainers/repository-setup.md');
  for (const check of MAINTENANCE_POLICY.github.requiredStatusChecks) includes(setup, check, 'repository setup');
  for (const owner of MAINTENANCE_POLICY.github.codeOwners) includes(setup, owner.replace(/^@/, ''), 'repository setup');
  includes(setup, MAINTENANCE_POLICY.github.openAiSecret, 'repository setup');
  includes(setup, MAINTENANCE_POLICY.github.codexEnvironment, 'repository setup');
  for (const environment of Object.keys(MAINTENANCE_POLICY.github.protectedEnvironments)) includes(setup, environment, 'repository setup');
  includes(setup, 'full commit SHA', 'repository setup');
  return Object.freeze({ publicPages: publicDocs.length });
}

function validatePackageScripts() {
  const manifest = JSON.parse(read('package.json'));
  const expected = {
    'maintainer:sync': 'node scripts/maintenance-policy.cjs --write',
    'maintainer:check': 'node scripts/validate-maintainer-control-plane.cjs',
    'maintainer:scope': 'node scripts/maintainer-scope.cjs',
    'publication:check': 'node scripts/validate-publication-workflows.cjs'
  };
  for (const [name, command] of Object.entries(expected)) if (!manifest.scripts || manifest.scripts[name] !== command) fail(`package.json script ${name} must be ${command}`);
  return Object.freeze({ scripts: Object.keys(expected).length });
}

function validateMaintainerControlPlane(options = {}) {
  const started = Date.now();
  const result = Object.freeze({
    schemaVersion: CONTROL_PLANE_SCHEMA,
    status: 'ok',
    releaseVersion: RELEASE_VERSION,
    policy: validatePolicyAndGeneratedOutputs(),
    agents: validateAgentInstructions(),
    workflows: validateWorkflowSecurity(),
    community: validateCommunityFiles(),
    pathRules: validatePathRules(),
    scopeClassifier: validateScopeClassifier(),
    documentation: validateDocumentationAndArchitecture(),
    packageScripts: validatePackageScripts(),
    publication: validatePublicationControlPlane(),
    elapsedMs: Date.now() - started
  });
  if (options.jsonFile) {
    const target = path.resolve(options.jsonFile);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, stableJson(result));
  }
  return result;
}

function main() {
  const args = process.argv.slice(2);
  let jsonFile;
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--json') { json = true; continue; }
    if (token === '--json-out') { jsonFile = args[++index]; if (!jsonFile) fail('--json-out requires a file'); continue; }
    if (token.startsWith('--json-out=')) { jsonFile = token.slice(11); continue; }
    fail(`unknown option ${token}`);
  }
  const result = validateMaintainerControlPlane({ jsonFile });
  if (json) process.stdout.write(stableJson(result));
  else process.stdout.write(`ok - ${result.policy.changeClasses} change classes, ${result.policy.boundaries} protected boundaries, ${result.agents.files} AGENTS files, ${result.workflows.files} workflows, ${result.publication.documentationDeployment.objectCount} documentation deployment objects, and ${result.scopeClassifier.cases} scope cases validated\n`);
}

module.exports = Object.freeze({
  CONTROL_PLANE_SCHEMA,
  validateMaintainerControlPlane,
  validatePolicyAndGeneratedOutputs,
  validateAgentInstructions,
  validateWorkflowSecurity,
  validateCommunityFiles,
  validatePathRules,
  validateScopeClassifier,
  validateDocumentationAndArchitecture
});

if (require.main === module) {
  try { main(); }
  catch (error) {
    process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  }
}
