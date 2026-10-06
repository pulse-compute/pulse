'use strict';

const { runtimeContract } = require('./canonical-native-context.js');

// Only this builder mutates blocks, entry maps and traversal state. Consumers
// receive completed results after loop targets and resume requirements resolve.
function buildNativeControl({
  plan, stages, stageBindings, stageSites, effectIndex, continuationIndex,
  applicationErrors, helpers, handlers, routerLocal, routerCursor,
  exprName, localName, stringHandle, fail
}) {
  const stageEntries = new Map();
  const blocks = [];
  const helperEntries = new Map();
  const protectedEntries = new Set();
  let activeBoundary;
  let activeHandler;
  let activeVisitWeight = 1;
  function block(kind, data = {}) {
    const id = blocks.length;
    blocks.push({ id, kind, boundary: activeBoundary, handlerId: activeHandler, visitWeight: activeVisitWeight, ...data });
    return id;
  }

  const fallthroughBlock = block('fail', { errorCode: runtimeContract.CANONICAL_NATIVE_ERROR_CODES.FALLTHROUGH_WITHOUT_RESULT });

  function effectRecord(effectId) {
    const index = effectIndex.get(String(effectId));
    const effect = Number.isInteger(index) ? plan.effects[index] : undefined;
    if (!effect) fail(`Native statement references unknown effect ${String(effectId)}.`, { effectId });
    return { index, effect };
  }

  function continuationState(continuationId) {
    const index = continuationIndex.get(String(continuationId));
    if (!Number.isInteger(index)) fail(`Native statement references unknown continuation ${String(continuationId)}.`, { continuationId });
    return index;
  }

  function resumeAction(effectIds, resultRecords, nextBlock) {
    const required = effectIds.map((id) => effectRecord(id).index);
    const lines = [];
    for (const record of resultRecords) {
      const { index, effect } = effectRecord(record.effectId || record.id);
      const result = effect.result || record;
      const selected = stages.has(activeHandler) && stageSites.get(index);
      if (result.mode === 'bind' || record.localId) lines.push(`${localName(result.localId || record.localId)} = ${selected ? `__pulse_stage_result(__pulse_stage_effect_${selected.site})` : `__pulse_effect_result_${index}`}`);
      else if (result.mode === 'return') lines.push(`__pulse_result = __pulse_effect_result_${index}`);
      else lines.push(`__pulse_drop(__pulse_effect_result_${index})`);
    }
    const returns = resultRecords.some((record) => {
      const { effect } = effectRecord(record.effectId || record.id);
      return (effect.result || record).mode === 'return';
    });
    return block(returns ? 'resume-return' : 'resume', { required, lines, next: nextBlock });
  }

  function suspendBlock(effectIds, continuationId, resumeBlock) {
    const effects = effectIds.map((id) => effectRecord(id));
    const lines = [];
    const payloadLines = [];
    for (const { index, effect } of effects) {
      const selected = stages.has(activeHandler) && stageSites.get(index);
      if (selected) lines.push(`__pulse_stage_prepare(__pulse_stage_effect_${selected.site})`);
      else {
        lines.push(`__pulse_effect_pending_${index} = 1`);
        lines.push(`__pulse_effect_ready_${index} = 0`);
        lines.push(`__pulse_effect_result_${index} = 0`);
      }
      const prepare = applicationErrors ? payloadLines : lines;
      prepare.push(`const payload_${index} = host_value_object()`);
      for (const input of effect.inputs || []) prepare.push(`host_value_object_set(payload_${index}, ${stringHandle(input.name)}, ${exprName(input.value)}())`);
      lines.push(`host_effect_begin(${selected ? `__pulse_stage_effect_${selected.site}` : index}, payload_${index})`);
    }
    return block('suspend', {
      lines,
      payloadLines,
      continuationState: stages.has(activeHandler)
        ? `__pulse_stage_continuation_${stageSites.get(effects[0].index).site}` : continuationState(continuationId),
      resumeBlock,
      pendingCount: effects.length
    });
  }

  let pureLoopIndex = 0;
  function pureLines(statements) {
    const lines = [];
    for (const statement of statements || []) {
      if (statement.kind === 'local') lines.push(`${localName(statement.localId)} = ${exprName(statement.value)}()`);
      else if (statement.kind === 'expression') lines.push(`__pulse_drop(${exprName(statement.expression)}())`);
      else if (statement.kind === 'break' || statement.kind === 'continue') lines.push(statement.kind);
      else if (statement.kind === 'if') {
        lines.push(`if (host_value_truthy(${exprName(statement.test)}()) != 0) {`, ...pureLines(statement.then).map(line => `  ${line}`), '} else {', ...pureLines(statement.else).map(line => `  ${line}`), '}');
      } else if (statement.kind === 'pure-loop') {
        const counter = `__pulse_iteration_${pureLoopIndex++}`;
        lines.push(`for (let ${counter}: i32 = 0; ${counter} < ${statement.maxIterations}; ${counter} += 1) {`,
          `  ${localName(statement.localId)} = host_value_number(<f64>${counter})`,
          `  if (host_value_truthy(${exprName(statement.test)}()) == 0) break`,
          ...pureLines(statement.body).map(line => `  ${line}`), '}');
      } else fail('Pure loop contains an unsupported statement.', { kind: statement.kind });
    }
    return lines;
  }

  function compileSequence(statements, nextBlock, boundary, loopTargets) {
    const previousBoundary = activeBoundary;
    activeBoundary = boundary;
    let next = nextBlock;
    for (let index = (statements || []).length - 1; index >= 0; index -= 1) {
      const statement = statements[index];
      if (statement.kind === 'helper-call') {
        const helper = helpers.get(statement.helperId);
        const resume = block('action', { lines: [`${localName(statement.localId)} = __pulse_helper_result`, '__pulse_helper_result = 0'], next });
        const lines = [`__pulse_helper_return = ${resume}`, '__pulse_helper_result = 0',
          ...statement.arguments.map((arg, i) => `const helper_arg_${i} = ${exprName(arg)}()`),
          ...helper.localIds.map(id => `${localName(id)} = 0`),
          ...helper.parameters.map((parameter, i) => `${localName(parameter.localId)} = helper_arg_${i}`),
          ...(applicationErrors ? [`__pulse_helper_error_next = ${boundary.nextIndex}`, `__pulse_helper_error_return = ${boundary.nextBlock}`] : [])];
        next = block('action', { lines, next: helperEntries.get(helper.id) });
      } else if (statement.kind === 'stage-call') {
        const stage = stages.get(statement.stageId), row = stageBindings.get(statement.registrationId);
        if (!stage || !row || activeHandler) fail('Stage call requires a validated dispatcher binding.');
        const lines = [
          `__pulse_stage_next = ${row.nextIndex}`,
          `__pulse_stage_return = ${next}`,
          `${localName(stage.inputs.nextCursorLocalId)} = host_value_number(${row.nextIndex})`,
          ...stage.localIds.map(id => `${localName(id)} = 0`),
          ...row.effectIds.flatMap((effectId, site) => [
            `__pulse_stage_effect_${site} = ${effectIndex.get(effectId)}`,
            `__pulse_stage_continuation_${site} = ${continuationState(row.continuationIds[site])}`
          ])
        ];
        next = block('action', { lines, next: stageEntries.get(stage.id) });
      } else if (statement.kind === 'handler-call') {
        const handler = handlers.get(statement.handlerId);
        if (!handler || activeHandler) fail('Private Router call must select one terminal body.', { handlerId: statement.handlerId });
        activeHandler = handler.id;
        next = compileSequence(handler.body, next, boundary, loopTargets);
        activeHandler = undefined;
      } else if (statement.kind === 'local') {
        next = block('action', { lines: [`${localName(statement.localId)} = ${exprName(statement.value)}()`], next });
      } else if (statement.kind === 'expression') {
        next = block('action', { lines: [`__pulse_drop(${exprName(statement.expression)}())`], next });
      } else if (statement.kind === 'return') {
        next = block(helpers.has(activeHandler) ? 'helper-return' : 'return', { expression: exprName(statement.value) });
      } else if (statement.kind === 'if') {
        const test = statement.test;
        const entry = applicationErrors && !boundary && test.kind === 'binary' && test.operator === '==='
          && test.left.kind === 'local' && test.left.id === routerCursor && test.right.kind === 'literal'
          && plan.routing.entries.find(entry => entry.index === test.right.value);
        if (entry) protectedEntries.add(entry.index);
        const thenBlock = compileSequence(statement.then || [], next, entry ? { nextBlock: next, nextIndex: entry.nextIndex } : boundary, loopTargets);
        const elseBlock = compileSequence(statement.else || [], next, boundary, loopTargets);
        next = block('branch', { test: exprName(statement.test), thenBlock, elseBlock });
      } else if (statement.kind === 'effect') {
        const resume = resumeAction([statement.effectId], [{ effectId: statement.effectId, ...(statement.result || {}) }], next);
        next = suspendBlock([statement.effectId], statement.continuationId, resume);
      } else if (statement.kind === 'pure-loop') {
        next = block('action', { lines: pureLines([statement]), next });
      } else if (statement.kind === 'read-loop') {
        // A helper can return before suspending on every visit. Account for the
        // complete literal-capped caller path, not just its static call site.
        const hasHelper = value => value && typeof value === 'object' &&
          (value.kind === 'helper-call' || Object.values(value).some(hasHelper));
        const previousWeight = activeVisitWeight;
        if (hasHelper(statement.body)) activeVisitWeight *= Math.max(1, statement.maxIterations + 1);
        const guard = block('branch', { test: exprName(statement.test), thenBlock: undefined, elseBlock: next });
        const increment = block('action', { lines: [`__pulse_drop(${exprName(statement.increment)}())`], next: guard });
        const body = compileSequence(statement.body, increment, boundary, { break: next, continue: increment });
        blocks[guard].thenBlock = body;
        activeVisitWeight = previousWeight;
        next = block('action', { lines: [`${localName(statement.localId)} = ${exprName(statement.initial)}()`], next: guard });
      } else if (statement.kind === 'break' || statement.kind === 'continue') {
        if (!loopTargets) fail('Loop transfer requires an enclosing read loop.', { kind: statement.kind });
        next = loopTargets[statement.kind];
      } else if (statement.kind === 'effect-group') {
        const resume = resumeAction(statement.effectIds || [], statement.results || [], next);
        next = suspendBlock(statement.effectIds || [], statement.continuationId, resume);
      } else fail(`Unsupported native statement kind ${String(statement.kind)}.`, { kind: statement.kind, statementPath: statement.statementPath });
    }
    activeBoundary = previousBoundary;
    return next;
  }

  for (const helper of helpers.values()) {
    activeHandler = helper.id;
    helperEntries.set(helper.id, compileSequence(helper.body, fallthroughBlock, applicationErrors ? {
      nextBlock: '__pulse_helper_error_return', nextIndex: '__pulse_helper_error_next'
    } : undefined));
    activeHandler = undefined;
  }
  for (const stage of stages.values()) {
    activeHandler = stage.id;
    const exit = block('stage-exit');
    stageEntries.set(stage.id, compileSequence(stage.body, exit, applicationErrors ? {
      nextBlock: '__pulse_stage_return', nextIndex: '__pulse_stage_next'
    } : undefined));
    activeHandler = undefined;
  }
  const entryBlock = compileSequence(plan.entry.body || [], fallthroughBlock);
  if (applicationErrors && (!routerCursor || !routerLocal('mode') || !routerLocal('error')
    || plan.routing.entries.some(entry => !protectedEntries.has(entry.index)))) {
    fail('Router application errors require explicit compiler-owned entry boundaries.');
  }
  const resumeRequirements = new Map();
  for (const item of blocks) if (item.kind === 'resume' || item.kind === 'resume-return') resumeRequirements.set(item.id, item.required);

  return { blocks, entryBlock, stageEntries, helperEntries, resumeRequirements };
}

