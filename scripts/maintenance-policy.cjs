#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { RELEASE_VERSION } = require('./package-support.cjs');

const MAINTENANCE_POLICY_SCHEMA = 'pulse.maintenance-policy.v2';
const MAINTAINER_REVIEW_SCHEMA = 'pulse.maintainer-review.v1';
const MAINTENANCE_POLICY_FILE = path.resolve(__dirname, '..', 'release', 'maintenance-policy.json');
const RISK_ORDER = Object.freeze(['low', 'medium', 'high', 'critical']);

function fail(message) {
  const error = new Error(message);
  error.code = 'PULSE_MAINTENANCE_POLICY_INVALID';
  throw error;
}

function slash(value) { return String(value).replace(/\\/g, '/'); }
function stable(value) { return `${String(value).replace(/\r\n/g, '\n').replace(/\s+$/u, '')}\n`; }
function stableJson(value) { return `${JSON.stringify(value, null, 2)}\n`; }

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function nonEmpty(value, context) {
  if (typeof value !== 'string' || !value.trim()) fail(`${context} must be a non-empty string`);
  return value.trim();
}

function stringArray(value, context, options = {}) {
  if (!Array.isArray(value) || (!options.allowEmpty && value.length === 0)) fail(`${context} must be ${options.allowEmpty ? 'an' : 'a non-empty'} array`);
  const entries = value.map((entry, index) => nonEmpty(entry, `${context}[${index}]`));
  if (new Set(entries).size !== entries.length) fail(`${context} contains duplicate values`);
  return entries;
}

function globToRegExp(pattern) {
  const input = slash(nonEmpty(pattern, 'path pattern'));
  if (input.startsWith('/') || input.includes('../') || input === '..' || input.includes('\0')) fail(`invalid repository-relative pattern ${pattern}`);
  let output = '^';
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === '*') {
      if (input[index + 1] === '*') {
        index += 1;
        if (input[index + 1] === '/') {
          index += 1;
          output += '(?:.*/)?';
        } else {
          output += '.*';
        }
      } else {
        output += '[^/]*';
      }
      continue;
    }
    if (character === '?') {
      output += '[^/]';
      continue;
    }
    if ('\\.^$+{}()|[]'.includes(character)) output += `\\${character}`;
    else output += character;
  }
  output += '$';
  return new RegExp(output);
}

