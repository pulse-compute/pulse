#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { run, parseJson, repoRoot } = require('../cli/helpers.cjs');
const fastlyRuntime = require(
  '../../../packages/provider-fastly/src/runtime/canonical-api-runtime.js'
);

const projectRoot = path.join(
  repoRoot,
  'examples',
  '05-fastly-capabilities'
);
const outName = '.pulse-grip-build';
const dist = path.join(projectRoot, outName);

async function removeGeneratedOutput() {
  for (const delayMs of [0, 100, 250, 500, 1000]) {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    fs.rmSync(dist, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50
    });
  }
  assert.equal(
    fs.existsSync(dist),
    false,
    `generated GRIP output survived cleanup: ${dist}`
  );
}

async function main() {
  fs.rmSync(dist, { recursive: true, force: true });
  try {
    const inspected = parseJson(
      run(['inspect', '--json'], projectRoot, { timeout: 60000 })
    );
    assert.equal(inspected.status, 'ok');
    assert.equal(inspected.project.provider, 'fastly');
    assert.deepEqual(
      inspected.compiler.capabilities.filter((entry) => entry.startsWith('grip.')),
      ['grip.broadcast']
    );
    const packageEffects = inspected.compiler.effects.filter(
      (entry) => entry.package === '@pulse-compute/grip'
    );
    assert.deepEqual(
      packageEffects.map((entry) => entry.kind),
      ['grip.broadcast']
    );
    const gripPlan = inspected.compiler.providerLowering.operations.filter(
      (entry) => entry.kind === 'grip'
    );
    assert.deepEqual(
      gripPlan.map((entry) => entry.lowering),
      ['fastly.grip.publish-control']
    );
    assert.equal(
      gripPlan.every((entry) => entry.package === '@pulse-compute/grip'),
      true
    );

    const tested = parseJson(
      run(['test', '--json'], projectRoot, { timeout: 60000 })
    );
    assert.deepEqual(tested.summary, {
      total: 4,
      passed: 4,
      failed: 0
    });
    const broadcastCase = tested.cases.find(
      (entry) => entry.name === 'grip-broadcast'
    );
    assert.equal(broadcastCase.response.status, 202);
    assert.equal(broadcastCase.effects, 1);

    const built = parseJson(
      run(
        ['build', '--out', outName, '--json'],
        projectRoot,
        { timeout: 180000 }
      )
    );
    assert.equal(built.status, 'built');
    const wasmFile = path.join(dist, 'bin', 'main.wasm');
    const wasm = fs.readFileSync(wasmFile);
    assert.equal(wasm.subarray(0, 8).toString('hex'), '0061736d01000000');
    assert.ok(wasm.length > 1024);
    const fastlyBuild = JSON.parse(
      fs.readFileSync(path.join(dist, 'fastly-build.json'), 'utf8')
    );
    assert.equal(fastlyBuild.compiledWasmPresent, true);
    assert.equal(fastlyBuild.wasm.bytes, wasm.length);
    assert.equal(
      fastlyBuild.wasm.sha256,
      crypto.createHash('sha256').update(wasm).digest('hex')
    );
    assert.deepEqual(
      fastlyBuild.grip.operations.map((entry) => `grip.${entry.operation}`),
      ['grip.broadcast']
    );

    const generatedHandler = fs.readFileSync(
      path.join(dist, 'canonical-handler.cjs'),
      'utf8'
    );
    assert.doesNotMatch(
      generatedHandler,
      /(?:from\s+["']@pulse-compute\/grip|require\(["']@pulse-compute\/grip|grip\.broadcast\()/
    );
    const imports = WebAssembly.Module.imports(new WebAssembly.Module(wasm));
    assert.ok(
      imports.some(
        (entry) => entry.module === 'fastly_abi' && entry.name === 'init'
      )
    );
    assert.equal(
      imports.some((entry) => /pulse_host|wasi|js[_-]?compute/i.test(
        `${entry.module}:${entry.name}`
      )),
      false
    );

    const program = require(path.join(dist, 'canonical-handler.cjs'));
    const bindings = inspected.project.providerConfig.bindings;
    const published = await fastlyRuntime.executeCanonicalProgram(program, {
      executionId: 'grip:broadcast',
      bindings,
      request: {
        method: 'POST',
        path: '/publish',
        url: 'https://pulse.test/publish',
        headers: []
      },
      secrets: { GRIP_TOKEN: 'runtime-grip-secret' },
      grip: {
        publishEndpoint: 'https://publisher.example.com/publish',
        authentication: {
          scheme: 'bearer',
          secretRef: 'GRIP_TOKEN'
        }
      },
      fetches: {
        'POST https://publisher.example.com/publish': {
          status: 202,
          value: { accepted: true, messageId: 'message-1' }
        }
      }
    });
    assert.equal(published.response.status, 202);
    assert.deepEqual(JSON.parse(published.response.body), { accepted: true });
    assert.deepEqual(published.providerMetadata.grip.broadcasts, [{
      channel: 'events:demo',
      accepted: true,
      status: 202
    }]);

    const compilerCore = fs.readFileSync(
      path.join(
        repoRoot,
        'wasm',
        'packages',
        'compiler',
        'src',
        'canonical-api-compiler.js'
      ),
      'utf8'
    );
    assert.doesNotMatch(
      compilerCore,
      /@pulse-compute\/grip|grip\.broadcast/,
      'compiler core must remain GRIP-agnostic'
    );

    console.log(
      'ok - the consolidated Fastly example proves package-root GRIP broadcast lowering'
    );
  } finally {
    await removeGeneratedOutput();
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
