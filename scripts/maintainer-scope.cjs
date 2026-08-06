#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  MAINTENANCE_POLICY,
  BOUNDARY_BY_ID,
  RISK_ORDER,
  classifyFiles
} = require('./maintenance-policy.cjs');

const SCOPE_REPORT_SCHEMA = 'pulse.maintainer-scope-report.v2';

function fail(message) {
  const error = new Error(message);
  error.code = 'PULSE_MAINTAINER_SCOPE_INVALID';
  throw error;
}

function slash(value) { return String(value).replace(/\\/g, '/'); }
function stableJson(value) { return `${JSON.stringify(value, null, 2)}\n`; }
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function parseArgs(argv) {
  const options = {
    changedFiles: [],
    check: false,
    allowMissingDeclaration: false,
    writeGithub: true,
    json: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const take = (name) => {
      const value = argv[++index];
      if (!value) fail(`${name} requires a value`);
      return value;
    };
    if (token === '--base') { options.base = take(token); continue; }
    if (token.startsWith('--base=')) { options.base = token.slice(7); continue; }
    if (token === '--head') { options.head = take(token); continue; }
    if (token.startsWith('--head=')) { options.head = token.slice(7); continue; }
    if (token === '--event') { options.eventFile = take(token); continue; }
    if (token.startsWith('--event=')) { options.eventFile = token.slice(8); continue; }
    if (token === '--declaration-file' || token === '--pr-body-file') { options.declarationFile = take(token); continue; }
    if (token.startsWith('--declaration-file=')) { options.declarationFile = token.slice(19); continue; }
    if (token.startsWith('--pr-body-file=')) { options.declarationFile = token.slice(15); continue; }
    if (token === '--body') { options.body = take(token); continue; }
    if (token.startsWith('--body=')) { options.body = token.slice(7); continue; }
    if (token === '--changed-file') { options.changedFiles.push(take(token)); continue; }
    if (token.startsWith('--changed-file=')) { options.changedFiles.push(token.slice(15)); continue; }
    if (token === '--changed-files-file') { options.changedFilesFile = take(token); continue; }
    if (token.startsWith('--changed-files-file=')) { options.changedFilesFile = token.slice(21); continue; }
    if (token === '--changed-files0-file') { options.changedFiles0File = take(token); continue; }
    if (token.startsWith('--changed-files0-file=')) { options.changedFiles0File = token.slice(22); continue; }
    if (token === '--json-out') { options.jsonOut = take(token); continue; }
    if (token.startsWith('--json-out=')) { options.jsonOut = token.slice(11); continue; }
    if (token === '--markdown-out') { options.markdownOut = take(token); continue; }
    if (token.startsWith('--markdown-out=')) { options.markdownOut = token.slice(15); continue; }
    if (token === '--check') { options.check = true; continue; }
    if (token === '--allow-missing-declaration') { options.allowMissingDeclaration = true; continue; }
    if (token === '--no-github') { options.writeGithub = false; continue; }
    if (token === '--json') { options.json = true; continue; }
    if (token === '--help' || token === '-h') { options.help = true; continue; }
    fail(`unknown maintainer-scope option ${token}`);
  }
  return options;
}

function usage() {
  return [
    'Usage: node scripts/maintainer-scope.cjs [options]',
    '',
    'Changed-file sources:',
    '  --base <git-ref> --head <git-ref>',
    '  --event <github-event.json>',
    '  --changed-file <path> (repeatable)',
    '  --changed-files-file <newline-separated-file>',
    '  --changed-files0-file <NUL-separated-file>',
    '',
    'Declaration sources:',
    '  --declaration-file <pull-request-body.md>',
    '  --body <text>',
    '  --event <github-event.json>',
    '',
    'Output:',
    '  --json-out <file>',
    '  --markdown-out <file>',
    '  --json',
    '  --check',
    '  --allow-missing-declaration',
    '  --no-github'
  ].join('\n');
}