function validateMaintenancePolicy(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('maintenance policy must be an object');
  if (value.schemaVersion !== MAINTENANCE_POLICY_SCHEMA) fail(`unsupported maintenance policy schema ${value.schemaVersion}`);
  if (value.releaseVersion !== RELEASE_VERSION) fail(`maintenance policy release ${value.releaseVersion} does not match ${RELEASE_VERSION}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nonEmpty(value.reviewedAt, 'reviewedAt'))) fail('reviewedAt must use YYYY-MM-DD');
  if (!Number.isInteger(value.policyVersion) || value.policyVersion < 1) fail('policyVersion must be a positive integer');

  const model = value.maintainerModel;
  if (!model || typeof model !== 'object') fail('maintainerModel is required');
  for (const field of ['residentMaintainer', 'architectureAuthority', 'mergeAuthority', 'releaseAuthority', 'defaultAgentMode']) nonEmpty(model[field], `maintainerModel.${field}`);
  for (const field of ['agentMayMerge', 'agentMayPublish', 'agentMayChangeRepositorySettings', 'agentMayApproveProtectedBoundaryChanges']) {
    if (typeof model[field] !== 'boolean') fail(`maintainerModel.${field} must be boolean`);
  }
  if (model.agentMayMerge || model.agentMayPublish || model.agentMayChangeRepositorySettings || model.agentMayApproveProtectedBoundaryChanges) {
    fail('the resident maintainer must not receive merge, publication, repository-setting, or architecture-approval authority');
  }

  const github = value.github;
  if (!github || typeof github !== 'object') fail('github policy is required');
  const codeOwners = stringArray(github.codeOwners, 'github.codeOwners');
  for (const owner of codeOwners) if (!/^@[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(owner)) fail(`CODEOWNER ${owner} must be an organization team slug`);
  nonEmpty(github.openAiSecret, 'github.openAiSecret');
  nonEmpty(github.codexEnvironment, 'github.codexEnvironment');
  if (!/^[A-Za-z0-9_.-]+$/.test(github.codexEnvironment)) fail('github.codexEnvironment must be a GitHub environment name');
  stringArray(github.requiredStatusChecks, 'github.requiredStatusChecks');
  nonEmpty(github.codexMode, 'github.codexMode');
  if (!github.protectedEnvironments || typeof github.protectedEnvironments !== 'object' || Array.isArray(github.protectedEnvironments) || Object.keys(github.protectedEnvironments).length === 0) fail('github.protectedEnvironments must be a non-empty object');
  for (const [environment, contract] of Object.entries(github.protectedEnvironments)) {
    if (!/^[A-Za-z0-9_.-]+$/.test(environment)) fail(`invalid protected environment ${environment}`);
    if (!contract || typeof contract !== 'object' || Array.isArray(contract)) fail(`github.protectedEnvironments.${environment} must be an object`);
    nonEmpty(contract.authority, `github.protectedEnvironments.${environment}.authority`);
    if (!['default-branch', 'release-tags'].includes(nonEmpty(contract.allowedRefs, `github.protectedEnvironments.${environment}.allowedRefs`))) fail(`github.protectedEnvironments.${environment}.allowedRefs is invalid`);
    stringArray(contract.secrets, `github.protectedEnvironments.${environment}.secrets`, { allowEmpty: true });
    stringArray(contract.variables, `github.protectedEnvironments.${environment}.variables`, { allowEmpty: true });
  }
  if (!github.protectedEnvironments[github.codexEnvironment]) fail('github.codexEnvironment is not declared in github.protectedEnvironments');
  if (!github.protectedEnvironments[github.codexEnvironment].secrets.includes(github.openAiSecret)) fail('the Codex environment must own github.openAiSecret');
  if (!github.actionPins || typeof github.actionPins !== 'object' || Array.isArray(github.actionPins) || Object.keys(github.actionPins).length === 0) fail('github.actionPins must be a non-empty object');
  for (const [action, pin] of Object.entries(github.actionPins)) {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.\/-]+$/.test(action) || action.includes('..') || action.endsWith('/')) fail(`invalid GitHub Action name ${action}`);
    if (!pin || typeof pin !== 'object' || Array.isArray(pin)) fail(`github.actionPins.${action} must be an object`);
    if (!/^[0-9a-f]{40}$/.test(nonEmpty(pin.sha, `github.actionPins.${action}.sha`))) fail(`github.actionPins.${action}.sha must be a lowercase 40-character commit SHA`);
    if (!/^v[0-9]+(?:\.[0-9]+){0,2}$/.test(nonEmpty(pin.version, `github.actionPins.${action}.version`))) fail(`github.actionPins.${action}.version must be a reviewed vN, vN.N, or vN.N.N label`);
  }

  const changeClasses = value.changeClasses;
  if (!changeClasses || typeof changeClasses !== 'object' || Array.isArray(changeClasses) || Object.keys(changeClasses).length === 0) fail('changeClasses must be a non-empty object');
  for (const [id, entry] of Object.entries(changeClasses)) {
    if (!/^[a-z][a-z0-9-]*$/.test(id)) fail(`invalid change class id ${id}`);
    if (!entry || typeof entry !== 'object') fail(`change class ${id} must be an object`);
    nonEmpty(entry.label, `changeClasses.${id}.label`);
    nonEmpty(entry.summary, `changeClasses.${id}.summary`);
    if (typeof entry.agentMayImplement !== 'boolean' || typeof entry.humanDecisionRequired !== 'boolean') fail(`change class ${id} must declare agentMayImplement and humanDecisionRequired`);
    nonEmpty(entry.defaultScope, `changeClasses.${id}.defaultScope`);
  }

  const scopeStates = value.scopeStates;
  if (!scopeStates || typeof scopeStates !== 'object' || Array.isArray(scopeStates) || Object.keys(scopeStates).length === 0) fail('scopeStates must be a non-empty object');
  for (const [id, entry] of Object.entries(scopeStates)) {
    if (!/^[a-z][a-z0-9-]*$/.test(id)) fail(`invalid scope state id ${id}`);
    nonEmpty(entry && entry.label, `scopeStates.${id}.label`);
    if (typeof entry.humanDecisionRequired !== 'boolean') fail(`scopeStates.${id}.humanDecisionRequired must be boolean`);
  }
  for (const [id, entry] of Object.entries(changeClasses)) if (!scopeStates[entry.defaultScope]) fail(`change class ${id} references unknown default scope ${entry.defaultScope}`);

  const checks = value.checks;
  if (!checks || typeof checks !== 'object' || Array.isArray(checks) || Object.keys(checks).length === 0) fail('checks must be a non-empty object');
  for (const [id, entry] of Object.entries(checks)) {
    if (!/^[a-z][a-z0-9-]*$/.test(id)) fail(`invalid check id ${id}`);
    nonEmpty(entry && entry.label, `checks.${id}.label`);
    nonEmpty(entry && entry.command, `checks.${id}.command`);
    if (typeof entry.portable !== 'boolean') fail(`checks.${id}.portable must be boolean`);
  }

  if (!Array.isArray(value.protectedBoundaries) || value.protectedBoundaries.length === 0) fail('protectedBoundaries must be a non-empty array');
  const boundaryIds = new Set();
  for (const [index, boundary] of value.protectedBoundaries.entries()) {
    const id = nonEmpty(boundary && boundary.id, `protectedBoundaries[${index}].id`);
    if (!/^[a-z][a-z0-9-]*$/.test(id)) fail(`invalid protected boundary id ${id}`);
    if (boundaryIds.has(id)) fail(`duplicate protected boundary ${id}`);
    boundaryIds.add(id);
    nonEmpty(boundary.label, `protectedBoundaries.${id}.label`);
    nonEmpty(boundary.summary, `protectedBoundaries.${id}.summary`);
    if (!['architecture', 'release'].includes(boundary.decisionKind)) fail(`protected boundary ${id} uses unsupported decision kind ${boundary.decisionKind}`);
    if (typeof boundary.contractUpdateRequired !== 'boolean') fail(`protected boundary ${id}.contractUpdateRequired must be boolean`);
  }

  if (!Array.isArray(value.pathRules) || value.pathRules.length === 0) fail('pathRules must be a non-empty array');
  const ruleIds = new Set();
  const usedBoundaries = new Set();
  for (const [index, rule] of value.pathRules.entries()) {
    const id = nonEmpty(rule && rule.id, `pathRules[${index}].id`);
    if (ruleIds.has(id)) fail(`duplicate path rule ${id}`);
    ruleIds.add(id);
    const patterns = stringArray(rule.patterns, `pathRules.${id}.patterns`);
    for (const pattern of patterns) globToRegExp(pattern);
    stringArray(rule.areas, `pathRules.${id}.areas`);
    const boundaries = stringArray(rule.boundaries, `pathRules.${id}.boundaries`, { allowEmpty: true });
    for (const boundary of boundaries) {
      if (!boundaryIds.has(boundary)) fail(`path rule ${id} references unknown boundary ${boundary}`);
      usedBoundaries.add(boundary);
    }
    for (const check of stringArray(rule.checks, `pathRules.${id}.checks`)) if (!checks[check]) fail(`path rule ${id} references unknown check ${check}`);
    if (!RISK_ORDER.includes(rule.risk)) fail(`path rule ${id} uses unsupported risk ${rule.risk}`);
  }
  for (const boundary of boundaryIds) if (!usedBoundaries.has(boundary)) fail(`protected boundary ${boundary} is not covered by any path rule`);

  const declaration = value.pullRequestDeclaration;
  if (!declaration || typeof declaration !== 'object') fail('pullRequestDeclaration is required');
  nonEmpty(declaration.startMarker, 'pullRequestDeclaration.startMarker');
  nonEmpty(declaration.endMarker, 'pullRequestDeclaration.endMarker');
  if (declaration.startMarker === declaration.endMarker) fail('pull-request declaration markers must differ');
  if (!declaration.fields || typeof declaration.fields !== 'object') fail('pullRequestDeclaration.fields is required');
  const classValues = declaration.fields['Change class'];
  const scopeValues = declaration.fields.Scope;
  const humanValues = declaration.fields['Human decision'];
  if (JSON.stringify(classValues) !== JSON.stringify(Object.keys(changeClasses))) fail('pull-request Change class values must match changeClasses in declaration order');
  if (JSON.stringify(scopeValues) !== JSON.stringify(Object.keys(scopeStates))) fail('pull-request Scope values must match scopeStates in declaration order');
  if (declaration.fields['Protected boundaries'] !== 'boundary-list-or-none') fail('Protected boundaries declaration must use boundary-list-or-none');
  if (JSON.stringify(humanValues) !== JSON.stringify(['not-required', 'required'])) fail('Human decision values must be not-required and required');

  if (!Array.isArray(value.labels) || value.labels.length === 0) fail('labels must be a non-empty array');
  const labelNames = new Set();
  for (const [index, label] of value.labels.entries()) {
    const name = nonEmpty(label && label.name, `labels[${index}].name`);
    if (labelNames.has(name)) fail(`duplicate label ${name}`);
    labelNames.add(name);
    if (!/^[0-9a-fA-F]{6}$/.test(nonEmpty(label.color, `labels.${name}.color`))) fail(`label ${name} color must be six hexadecimal digits`);
    nonEmpty(label.description, `labels.${name}.description`);
  }

  if (!value.issueForms || typeof value.issueForms !== 'object' || Array.isArray(value.issueForms)) fail('issueForms must be an object');
  for (const [file, form] of Object.entries(value.issueForms)) {
    if (!/^[a-z0-9-]+\.yml$/.test(file)) fail(`invalid issue-form file ${file}`);
    if (!changeClasses[form.changeClass]) fail(`issue form ${file} references unknown change class ${form.changeClass}`);
    for (const label of stringArray(form.labels, `issueForms.${file}.labels`)) if (!labelNames.has(label)) fail(`issue form ${file} references unknown label ${label}`);
  }

  return deepFreeze(value);
}

function loadMaintenancePolicy(file = MAINTENANCE_POLICY_FILE) {
  if (!fs.existsSync(file)) fail(`maintenance policy is missing: ${file}`);
  let value;
  try { value = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { fail(`maintenance policy is not valid JSON: ${error.message}`); }
  return validateMaintenancePolicy(value);
}

function matchesPattern(file, pattern) {
  return globToRegExp(pattern).test(slash(file).replace(/^\.\//, ''));
}

function rulesForFile(file, policy = MAINTENANCE_POLICY) {
  const normalized = slash(file).replace(/^\.\//, '');
  return policy.pathRules.filter((rule) => rule.patterns.some((pattern) => matchesPattern(normalized, pattern)));
}

function classifyFiles(files, policy = MAINTENANCE_POLICY) {
  const normalizedFiles = [...new Set(files.map((file) => slash(file).replace(/^\.\//, '')).filter(Boolean))].sort();
  const areas = new Set();
  const boundaries = new Set();
  const checks = new Set(['maintenance-policy']);
  const matchedRules = new Set();
  const unmatchedFiles = [];
  let riskIndex = 0;
  const fileDetails = [];

  for (const file of normalizedFiles) {
    const rules = rulesForFile(file, policy);
    if (rules.length === 0) unmatchedFiles.push(file);
    for (const rule of rules) {
      matchedRules.add(rule.id);
      for (const area of rule.areas) areas.add(area);
      for (const boundary of rule.boundaries) boundaries.add(boundary);
      for (const check of rule.checks) checks.add(check);
      riskIndex = Math.max(riskIndex, RISK_ORDER.indexOf(rule.risk));
    }
    fileDetails.push(Object.freeze({ file, rules: Object.freeze(rules.map((rule) => rule.id)) }));
  }

  if (unmatchedFiles.length) riskIndex = Math.max(riskIndex, RISK_ORDER.indexOf('medium'));
  return deepFreeze({
    files: normalizedFiles,
    fileDetails,
    areas: [...areas].sort(),
    boundaries: [...boundaries].sort(),
    checks: [...checks].sort(),
    matchedRules: [...matchedRules].sort(),
    unmatchedFiles,
    risk: RISK_ORDER[riskIndex]
  });
}

function renderCodeowners(policy = MAINTENANCE_POLICY) {
  const owners = policy.github.codeOwners.join(' ');
  return stable(`# Generated from release/maintenance-policy.json by scripts/maintenance-policy.cjs.
# Create the listed visible organization team(s), grant write access, and require
# CODEOWNER review in the default-branch ruleset before treating this as enforced.

* ${owners}

# Protect the control plane that defines and interprets ownership.
/.github/ ${owners}
/release/maintenance-policy.json ${owners}
/AGENTS.md ${owners}
AGENTS.md ${owners}
/scripts/maintenance-policy.cjs ${owners}
/scripts/maintainer-scope.cjs ${owners}
/scripts/validate-maintainer-control-plane.cjs ${owners}
/docs/maintainers/ ${owners}
`);
}

function yamlScalar(value) {
  return JSON.stringify(String(value));
}

function renderLabels(policy = MAINTENANCE_POLICY) {
  const lines = [
    '# Generated from release/maintenance-policy.json by scripts/maintenance-policy.cjs.',
    '# Run the Maintainer labels workflow after repository creation or policy changes.',
    ''
  ];
  for (const label of policy.labels) {
    lines.push(`- name: ${yamlScalar(label.name)}`);
    lines.push(`  color: ${yamlScalar(label.color.toLowerCase())}`);
    lines.push(`  description: ${yamlScalar(label.description)}`);
  }
  lines.push('');
  return lines.join('\n');
}

function maintainerReviewSchema(policy = MAINTENANCE_POLICY) {
  return deepFreeze({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://pulsecompute.io/schemas/maintainer-review.v1.json',
    title: 'Pulse Codex maintainer review',
    type: 'object',
    additionalProperties: false,
    required: [
      'schemaVersion',
      'summary',
      'classification',
      'scope',
      'risk',
      'scopeStatus',
      'protectedBoundaries',
      'requiredChecks',
      'humanDecisionRequired',
      'implementationRecommendation',
      'findings',
      'evidence',
      'confidence'
    ],
    properties: {
      schemaVersion: { const: MAINTAINER_REVIEW_SCHEMA },
      summary: { type: 'string', minLength: 1, maxLength: 1200 },
      classification: { enum: Object.keys(policy.changeClasses) },
      scope: { enum: Object.keys(policy.scopeStates) },
      risk: { enum: RISK_ORDER },
      scopeStatus: { enum: ['inside-developer-preview', 'requires-human-decision', 'out-of-scope', 'blocked'] },
      protectedBoundaries: {
        type: 'array',
        uniqueItems: true,
        maxItems: policy.protectedBoundaries.length,
        items: { enum: policy.protectedBoundaries.map((entry) => entry.id) }
      },
      requiredChecks: {
        type: 'array',
        uniqueItems: true,
        maxItems: Object.keys(policy.checks).length,
        items: { enum: Object.keys(policy.checks) }
      },
      humanDecisionRequired: { type: 'boolean' },
      implementationRecommendation: { enum: ['proceed', 'proceed-with-human-review', 'analysis-only', 'reject'] },
      findings: {
        type: 'array',
        maxItems: 20,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['severity', 'title', 'detail', 'evidence'],
          properties: {
            severity: { enum: ['P0', 'P1', 'P2', 'P3'] },
            title: { type: 'string', minLength: 1, maxLength: 240 },
            detail: { type: 'string', minLength: 1, maxLength: 2400 },
            evidence: { type: 'string', minLength: 1, maxLength: 1200 }
          }
        }
      },
      evidence: {
        type: 'array',
        maxItems: 30,
        items: { type: 'string', minLength: 1, maxLength: 1200 }
      },
      confidence: { enum: ['low', 'medium', 'high'] }
    }
  });
}

function renderMaintenanceReference(policy = MAINTENANCE_POLICY) {
  const classRows = Object.entries(policy.changeClasses).map(([id, entry]) => `| \`${id}\` | ${entry.label} | ${entry.agentMayImplement ? 'May prepare implementation' : 'Analysis only until approved'} | ${entry.humanDecisionRequired ? 'Yes' : 'No'} | ${entry.summary} |`);
  const boundaryRows = policy.protectedBoundaries.map((entry) => `| \`${entry.id}\` | ${entry.label} | ${entry.decisionKind} | ${entry.contractUpdateRequired ? 'Required' : 'When affected'} | ${entry.summary} |`);
  const checkRows = Object.entries(policy.checks).map(([id, entry]) => `| \`${id}\` | ${entry.portable ? 'Portable' : 'Dependency-bound'} | \`${entry.command}\` |`);
  const actionRows = Object.entries(policy.github.actionPins).map(([action, pin]) => `| \`${action}\` | \`${pin.version}\` | \`${pin.sha}\` |`);
  const environmentRows = Object.entries(policy.github.protectedEnvironments).map(([name, entry]) => `| \`${name}\` | ${entry.authority} | \`${entry.allowedRefs}\` | ${entry.secrets.length ? entry.secrets.map((value) => `\`${value}\``).join(', ') : 'None'} | ${entry.variables.length ? entry.variables.map((value) => `\`${value}\``).join(', ') : 'None'} |`);
  const formRows = Object.entries(policy.issueForms).map(([file, entry]) => `| \`${file}\` | \`${entry.changeClass}\` | ${entry.labels.map((label) => `\`${label}\``).join(', ')} |`);
  return stable(`# Maintenance policy reference

