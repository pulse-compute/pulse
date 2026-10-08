'use strict';

const { renderCompletion } = require('../completion.js');
const { normalizeCommandRequest } = require('./command-request.js');

function writeJson(stream, value) {
  stream.write(`${JSON.stringify(value, null, 2)}\n`);
}

function writeHumanResult(stream, command, result) {
  if (command === 'init') {
    stream.write(`Initialized Pulse project at ${result.root}\n`);
    for (const file of result.files) stream.write(`  ${file}\n`);
    if (result.nextSteps) {
      stream.write('Next steps:\n');
      for (const step of result.nextSteps) stream.write(`  ${step}\n`);
    }
    return;
  }
  if (command === 'build') {
    stream.write(`Built ${result.project.entryFile} for ${result.provider}\n`);
    stream.write(`  ${result.files.manifest}\n`);
    stream.write(`  ${result.files.handler}\n`);
    if (result.files.nativeWasm) stream.write(`  ${result.files.nativeWasm}\n`);
    if (result.files.providerWasm) stream.write(`  ${result.files.providerWasm}\n`);
    if (result.manifest && result.manifest.providerTarget && result.manifest.providerTarget.optimization && result.manifest.providerTarget.optimization.experimental) {
      stream.write('  experimental optimization: native-size (compiler-owned profile)\n');
    }
    return;
  }
  if (command === 'compile') {
    stream.write(`Compiled ${result.project.entryFile} to provider-neutral Pulse Wasm\n`);
    stream.write(`  ${result.files.nativeWasm}\n`);
    stream.write(`  ${result.files.manifest}\n`);
    if (result.native && result.native.optimization && result.native.optimization.experimental) {
      stream.write('  experimental optimization: native-size (compiler-owned profile)\n');
    }
    return;
  }
  if (command === 'test') {
    for (const entry of result.cases || []) stream.write(`${entry.status === 'passed' ? 'ok' : 'not ok'} - ${entry.name}\n`);
    stream.write(`${result.summary.passed}/${result.summary.total} Pulse project tests passed\n`);
    return;
  }
  if (command === 'inspect') {
    stream.write(`${result.project.entryFile}\n`);
    stream.write(`  workspace: ${result.project.workspace ? result.project.workspace.root : result.project.root}\n`);
    if (result.project.selectedProfile) stream.write(`  profile: ${result.project.selectedProfile.name} (${result.project.selectedProfile.source})\n`);
    stream.write(`  target: ${result.project.target || 'native'}\n`);
    stream.write(`  provider: ${result.project.provider}\n`);
    stream.write(`  capabilities: ${(result.compiler.capabilities || []).join(', ') || 'none'}\n`);
    stream.write(`  effects: ${result.compiler.effectCount}\n`);
    stream.write(`  continuations: ${result.compiler.continuationCount}\n`);
    return;
  }
  if (command === 'doctor') {
    for (const check of result.checks) {
      stream.write(`${check.status.padEnd(7)} ${check.id}: ${check.message}\n`);
      if (check.id === 'native-expansion') {
        for (const owner of check.detail.owners.slice(0, 5)) {
          const source = [owner.source.file, owner.source.line, owner.source.column].filter(value => value !== undefined).join(':');
          stream.write(`  ${source} (${owner.name}): ${owner.registrationCount} registrations, ${owner.nativeBodyInstances ?? 'unknown'} Native plan bodies, ${owner.sharing}; ${owner.loweredSourceBytes ?? 'unknown'} lowered-source bytes\n`);
          for (const observation of owner.observations) stream.write(`    ${observation}\n`);
        }
        const omitted = check.detail.summary.repeatedOwners - Math.min(check.detail.owners.length, 5);
        if (omitted) stream.write(`  ${omitted} more repeated owner(s); JSON includes up to ${check.detail.maxOwners}.\n`);
      }
    }
    for (const entry of result.checks.filter((check) => check.status !== 'passed' && check.remediation)) {
      for (const step of entry.remediation) stream.write(`  help: ${step}\n`);
    }
    stream.write(`doctor: ${result.status}\n`);
  }
}

