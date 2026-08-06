'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getDefaultArtifactsDir } = require('./artifacts-dir.js');
const { spawnSync } = require('node:child_process');

function loadContractsDiagnostics() {
  try {
    return require('@pulse-compute/wasm-contracts/diagnostics');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../contracts/src/diagnostics.js');
    }
    throw error;
  }
}

const { PACKAGE_VERSION, normalizeArtifact } = loadContractsDiagnostics();

const ASSEMBLYSCRIPT_COMPILE_VERSION = 'pulsewasm.assemblyscript-compile.v1';

const {
  fileRecord,
  sha256Text,
  stripAnsi,
  truncate
} = require('./files.js');

function parseAscWarnings(stderr) {
  const text = stripAnsi(stderr);
  const warnings = [];
  const regex = /WARNING\s+(AS\d+):\s+([^\n]+)(?:.|\n)*?in ([^\n]+)\((\d+),(\d+)\)/g;
  let match;
  while ((match = regex.exec(text))) {
    warnings.push({
      code: match[1],
      message: match[2].trim(),
      file: match[3],
      line: Number(match[4]),
      column: Number(match[5])
    });
  }
  if (warnings.length === 0 && /WARNING\s+AS\d+:/m.test(text)) {
    warnings.push({
      code: 'AS_WARNING',
      message: 'AssemblyScript emitted one or more warnings. Inspect result.stderr for details.'
    });
  }
  return warnings;
}

function resolveAssemblyScriptPackageRoot(cwd) {
  try {
    const packageJson = require.resolve('assemblyscript/package.json', { paths: [cwd] });
    return path.dirname(packageJson);
  } catch (_) {
    return undefined;
  }
}

function resolveAsc(cwd) {
  const packageRoot = resolveAssemblyScriptPackageRoot(cwd);
  if (!packageRoot) return undefined;
  const ascJs = path.join(packageRoot, 'bin', 'asc.js');
  if (!fs.existsSync(ascJs)) return undefined;
  return {
    packageRoot,
    executable: process.execPath,
    script: ascJs,
    display: `node ${path.relative(cwd, ascJs).replace(/\\/g, '/')}`
  };
}

function assemblyScriptVersion(cwd) {
  const packageRoot = resolveAssemblyScriptPackageRoot(cwd);
  if (!packageRoot) return undefined;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
    return pkg.version;
  } catch (_) {
    return undefined;
  }
}

function writeStagedFiles(stagingDir, shape, core) {
  const allFiles = [];
  if (shape && Array.isArray(shape.files)) allFiles.push(...shape.files);
  if (core && Array.isArray(core.files)) allFiles.push(...core.files);

  // De-duplicate by output path, keeping later/core files when index.as.ts is upgraded by the core generator.
  const byFile = new Map();
  for (const file of allFiles) byFile.set(file.file, file.text);

  for (const [file, text] of byFile.entries()) {
    const abs = path.join(stagingDir, file);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text, 'utf8');
  }

  return Array.from(byFile.entries()).map(([file, text]) => ({
    file,
    bytes: Buffer.byteLength(text, 'utf8'),
    sha256: sha256Text(text)
  }));
}