<!-- Generated by scripts/maintenance-policy.cjs. Edit release/maintenance-policy.json instead. -->

Pulse uses a machine-readable maintenance policy so repository automation and Codex receive the same scope boundaries. The policy is advisory about product direction and mandatory about process: Codex may analyze, review, and prepare bounded patches, while a human retains architecture, merge, repository-setting, and release authority.

- **Policy schema:** \`${policy.schemaVersion}\`
- **Policy version:** \`${policy.policyVersion}\`
- **Release:** \`${policy.releaseVersion}\`
- **Reviewed:** \`${policy.reviewedAt}\`
- **Resident maintainer:** ${policy.maintainerModel.residentMaintainer}
- **Merge authority:** ${policy.maintainerModel.mergeAuthority}
- **Release authority:** ${policy.maintainerModel.releaseAuthority}
- **Protected Codex environment:** \`${policy.github.codexEnvironment}\`
- **Codex secret:** \`${policy.github.openAiSecret}\`

## Protected environments

| Environment | Approval authority | Allowed refs | Secrets | Variables |
|---|---|---|---|---|
${environmentRows.join('\n')}

Production environments are release-control boundaries. Codex may inspect failures and prepare patches, but it cannot approve an environment, receive production credentials outside the declared job, publish packages, promote documentation, or activate infrastructure.

## Change classes

| ID | Meaning | Codex posture | Separate human decision | Boundary |
|---|---|---|---:|---|
${classRows.join('\n')}

A normal human code review is still required for every merge. “Separate human decision” means the change also alters scope, architecture, or release authority and must be acknowledged before implementation is treated as approved direction.

## Protected boundaries

| ID | Boundary | Decision kind | Current contract update | Meaning |
|---|---|---|---:|---|
${boundaryRows.join('\n')}

Path classification is intentionally conservative. Touching a protected path does not prove that a contract changed; it ensures the pull request names the boundary and receives deliberate review.

## Validation catalog

| Check ID | Availability | Command |
|---|---|---|
${checkRows.join('\n')}

Portable checks use the normal lockfile-pinned workspace installation and do not require the release-only dependency bundle or external provider credentials. Dependency-bound checks remain required before publication when their affected paths are touched.

## Reviewed GitHub Actions

Every external action used by a checked-in workflow is pinned to a full reviewed commit SHA. The human-readable version is retained as a comment, but tags do not determine execution.

| Action | Reviewed version | Commit SHA |
|---|---|---|
${actionRows.join('\n')}

## Pull-request declaration

Every pull request includes a machine-readable Markdown comment with:

\`\`\`text
${policy.pullRequestDeclaration.startMarker}
Change class: defect
Scope: inside-developer-preview
Protected boundaries: none
Human decision: not-required
${policy.pullRequestDeclaration.endMarker}
\`\`\`

The deterministic scope gate compares that declaration with changed paths. It fails only for a missing or contradictory declaration; a correctly declared architecture, scope, or release decision remains visible and relies on CODEOWNER/branch-rule approval rather than pretending an agent can approve it.

## Issue intake

| Form | Initial class | Labels |
|---|---|---|
${formRows.join('\n')}

Labels are synchronized by the manual **Maintainer labels** workflow. Issue labels classify incoming evidence; they do not authorize implementation or widen the Beta contract.

## Codex operation

The repository supports two complementary paths:

1. Native Codex GitHub review can be enabled in Codex settings and follows the nearest \`AGENTS.md\` file.
2. The manual **Codex maintainer review** workflow runs from the protected \`${policy.github.codexEnvironment}\` environment, uses the policy-specific prompt in a read-only permission profile, validates its output against the generated maintainer-review schema, and posts a structured review to the selected pull request.

Neither path can merge, publish, change repository settings, or approve a protected-boundary decision. The environment secret is released only after the repository owner's configured protection rules pass.
`);
}