function layoutNativeControl({
  blocks, stages, helpers, handlers, applicationErrors,
  routerLocal, routerCursor, localName, fail
}) {
  // Resolve Router locals through this plan, never fixed slots. The private
  // result is 0 = no error, 2 = routed, -1 = terminal host failure.
  const routeErrorLines = (nextIndex) => [
    `${localName(routerLocal('error'))} = failure`,
    `${localName(routerLocal('mode'))} = host_value_number(1.0)`,
    `${localName(routerCursor)} = host_value_number(${nextIndex})`,
    '__pulse_pending = 0; __pulse_state = 0; __pulse_result = 0'
  ];
  const errorGuard = applicationErrors ? [
    '@noinline',
    'function __pulse_route_error(nextIndex: f64, nextBlock: i32): i32 {',
    '  const failure = host_router_error_take()',
    `  if (failure < 0) { __pulse_error = ${runtimeContract.CANONICAL_NATIVE_ERROR_CODES.HOST_FAILURE}; return -1 }`,
    '  if (failure > 0) {',
    ...routeErrorLines('nextIndex').map(line => `    ${line}`),
    '    __pulse_pc = nextBlock; return 2',
    '  }',
    '  return 0',
    '}'
  ] : [];

  // Charge the pre-sharing guard footprint to the partition budget. Shrinking
  // guards must not pack more states into each optimizer unit as a side effect.
  // These lines are measured only; the shared helper is the emitted code.
  function errorGuardPartitionSize(boundary, advance) {
    return [
      '{ const failure = host_router_error_take()',
      `  if (failure < 0) { __pulse_error = ${runtimeContract.CANONICAL_NATIVE_ERROR_CODES.HOST_FAILURE}; return -1 }`,
      '  if (failure > 0) {',
      ...routeErrorLines(`${boundary.nextIndex}.0`).map(line => `    ${line}`),
      `    __pulse_pc = ${boundary.nextBlock}; ${advance}`,
      '  } }'
    ].map(line => `      ${line}`).join('\n').length;
  }

  function renderBlock(item, partitioned = false) {
    const advance = partitioned ? 'return 2' : 'continue';
    const lines = [`    case ${item.id}: {`];
    let partitionAdjustment = 0;
    const emit = (line) => lines.push(`      ${line}`);
    const checkError = () => {
      if (!item.boundary) return;
      // Chunks propagate the existing routed status directly; decoding and
      // re-encoding it here repeats branches at every guard site.
      const guard = [
        `{ const routed = __pulse_route_error(${typeof item.boundary.nextIndex === 'number' ? item.boundary.nextIndex + '.0' : '<f64>' + item.boundary.nextIndex}, ${item.boundary.nextBlock})`,
        ...(partitioned ? [
          '  if (routed != 0) return routed',
          '}'
        ] : [
          '  if (routed < 0) return routed',
          '  if (routed > 0) continue',
          '}'
        ])
      ];
      partitionAdjustment += errorGuardPartitionSize(item.boundary, advance)
        - guard.map(line => `      ${line}`).join('\n').length;
      guard.forEach(emit);
    };
    checkError();
    if (item.kind === 'stage-exit') {
      emit('__pulse_pc = __pulse_stage_return');
      emit(advance);
    } else if (item.kind === 'action') {
      for (const line of item.lines) emit(line);
      checkError();
      emit(`__pulse_pc = ${item.next}`);
      emit(advance);
    } else if (item.kind === 'branch') {
      emit(`const matched = host_value_truthy(${item.test}())`);
      checkError();
      emit(`__pulse_pc = matched != 0 ? ${item.thenBlock} : ${item.elseBlock}`);
      emit(advance);
    } else if (item.kind === 'helper-return') {
      emit(`__pulse_helper_result = ${item.expression}()`);
      checkError();
      emit('__pulse_pc = __pulse_helper_return');
      emit(advance);
    } else if (item.kind === 'return') {
      emit(`__pulse_result = ${item.expression}()`);
      checkError();
      emit('__pulse_pending = 0');
      emit(`return ${runtimeContract.CANONICAL_NATIVE_RUN_STATUS.COMPLETE}`);
    } else if (item.kind === 'suspend') {
      for (const line of item.payloadLines) emit(line);
      checkError();
      for (const line of item.lines) emit(line);
      emit(`__pulse_state = ${item.continuationState}`);
      emit(`__pulse_pc = ${item.resumeBlock}`);
      emit(`__pulse_pending = ${item.pendingCount}`);
      emit(`return ${runtimeContract.CANONICAL_NATIVE_RUN_STATUS.SUSPENDED}`);
    } else if (item.kind === 'resume' || item.kind === 'resume-return') {
      for (const line of item.lines) emit(line);
      emit('__pulse_pending = 0');
      emit('__pulse_state = 0');
      if (item.kind === 'resume-return') emit(`return ${runtimeContract.CANONICAL_NATIVE_RUN_STATUS.COMPLETE}`);
      else {
        emit(`__pulse_pc = ${item.next}`);
        emit(advance);
      }
    } else if (item.kind === 'fail') {
      emit(`__pulse_error = ${item.errorCode}`);
      emit(`return ${runtimeContract.CANONICAL_NATIVE_RUN_STATUS.FAILED}`);
    } else fail(`Unknown native block kind ${item.kind}.`, { block: item });
    lines.push('    }');
    const source = lines.join('\n');
    return { source, partitionCharacters: source.length + partitionAdjustment };
  }

  // Bound optimizer work per dispatcher function without changing plan state IDs.
  // A pure-loop state stays indivisible: these are partition targets, not an
  // absolute source/Wasm size limit on arbitrary authored expressions or loops.
  const maxChunkStates = 64;
  const maxChunkCharacters = 24000;
  const renderedBlocks = blocks.map(item => ({ item, ...renderBlock(item) }));
  const partitioned = handlers.size > 0 || stages.size > 0 || helpers.size > 0 || blocks.length > maxChunkStates
    || renderedBlocks.reduce((size, block) => size + block.partitionCharacters, 0) > maxChunkCharacters;
  const chunks = [];
  if (partitioned) {
    let chunk = [], characters = 0;
    for (const { item } of renderedBlocks) {
      const rendered = renderBlock(item, true);
      if (chunk.length && (chunk[0].handlerId !== item.handlerId || chunk.length >= maxChunkStates || characters + rendered.partitionCharacters > maxChunkCharacters)) {
        chunks.push(chunk);
        chunk = [];
        characters = 0;
      }
      chunk.push({ id: item.id, ...rendered, handlerId: item.handlerId });
      characters += rendered.partitionCharacters;
    }
    if (chunk.length) chunks.push(chunk);
  }
  const invalidProgramCounter = `__pulse_error = ${runtimeContract.CANONICAL_NATIVE_ERROR_CODES.INVALID_PROGRAM_COUNTER}; return ${runtimeContract.CANONICAL_NATIVE_RUN_STATUS.FAILED}`;
  // Pulse's @noinline transform prevents rebuilding the monolithic function.
  const stageChunks = chunks.flatMap((chunk, index) => stages.has(chunk[0].handlerId) ? [index] : []);
  const helperChunks = chunks.flatMap((chunk, index) => helpers.has(chunk[0].handlerId) ? [index] : []);
  const chunkName = index => helperChunks.includes(index) ? `__pulse_shared_helper_${helperChunks.indexOf(index)}` : stageChunks.includes(index) ? `__pulse_shared_stage_${stageChunks.indexOf(index)}` : `__pulse_chunk_${index}`;
  const dispatcherFunctions = chunks.flatMap((chunk, index) => [
    '@noinline',
    `function ${chunkName(index)}(): i32 {`,
    '  switch (__pulse_pc) {',
    ...chunk.map(block => block.source),
    `    default: ${invalidProgramCounter}`,
    '  }',
    '}'
  ]);
  // Balanced selection keeps dispatch depth logarithmic as the program grows.
  function selectChunk(first, last, indent) {
    if (first === last) return [`${indent}return ${chunkName(first)}()`];
    const middle = Math.floor((first + last) / 2);
    const upper = chunks[middle][chunks[middle].length - 1].id;
    return [
      `${indent}if (__pulse_pc <= ${upper}) {`,
      ...selectChunk(first, middle, indent + '  '),
      `${indent}} else {`,
      ...selectChunk(middle + 1, last, indent + '  '),
      `${indent}}`
    ];
  }
  if (partitioned) dispatcherFunctions.push(
    '@noinline',
    'function __pulse_step(): i32 {',
    ...selectChunk(0, chunks.length - 1, '  '),
    '}'
  );

  return {
    errorGuard, dispatcherFunctions, renderedBlocks, partitioned, chunks,
    maxChunkStates, maxChunkCharacters, invalidProgramCounter
  };
}