function runAscCompile(options) {
  const cwd = options.cwd || process.cwd();
  const outDir = options.outDir || getDefaultArtifactsDir(cwd);
  const shape = options.assemblyScriptShape;
  const core = options.assemblyScriptCore;
  const asc = resolveAsc(cwd);

  const diagnostics = [];
  if (!asc) {
    diagnostics.push({
      pass: 'assemblyscript-compile',
      code: 'PULSEWASM_ASSEMBLYSCRIPT_ASC_MISSING',
      severity: 'error',
      message: 'AssemblyScript compiler dependency was not found.',
      hint: 'Run corepack pnpm install --frozen-lockfile so the assemblyscript devDependency is available, then rerun the compile smoke test.',
      loc: { file: '<assemblyscript-compile>' }
    });
    return { artifact: buildArtifact({ cwd, outDir, status: 'error', diagnostics, shape, core }), diagnostics };
  }

  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulsewasm-as-compile-'));
  const outputDir = path.join(outDir, 'generated', 'as-smoke');
  fs.mkdirSync(outputDir, { recursive: true });

  const stagedFiles = writeStagedFiles(stagingDir, shape, core);
  const entry = path.join(stagingDir, 'generated/as/index.as.ts');
  const wasmFile = path.join(outputDir, 'pulsewasm-smoke.wasm');
  const watFile = path.join(outputDir, 'pulsewasm-smoke.wat');

  const ascArgs = [
    asc.script,
    entry,
    '--outFile', wasmFile,
    '--textFile', watFile,
    '--runtime', 'stub',
    '--noAssert'
  ];

  const startedAt = Date.now();
  const proc = spawnSync(asc.executable, ascArgs, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 12
  });
  const durationMs = Date.now() - startedAt;

  const warnings = parseAscWarnings(proc.stderr);

  if (proc.error) {
    diagnostics.push({
      pass: 'assemblyscript-compile',
      code: 'PULSEWASM_ASSEMBLYSCRIPT_COMPILE_SPAWN_FAILED',
      severity: 'error',
      message: `Failed to start AssemblyScript compiler: ${proc.error.message}`,
      hint: 'Verify Node can execute node_modules/assemblyscript/bin/asc.js.',
      loc: { file: '<assemblyscript-compile>' }
    });
  } else if (proc.status !== 0) {
    diagnostics.push({
      pass: 'assemblyscript-compile',
      code: 'PULSEWASM_ASSEMBLYSCRIPT_COMPILE_FAILED',
      severity: 'error',
      message: `AssemblyScript compile smoke test failed with exit code ${proc.status}.`,
      hint: 'Inspect assemblyscript-compile.json stderr/stdout for asc diagnostics. Generated AS must compile before host binding work.',
      loc: { file: '<assemblyscript-compile>' },
      details: {
        exitCode: proc.status,
        stderr: truncate(proc.stderr, 8000),
        stdout: truncate(proc.stdout, 8000)
      }
    });
  }

  const outputs = [];
  if (fs.existsSync(wasmFile)) outputs.push(fileRecord(wasmFile, cwd, 'wasm-smoke-output'));
  if (fs.existsSync(watFile)) outputs.push(fileRecord(watFile, cwd, 'wat-smoke-output'));

  const artifact = buildArtifact({
    cwd,
    outDir,
    status: diagnostics.length === 0 ? 'ok' : 'error',
    diagnostics,
    warnings,
    shape,
    core,
    asc,
    assemblyScriptVersion: assemblyScriptVersion(cwd),
    stagedFiles,
    outputs,
    command: {
      executable: asc.display,
      args: ascArgs.slice(1).map((arg) => path.isAbsolute(arg) ? path.relative(cwd, arg).replace(/\\/g, '/') : arg)
    },
    result: {
      warnings,
      exitCode: proc.status,
      signal: proc.signal,
      durationMs,
      stdout: truncate(proc.stdout),
      stderr: truncate(proc.stderr)
    }
  });

  return { artifact, diagnostics, outputFiles: outputs };
}

function buildArtifact(options = {}) {
  const cwd = options.cwd || process.cwd();
  return normalizeArtifact({
    version: ASSEMBLYSCRIPT_COMPILE_VERSION,
    generatedBy: options.generatedBy || PACKAGE_VERSION,
    status: options.status || 'ok',
    sourceAssemblyScriptShapeVersion: options.shape?.artifact?.version,
    sourceAssemblyScriptCoreVersion: options.core?.artifact?.version,
    sourceAssemblyScriptHandlersVersion: options.core?.handlersArtifact?.version,
    policy: {
      phase: '9E',
      sourceOfTruth: 'generated/as/*.as.ts files emitted from validated artifacts',
      reReadsSource: false,
      reInfersRouteSemantics: false,
      compiler: 'assemblyscript asc',
      compilationOnly: true,
      wasmExecution: false,
      hostBindings: false,
      witBindings: false,
      purpose: 'prove generated AssemblyScript is syntactically and type valid before local Wasm execution work'
    },
    compiler: {
      package: 'assemblyscript',
      version: options.assemblyScriptVersion,
      executable: options.asc?.display
    },
    command: options.command,
    result: options.result,
    generated: {
      inputFiles: options.stagedFiles || [],
      outputFiles: options.outputs || []
    },
    diagnostics: options.diagnostics || [],
    warnings: options.warnings || [],
    summary: {
      compiled: options.status === 'ok',
      inputFiles: (options.stagedFiles || []).length,
      outputFiles: (options.outputs || []).length,
      wasmBytes: (options.outputs || []).find((file) => file.kind === 'wasm-smoke-output')?.bytes || 0,
      watBytes: (options.outputs || []).find((file) => file.kind === 'wat-smoke-output')?.bytes || 0,
      diagnostics: (options.diagnostics || []).length,
      warnings: (options.warnings || []).length,
      wasmExecuted: false,
      hostBindings: false
    }
  }, cwd);
}

function buildAssemblyScriptCompileSmoke(assemblyScriptShape, assemblyScriptCore, options = {}) {
  return {
    version: ASSEMBLYSCRIPT_COMPILE_VERSION,
    ...runAscCompile({
      cwd: options.cwd || process.cwd(),
      outDir: options.outDir,
      assemblyScriptShape,
      assemblyScriptCore
    })
  };
}

module.exports = {
  ASSEMBLYSCRIPT_COMPILE_VERSION,
  buildAssemblyScriptCompileSmoke,
  resolveAsc
};