function buildExpectedMaintenanceFiles(policy = MAINTENANCE_POLICY) {
  return new Map([
    ['.github/CODEOWNERS', renderCodeowners(policy)],
    ['.github/labels.yml', renderLabels(policy)],
    ['.github/codex/schemas/maintainer-review.schema.json', stableJson(maintainerReviewSchema(policy))],
    ['docs/maintainers/maintenance-policy.json', stableJson(policy)],
    ['docs/maintainers/maintenance-policy.md', renderMaintenanceReference(policy)]
  ]);
}

function synchronizeMaintenancePolicy(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, '..'));
  const write = options.write === true;
  const policyFile = options.policyFile || path.join(repoRoot, 'release', 'maintenance-policy.json');
  const policy = loadMaintenancePolicy(policyFile);
  const expected = buildExpectedMaintenanceFiles(policy);
  const mismatches = [];
  let changedFiles = 0;
  for (const [relativeFile, content] of expected) {
    const file = path.join(repoRoot, relativeFile);
    const actual = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined;
    if (actual !== content) {
      mismatches.push(relativeFile);
      if (write) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
        changedFiles += 1;
      }
    }
  }
  if (!write && mismatches.length) fail(`maintenance policy outputs are stale: ${mismatches.join(', ')}. Run npm run maintainer:sync`);
  return deepFreeze({ status: 'ok', expectedFiles: expected.size, changedFiles, mismatches, policyVersion: policy.policyVersion });
}