// Keep this check after runtime support preparation and before deferred
// expression/helper rendering, preserving the generator's failure order.
function countNativeGuardStates({ plan, blocks, handlers, helpers, stages, fail }) {
  let helperCallCount = 0;
  const countHelperCalls = (value, visits = 1) => {
    if (!value || typeof value !== 'object') return;
    if (value.kind === 'helper-call') helperCallCount += visits;
    for (const [key, child] of Object.entries(value)) countHelperCalls(child,
      value.kind === 'read-loop' && key === 'body' ? visits * Math.max(1, value.maxIterations) : visits);
  };
  countHelperCalls(plan.entry.body);
  for (const handler of handlers.values()) countHelperCalls(handler.body);
  // Sharing cannot reduce the bounded dispatcher allowance for paths that
  // visit several registrations without suspending between them.
  const guardStateCount = blocks.reduce((sum, b) => sum + b.visitWeight, 0) + blocks.filter(b => helpers.has(b.handlerId)).length * Math.max(0, helperCallCount - 1) + [...stages.values()].reduce((total, stage) =>
    total + blocks.filter(block => block.handlerId === stage.id).length * (stage.registrations.length - 1), 0);
  if (!Number.isSafeInteger(guardStateCount) || guardStateCount > Math.floor(0x7fffffff / 8)) fail('Bounded dispatcher allowance exceeds the Native counter range.');
  return guardStateCount;
}

function renderNativeRun({ guardStateCount, partitioned, renderedBlocks, invalidProgramCounter }) {
  return [
    'function __pulse_run(): i32 {',
    `  let guard: i32 = ${Math.max(64, guardStateCount * 8)}`,
    '  while (guard > 0) {',
    '    guard -= 1',
    ...(partitioned ? [
      '    const status = __pulse_step()',
      // Private status 2 advances exactly one state under the original guard.
      '    if (status != 2) return status'
    ] : [
      '    switch (__pulse_pc) {',
      ...renderedBlocks.map(block => block.source),
      `      default: ${invalidProgramCounter}`,
      '    }'
    ]),
    '  }',
    `  __pulse_error = ${runtimeContract.CANONICAL_NATIVE_ERROR_CODES.HOST_FAILURE}`,
    `  return ${runtimeContract.CANONICAL_NATIVE_RUN_STATUS.FAILED}`,
    '}',
    '',
  ];
}

module.exports = Object.freeze({
  buildNativeControl, layoutNativeControl, countNativeGuardStates, renderNativeRun
});