function createCommandReporter(options = {}) {
  const stdout = options.stdout || process.stdout;
  const stderr = options.stderr || process.stderr;
  const cliVersion = String(options.cliVersion || require('../../package.json').version);
  const usageText = String(options.usageText || '');

  function reportPlan(requestValue, plan) {
    const request = normalizeCommandRequest(requestValue);
    if (request.kind !== 'command') return;
    if (request.json) writeJson(stdout, { status: 'ok', version: cliVersion, plan });
    else if (request.command === 'report') {
      const safe = require('./report/command').terminalText;
      stdout.write(`report: ${plan.mode}; ${plan.format}\n  input: ${safe(plan.artifact || plan.directory, 4096)}\n${plan.output ? '  output: ' + safe(plan.output, 4096) + '\n' : ''}  No collection or writes; profile selection and evidence validation occur on execution.\n`);
    } else stdout.write(`${plan.command}: ${plan.mode || 'ready'}\n`);
  }

  function reportEvent(requestValue, event) {
    const request = normalizeCommandRequest(requestValue);
    if (request.kind !== 'command') return;
    if (request.json) stdout.write(`${JSON.stringify(event)}\n`);
    else if (event.event === 'ready') stdout.write(`pulse dev: ${event.url}\n`);
    else if (event.event === 'reloaded') stdout.write(`reloaded ${event.entry}\n`);
    else if (event.event === 'compile-error') stderr.write(`compile error: ${event.error.message}\n`);
    else if (event.event === 'request-error') stderr.write(`request error: ${event.error.message}\n`);
  }

  function reportExecution(requestValue, plan, execution) {
    const request = normalizeCommandRequest(requestValue);
    if (request.kind === 'meta' || request.help) {
      const invocation = request.kind === 'meta' ? request.invocation : 'help';
      if (invocation === 'help') stdout.write(usageText);
      else if (invocation === 'version') stdout.write(`${execution.version}\n`);
      else {
        const completion = renderCompletion(request.shell);
        stdout.write(completion);
        return { ...execution, bytes: Buffer.byteLength(completion) };
      }
      return execution;
    }
    if (request.command === 'report') {
      const report = require('./report/command');
      if (request.json) stdout.write(require('./report/capsule').serializeCapsule(execution.result.capsule));
      else if (request.html) stdout.write(report.terminalText(execution.result.file, 4096) + '\n');
      else stdout.write(report.terminalOverview(execution.result));
      return execution;
    }
    if (plan.mode === 'artifact') {
      if (request.json) writeJson(stdout, execution.result);
      else stdout.write(`${execution.result.file}: ok\n`);
      return execution;
    }
    if (request.command === 'dev') return execution;
    if (request.json) writeJson(stdout, execution.result);
    else writeHumanResult(stdout, request.command, execution.result);
    return execution;
  }

  function reportDiagnostic(summary, context = {}) {
    const request = context.request;
    const wantsJson = Boolean(context.json)
      || Boolean(request && request.kind === 'command' && request.json)
      || Array.from(context.argv || []).includes('--json');
    if (wantsJson) {
      writeJson(stderr, { status: 'error', version: cliVersion, error: summary });
      return;
    }
    const safe = request?.command === 'report' || String(context.argv?.[0]).toLowerCase() === 'report'
      ? require('./report/command').terminalText : value => value;
    stderr.write(`pulse: ${summary.code ? `${safe(summary.code)}: ` : ''}${safe(summary.message, 1000)}\n`);
    for (const step of summary.remediation || []) stderr.write(`  help: ${step}\n`);
    if (summary.docs) stderr.write(`  docs: ${summary.docs}\n`);
  }

  return Object.freeze({ reportPlan, reportEvent, reportExecution, reportDiagnostic });
}

module.exports = Object.freeze({
  createCommandReporter,
  writeJson,
  writeHumanResult
});