const MAINTENANCE_POLICY = loadMaintenancePolicy();
const BOUNDARY_BY_ID = deepFreeze(Object.fromEntries(MAINTENANCE_POLICY.protectedBoundaries.map((entry) => [entry.id, entry])));

module.exports = Object.freeze({
  MAINTENANCE_POLICY_SCHEMA,
  MAINTAINER_REVIEW_SCHEMA,
  MAINTENANCE_POLICY_FILE,
  MAINTENANCE_POLICY,
  BOUNDARY_BY_ID,
  RISK_ORDER,
  globToRegExp,
  matchesPattern,
  rulesForFile,
  classifyFiles,
  validateMaintenancePolicy,
  loadMaintenancePolicy,
  renderCodeowners,
  renderLabels,
  maintainerReviewSchema,
  renderMaintenanceReference,
  buildExpectedMaintenanceFiles,
  synchronizeMaintenancePolicy
});

if (require.main === module) {
  try {
    const args = new Set(process.argv.slice(2));
    const unknown = [...args].filter((entry) => !['--write', '--check', '--json'].includes(entry));
    if (unknown.length) fail(`unknown option(s): ${unknown.join(', ')}`);
    const result = synchronizeMaintenancePolicy({ write: args.has('--write') });
    if (args.has('--json')) process.stdout.write(stableJson(result));
    else process.stdout.write(`ok - ${result.expectedFiles} maintenance-policy output(s) synchronized${result.changedFiles ? `; updated ${result.changedFiles} file(s)` : ''}\n`);
  } catch (error) {
    process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  }
}