function readEvent(file) {
  if (!file) return undefined;
  try { return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')); }
  catch (error) { fail(`cannot read GitHub event ${file}: ${error.message}`); }
}

function gitChangedFiles(repoRoot, base, head) {
  if (!base || !head) return [];
  const result = spawnSync('git', ['diff', '--name-only', '--diff-filter=ACMRDTUXB', '-z', `${base}...${head}`], {
    cwd: repoRoot,
    encoding: null,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (result.error || result.status !== 0) {
    const detail = Buffer.concat([result.stdout || Buffer.alloc(0), result.stderr || Buffer.alloc(0)]).toString('utf8').trim();
    fail(`git diff failed for ${base}...${head}${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout.toString('utf8').split('\0').filter(Boolean);
}

function collectInputs(options, repoRoot) {
  const event = readEvent(options.eventFile);
  const pullRequest = event && event.pull_request;
  const base = options.base || (pullRequest && pullRequest.base && pullRequest.base.sha);
  const head = options.head || (pullRequest && pullRequest.head && pullRequest.head.sha);
  const directChangedFiles = Array.isArray(options.changedFiles) ? options.changedFiles : [];
  const files = [...directChangedFiles];
  const explicitChangedFileSource = Boolean(directChangedFiles.length || options.changedFilesFile || options.changedFiles0File);
  if (options.changedFilesFile) {
    files.push(...fs.readFileSync(path.resolve(options.changedFilesFile), 'utf8').split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean));
  }
  if (options.changedFiles0File) {
    files.push(...fs.readFileSync(path.resolve(options.changedFiles0File)).toString('utf8').split('\0').filter(Boolean));
  }
  if (base || head) {
    if (!base || !head) fail('both --base and --head are required when using git diff');
    // Workflows can supply a trusted, precomputed NUL-delimited path list while
    // preserving base/head metadata. Never re-run git from an extracted base
    // archive when an explicit changed-file source was provided.
    if (!explicitChangedFileSource) files.push(...gitChangedFiles(repoRoot, base, head));
  }
  const body = options.body !== undefined
    ? options.body
    : options.declarationFile
      ? fs.readFileSync(path.resolve(options.declarationFile), 'utf8')
      : pullRequest
        ? String(pullRequest.body || '')
        : '';
  return deepFreeze({
    eventName: event && event.action ? String(event.action) : undefined,
    pullRequestNumber: pullRequest && pullRequest.number,
    base,
    head,
    body,
    files: [...new Set(files.map((entry) => slash(entry).replace(/^\.\//, '')).filter(Boolean))].sort()
  });
}

function parseDeclaration(body, policy = MAINTENANCE_POLICY) {
  const source = String(body || '');
  const { startMarker, endMarker } = policy.pullRequestDeclaration;
  const start = source.indexOf(startMarker);
  if (start < 0) return deepFreeze({ present: false, values: {}, errors: ['pull request is missing the Pulse maintainer declaration'] });
  const secondStart = source.indexOf(startMarker, start + startMarker.length);
  const end = source.indexOf(endMarker, start + startMarker.length);
  const errors = [];
  if (secondStart >= 0) errors.push('pull request contains more than one Pulse maintainer declaration');
  if (end < 0) return deepFreeze({ present: true, values: {}, errors: [...errors, 'pull request maintainer declaration is missing its end marker'] });
  const block = source.slice(start + startMarker.length, end);
  const values = {};
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const separator = line.indexOf(':');
    if (separator < 0) {
      errors.push(`invalid declaration line: ${line}`);
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (Object.prototype.hasOwnProperty.call(values, key)) errors.push(`declaration repeats ${key}`);
    values[key] = value;
  }
  for (const [field, contract] of Object.entries(policy.pullRequestDeclaration.fields)) {
    const value = values[field];
    if (!value) {
      errors.push(`declaration is missing ${field}`);
      continue;
    }
    if (Array.isArray(contract) && !contract.includes(value)) errors.push(`${field} must be one of ${contract.join(', ')}`);
  }
  for (const field of Object.keys(values)) if (!Object.prototype.hasOwnProperty.call(policy.pullRequestDeclaration.fields, field)) errors.push(`declaration contains unknown field ${field}`);

  let protectedBoundaries = [];
  if (values['Protected boundaries']) {
    if (values['Protected boundaries'] !== 'none') {
      protectedBoundaries = values['Protected boundaries'].split(',').map((entry) => entry.trim()).filter(Boolean);
      if (new Set(protectedBoundaries).size !== protectedBoundaries.length) errors.push('Protected boundaries contains duplicate IDs');
      const known = new Set(policy.protectedBoundaries.map((entry) => entry.id));
      for (const boundary of protectedBoundaries) if (!known.has(boundary)) errors.push(`Protected boundaries contains unknown ID ${boundary}`);
    }
  }

  return deepFreeze({
    present: true,
    values,
    changeClass: values['Change class'],
    scope: values.Scope,
    protectedBoundaries,
    humanDecision: values['Human decision'],
    errors
  });
}

function inferSuggestedClasses(classification) {
  const areas = new Set(classification.areas);
  if (classification.boundaries.includes('release-authority') || classification.boundaries.includes('package-publication')) return ['release'];
  if (classification.boundaries.includes('maintenance-control-plane')) return ['architecture'];
  if (classification.boundaries.length) return ['defect', 'hardening', 'architecture', 'scope-expansion'];
  if (areas.size > 0 && [...areas].every((area) => area === 'documentation')) return ['documentation'];
  if (areas.size > 0 && [...areas].every((area) => area === 'testing')) return ['evidence', 'hardening'];
  return ['defect', 'hardening', 'documentation', 'evidence'];
}

function maxRisk(left, right) {
  return RISK_ORDER[Math.max(RISK_ORDER.indexOf(left), RISK_ORDER.indexOf(right))];
}

function reportForInputs(inputs, options = {}, policy = MAINTENANCE_POLICY) {
  const classification = classifyFiles(inputs.files, policy);
  const declaration = parseDeclaration(inputs.body, policy);
  const errors = [...declaration.errors];
  const warnings = [];
  const boundaryIds = new Set(classification.boundaries);
  const declaredBoundaries = new Set(declaration.protectedBoundaries || []);

  if (!declaration.present && options.allowMissingDeclaration) {
    errors.length = 0;
    warnings.push('no pull-request declaration was supplied; report is advisory');
  }

  if (declaration.present && declaration.errors.length === 0) {
    for (const boundary of boundaryIds) if (!declaredBoundaries.has(boundary)) errors.push(`declaration omits inferred protected boundary ${boundary}`);
    for (const boundary of declaredBoundaries) if (!boundaryIds.has(boundary)) warnings.push(`declaration names protected boundary ${boundary}, but changed paths did not infer it`);
    const expectedScope = policy.changeClasses[declaration.changeClass] && policy.changeClasses[declaration.changeClass].defaultScope;
    if (expectedScope && declaration.scope !== expectedScope) errors.push(`change class ${declaration.changeClass} requires Scope: ${expectedScope}`);
  }

  const classEntry = declaration.changeClass && policy.changeClasses[declaration.changeClass];
  const scopeEntry = declaration.scope && policy.scopeStates[declaration.scope];
  const unmatchedDecisionRequired = classification.unmatchedFiles.length > 0;
  const declaredDecisionRequired = Boolean(
    (classEntry && classEntry.humanDecisionRequired) ||
    (scopeEntry && scopeEntry.humanDecisionRequired)
  );
  const humanDecisionRequired = Boolean(unmatchedDecisionRequired || declaredDecisionRequired);
  if (declaration.present && declaration.errors.length === 0) {
    if (humanDecisionRequired && declaration.humanDecision !== 'required') errors.push('Human decision must be required for unclassified, scope, architecture, or release changes');
    if (!humanDecisionRequired && declaration.humanDecision === 'required') warnings.push('Human decision is declared required even though changed paths do not require a separate scope or architecture decision');
  }

  if (classification.unmatchedFiles.length) warnings.push(`unclassified path(s) require human review: ${classification.unmatchedFiles.join(', ')}`);
  if (inputs.files.length === 0) warnings.push('no changed files were supplied; path classification is empty');

  const contractUpdateRequired = Boolean(
    declaredDecisionRequired &&
    classification.boundaries.some((id) => BOUNDARY_BY_ID[id] && BOUNDARY_BY_ID[id].contractUpdateRequired)
  );
  const releaseAuthorityRequired = Boolean(
    declaration.changeClass === 'release' ||
    declaration.scope === 'release-change' ||
    (declaredDecisionRequired && classification.boundaries.some((id) => BOUNDARY_BY_ID[id] && BOUNDARY_BY_ID[id].decisionKind === 'release'))
  );
  let risk = classification.risk;
  if (declaration.changeClass === 'scope-expansion') risk = maxRisk(risk, 'high');
  if (declaration.changeClass === 'architecture' || declaration.changeClass === 'release') risk = maxRisk(risk, 'critical');
  if (classification.unmatchedFiles.length) risk = maxRisk(risk, 'high');

  const status = errors.length ? 'fail' : humanDecisionRequired ? 'decision-required' : 'pass';
  const suggestedClasses = inferSuggestedClasses(classification);
  const recommendation = errors.length
    ? 'Correct the pull-request declaration before review.'
    : releaseAuthorityRequired
      ? 'Human release authority must decide and approve this change before merge or publication.'
      : humanDecisionRequired
        ? 'A human must explicitly decide the named boundary or scope question; Codex may analyze or prepare a patch only after that direction is clear.'
        : classEntry && classEntry.agentMayImplement
          ? 'The resident maintainer may analyze, review, and prepare a minimal patch; human review and merge remain required.'
          : 'Keep the work at analysis until a human approves the direction.';

  return deepFreeze({
    schemaVersion: SCOPE_REPORT_SCHEMA,
    policyVersion: policy.policyVersion,
    releaseVersion: policy.releaseVersion,
    status,
    pullRequest: inputs.pullRequestNumber || null,
    range: { base: inputs.base || null, head: inputs.head || null },
    declaration: {
      present: declaration.present,
      changeClass: declaration.changeClass || null,
      scope: declaration.scope || null,
      protectedBoundaries: declaration.protectedBoundaries || [],
      humanDecision: declaration.humanDecision || null
    },
    inferred: {
      changedFiles: classification.files.length,
      areas: classification.areas,
      protectedBoundaries: classification.boundaries,
      requiredChecks: classification.checks,
      matchedRules: classification.matchedRules,
      unmatchedFiles: classification.unmatchedFiles,
      risk,
      humanDecisionRequired,
      contractUpdateRequired,
      releaseAuthorityRequired,
      suggestedChangeClasses: suggestedClasses
    },
    consistency: { errors, warnings },
    files: classification.fileDetails,
    recommendation
  });
}

function escapeTable(value) {
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function renderMarkdown(report) {
  const statusLabel = report.status === 'pass' ? 'Pass' : report.status === 'decision-required' ? 'Human decision required' : 'Declaration failed';
  const boundaryText = report.inferred.protectedBoundaries.length ? report.inferred.protectedBoundaries.map((entry) => `\`${entry}\``).join(', ') : 'None';
  const areaText = report.inferred.areas.length ? report.inferred.areas.map((entry) => `\`${entry}\``).join(', ') : 'None';
  const checkText = report.inferred.requiredChecks.map((entry) => `\`${entry}\``).join(', ');
  const lines = [
    '# Pulse maintainer scope',
    '',
    `**Status:** ${statusLabel}`,
    '',
    '| Signal | Result |',
    '|---|---|',
    `| Declared class | ${report.declaration.changeClass ? `\`${escapeTable(report.declaration.changeClass)}\`` : 'Missing'} |`,
    `| Declared scope | ${report.declaration.scope ? `\`${escapeTable(report.declaration.scope)}\`` : 'Missing'} |`,
    `| Risk | \`${report.inferred.risk}\` |`,
    `| Changed files | ${report.inferred.changedFiles} |`,
    `| Areas | ${areaText} |`,
    `| Protected boundaries | ${boundaryText} |`,
    `| Separate human decision | ${report.inferred.humanDecisionRequired ? 'Required' : 'Not required'} |`,
    `| Current contract update | ${report.inferred.contractUpdateRequired ? 'Required for the proposed boundary change' : 'Not inferred'} |`,
    `| Release authority | ${report.inferred.releaseAuthorityRequired ? 'Required' : 'Not inferred'} |`,
    `| Required checks | ${checkText} |`,
    '',
    report.recommendation
  ];
  if (report.consistency.errors.length) {
    lines.push('', '## Errors', '');
    for (const error of report.consistency.errors) lines.push(`- ${error}`);
  }
  if (report.consistency.warnings.length) {
    lines.push('', '## Warnings', '');
    for (const warning of report.consistency.warnings) lines.push(`- ${warning}`);
  }
  if (report.inferred.unmatchedFiles.length) {
    lines.push('', '## Unclassified paths', '');
    for (const file of report.inferred.unmatchedFiles) lines.push(`- \`${String(file).replace(/`/g, '\\`')}\``);
  }
  lines.push('');
  return lines.join('\n');
}

function writeFile(file, content) {
  const target = path.resolve(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function appendGithubFile(environmentName, content) {
  const target = process.env[environmentName];
  if (!target) return;
  fs.appendFileSync(target, content);
}

function writeGithubOutputs(report, markdown) {
  appendGithubFile('GITHUB_OUTPUT', [
    `status=${report.status}`,
    `risk=${report.inferred.risk}`,
    `human_decision_required=${report.inferred.humanDecisionRequired}`,
    `contract_update_required=${report.inferred.contractUpdateRequired}`,
    `release_authority_required=${report.inferred.releaseAuthorityRequired}`,
    `changed_files=${report.inferred.changedFiles}`,
    ''
  ].join('\n'));
  appendGithubFile('GITHUB_STEP_SUMMARY', `${markdown}\n`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const repoRoot = path.resolve(__dirname, '..');
  const inputs = collectInputs(options, repoRoot);
  const report = reportForInputs(inputs, options);
  const markdown = renderMarkdown(report);
  if (options.jsonOut) writeFile(options.jsonOut, stableJson(report));
  if (options.markdownOut) writeFile(options.markdownOut, `${markdown}\n`);
  if (options.writeGithub) writeGithubOutputs(report, markdown);
  if (options.json) process.stdout.write(stableJson(report));
  else process.stdout.write(`${markdown}\n`);
  if (options.check && report.status === 'fail') process.exitCode = 1;
}

module.exports = Object.freeze({
  SCOPE_REPORT_SCHEMA,
  parseArgs,
  readEvent,
  gitChangedFiles,
  collectInputs,
  parseDeclaration,
  reportForInputs,
  renderMarkdown
});

if (require.main === module) {
  try { main(); }
  catch (error) {
    process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  }
}
