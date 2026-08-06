'use strict';

const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { PACKAGE_VERSION, diagnostic, ExtractionError, sourceLoc } = require('./diagnostics.js');
const { ENV_PROFILE_NAME, SEMANTIC_ENV_KEYS, ALLOWED_ENV_METHODS } = require('./definitions/config-schema.js');
const { collectDefineConfigCalls, isTopLevelDefineConfigCall } = require('./patterns/config-define.js');
const { isEnvCall } = require('./patterns/env-lookup.js');

function scriptKindForFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.ts' || ext === '.mts' || ext === '.cts') return ts.ScriptKind.TS;
  if (ext === '.tsx') return ts.ScriptKind.TSX;
  if (ext === '.jsx') return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
}

function readSourceFile(filePath) {
  const abs = path.resolve(filePath);
  const text = fs.readFileSync(abs, 'utf8');
  return ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true, scriptKindForFile(abs));
}

function stableFileName(fileName, cwd) {
  const rel = path.relative(cwd || process.cwd(), fileName);
  return rel.startsWith('..') ? fileName : rel || path.basename(fileName);
}

function isStringLiteralLike(node) {
  return ts.isStringLiteral(node) || node.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral;
}

function nodeText(sourceFile, node) {
  return node.getText(sourceFile).trim();
}

function locForNode(sourceFile, node) {
  return sourceLoc(sourceFile, node);
}

function configDiagnostic(sourceFile, node, code, message, hint) {
  return diagnostic(sourceFile, node, code, message, hint);
}

function unwrapExpression(node) {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression?.(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function valueLiteral(value, sourceFile, node, envRef) {
  return {
    kind: 'literal',
    value,
    envRef,
    loc: node ? locForNode(sourceFile, node) : undefined
  };
}

function valueObject(props, sourceFile, node) {
  return {
    kind: 'object',
    props,
    loc: node ? locForNode(sourceFile, node) : undefined
  };
}

function valueArray(items, sourceFile, node) {
  return {
    kind: 'array',
    items,
    loc: node ? locForNode(sourceFile, node) : undefined
  };
}

function errorValue(sourceFile, node) {
  return valueLiteral(undefined, sourceFile, node);
}

function valueToPlain(node) {
  if (!node) return undefined;
  if (node.kind === 'literal') return node.value;
  if (node.kind === 'array') return node.items.map(valueToPlain).filter((value) => value !== undefined);
  if (node.kind === 'object') {
    const out = {};
    for (const [key, value] of Object.entries(node.props)) {
      const plain = valueToPlain(value);
      if (plain !== undefined) out[key] = plain;
    }
    return out;
  }
  return undefined;
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function valueGet(node, key) {
  return node && node.kind === 'object' && hasOwn(node.props, key) ? node.props[key] : undefined;
}

function collectEnvRefs(node, pathSegments = [], out = []) {
  if (!node) return out;
  if (node.kind === 'literal' && node.envRef) {
    out.push({ ...node.envRef, path: pathSegments.slice(), loc: node.loc });
    return out;
  }
  if (node.kind === 'array') {
    node.items.forEach((item, index) => collectEnvRefs(item, [...pathSegments, String(index)], out));
    return out;
  }
  if (node.kind === 'object') {
    for (const [key, value] of Object.entries(node.props)) {
      collectEnvRefs(value, [...pathSegments, key], out);
    }
  }
  return out;
}

function isSecretPath(pathSegments, envName) {
  const joinedPath = pathSegments.join('.').toLowerCase();
  const normalizedEnv = String(envName || '').toLowerCase();
  if (/(secret|password|passwd|token|credential|credentials|private|private[_-]?key|api[_-]?key|access[_-]?key)/.test(joinedPath)) {
    return true;
  }
  if (/(secret|password|passwd|token|credential|credentials|private|private[_-]?key|api[_-]?key|access[_-]?key)/.test(normalizedEnv)) {
    return true;
  }
  if (/\bkey\b/.test(joinedPath) && /(key|secret|credential|token)/.test(normalizedEnv)) {
    return true;
  }
  return false;
}

function envRefForArtifact(ref, pathSegments) {
  const secret = isSecretPath(pathSegments, ref.name);
  const base = {
    $env: ref.name,
    type: ref.type,
    resolved: ref.resolved,
    secret,
    redacted: secret
  };
  if (ref.hasFallback) {
    base.fallback = secret ? '<redacted>' : ref.fallback;
  }
  if (!secret && ref.resolved) {
    base.value = ref.value;
  }
  return base;
}

function valueToArtifact(node, pathSegments = []) {
  if (!node) return undefined;
  if (node.kind === 'literal') {
    if (!node.envRef) return node.value === undefined ? null : node.value;
    const secret = isSecretPath(pathSegments, node.envRef.name);
    if (secret || !node.envRef.resolved) {
      return envRefForArtifact(node.envRef, pathSegments);
    }
    return node.envRef.value;
  }
  if (node.kind === 'array') {
    return node.items.map((item, index) => valueToArtifact(item, [...pathSegments, String(index)]));
  }
  if (node.kind === 'object') {
    const out = {};
    for (const [key, value] of Object.entries(node.props)) {
      out[key] = valueToArtifact(value, [...pathSegments, key]);
    }
    return out;
  }
  return null;
}

function serializeEnvRefs(refs) {
  return refs.map((ref) => {
    const secret = isSecretPath(ref.path, ref.name);
    const out = {
      name: ref.name,
      type: ref.type,
      path: ref.path,
      resolved: ref.resolved,
      secret,
      redacted: secret,
      loc: ref.loc
    };
    if (ref.hasFallback) out.fallback = secret ? '<redacted>' : ref.fallback;
    if (!secret && ref.resolved) out.value = ref.value;
    return out;
  });
}

function normalizeEnvSource(envSource) {
  const values = {};
  if (!envSource) return values;
  if (typeof envSource === 'function') return normalizeEnvSource(envSource());
  if (typeof envSource !== 'object') return values;
  for (const [key, value] of Object.entries(envSource)) {
    if (value === undefined || value === null) continue;
    values[key] = value;
  }
  return values;
}

function parseBoolean(name, value) {
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw new Error(`Pulse env boolean ${name} must be one of true/false/1/0/yes/no/on/off`);
}

function envLookup(envValues, name) {
  if (!hasOwn(envValues, name)) return undefined;
  const value = envValues[name];
  if (value === undefined || value === null) return undefined;
  return String(value);
}

function propertyNameText(sourceFile, nameNode, diagnostics) {
  if (ts.isIdentifier(nameNode) || isStringLiteralLike(nameNode) || ts.isNumericLiteral(nameNode)) {
    return nameNode.text;
  }
  diagnostics.push(configDiagnostic(
    sourceFile,
    nameNode,
    'PULSEWASM_CONFIG_COMPUTED_KEY',
    'Computed config keys are not supported in PulseWasm config v1.',
    'Use static object literal keys only.'
  ));
  return nodeText(sourceFile, nameNode);
}

function literalFallbackToPlain(node) {
  if (!node || node.kind !== 'literal' || node.envRef) return undefined;
  return node.value;
}

function evaluateConfigExpression(sourceFile, node, context, pathSegments = []) {
  const diagnostics = context.diagnostics;
  const expr = unwrapExpression(node);

  if (isStringLiteralLike(expr)) {
    return valueLiteral(expr.text, sourceFile, expr);
  }
  if (ts.isNumericLiteral(expr)) {
    return valueLiteral(Number(expr.text), sourceFile, expr);
  }
  if (expr.kind === ts.SyntaxKind.TrueKeyword) {
    return valueLiteral(true, sourceFile, expr);
  }
  if (expr.kind === ts.SyntaxKind.FalseKeyword) {
    return valueLiteral(false, sourceFile, expr);
  }
  if (expr.kind === ts.SyntaxKind.NullKeyword) {
    return valueLiteral(null, sourceFile, expr);
  }
  if (ts.isIdentifier(expr) && expr.text === 'undefined') {
    return valueLiteral(undefined, sourceFile, expr);
  }
  if (ts.isPrefixUnaryExpression(expr) && ts.isNumericLiteral(expr.operand)) {
    const value = Number(expr.operand.text);
    if (expr.operator === ts.SyntaxKind.MinusToken) return valueLiteral(-value, sourceFile, expr);
    if (expr.operator === ts.SyntaxKind.PlusToken) return valueLiteral(value, sourceFile, expr);
  }

  if (ts.isObjectLiteralExpression(expr)) {
    const props = {};
    for (const prop of expr.properties) {
      if (ts.isSpreadAssignment(prop)) {
        diagnostics.push(configDiagnostic(
          sourceFile,
          prop,
          'PULSEWASM_CONFIG_SPREAD_UNSUPPORTED',
          'Object spread is not supported in PulseWasm config v1.',
          'Write the selected profile/config object explicitly.'
        ));
        continue;
      }
      if (ts.isPropertyAssignment(prop)) {
        const key = propertyNameText(sourceFile, prop.name, diagnostics);
        props[key] = evaluateConfigExpression(sourceFile, prop.initializer, context, [...pathSegments, key]);
        continue;
      }
      diagnostics.push(configDiagnostic(
        sourceFile,
        prop,
        'PULSEWASM_CONFIG_PROPERTY_UNSUPPORTED',
        'Only plain property assignments are supported in PulseWasm config v1.',
        'Do not use shorthand, methods, getters, setters, or spreads in defineConfig().'
      ));
    }
    return valueObject(props, sourceFile, expr);
  }

  if (ts.isArrayLiteralExpression(expr)) {
    const items = [];
    expr.elements.forEach((item, index) => {
      if (ts.isSpreadElement(item)) {
        diagnostics.push(configDiagnostic(
          sourceFile,
          item,
          'PULSEWASM_CONFIG_SPREAD_UNSUPPORTED',
          'Array spread is not supported in PulseWasm config v1.',
          'Write env definitions and arrays explicitly.'
        ));
        return;
      }
      items.push(evaluateConfigExpression(sourceFile, item, context, [...pathSegments, String(index)]));
    });
    return valueArray(items, sourceFile, expr);
  }

  if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr) || ts.isFunctionDeclaration(expr)) {
    diagnostics.push(configDiagnostic(
      sourceFile,
      expr,
      'PULSEWASM_CONFIG_FUNCTION_VALUE',
      'Function values inside defineConfig() are not supported in PulseWasm config v1.',
      'Profile engines and runtime functions are host/runtime concerns, not Wasm config truth.'
    ));
    return errorValue(sourceFile, expr);
  }

  if (ts.isCallExpression(expr)) {
    const envCall = context.envParamName ? isEnvCall(ts, expr.expression, context.envParamName) : null;
    if (!envCall) {
      diagnostics.push(configDiagnostic(
        sourceFile,
        expr,
        'PULSEWASM_CONFIG_DYNAMIC_CALL',
        'Only calls to the injected env resolver are supported inside defineConfig().',
        'Use literals, object/array literals, and env("NAME") / env.number(...) / env.boolean(...) / env.define(...).'
      ));
      return errorValue(sourceFile, expr);
    }

    const method = envCall.method;
    if (method !== 'string' && !ALLOWED_ENV_METHODS.has(method)) {
      diagnostics.push(configDiagnostic(
        sourceFile,
        envCall.nameNode || expr.expression,
        'PULSEWASM_CONFIG_ENV_METHOD_UNSUPPORTED',
        `Unsupported env resolver method env.${method}().`,
        'Allowed methods: env(), env.number(), env.boolean(), and env.define().'
      ));
      return errorValue(sourceFile, expr);
    }

    if (method === 'define') {
      if (expr.arguments.length !== 1) {
        diagnostics.push(configDiagnostic(
          sourceFile,
          expr,
          'PULSEWASM_CONFIG_ENV_DEFINE_ARITY',
          'env.define() expects exactly one array or object literal argument.',
          'Use env.define(["NAME"]) or env.define({ NAME: { ... } }).'
        ));
        return errorValue(sourceFile, expr);
      }
      const definition = evaluateConfigExpression(sourceFile, expr.arguments[0], context, pathSegments);
      context.envDefinitions.push({ value: valueToPlain(definition), loc: locForNode(sourceFile, expr) });
      return definition;
    }

    if (expr.arguments.length < 1 || expr.arguments.length > 2) {
      diagnostics.push(configDiagnostic(
        sourceFile,
        expr,
        'PULSEWASM_CONFIG_ENV_ARITY',
        `${method === 'string' ? 'env' : `env.${method}`}() expects one name and an optional fallback.`,
        'Use literal env names and literal fallbacks only.'
      ));
      return errorValue(sourceFile, expr);
    }

    const nameArg = unwrapExpression(expr.arguments[0]);
    if (!isStringLiteralLike(nameArg)) {
      diagnostics.push(configDiagnostic(
        sourceFile,
        nameArg,
        'PULSEWASM_CONFIG_ENV_NAME',
        'Env names must be string literals in PulseWasm config v1.',
        'Use env("NAME") rather than computed env names.'
      ));
      return errorValue(sourceFile, expr);
    }

    let fallback;
    let hasFallback = false;
    if (expr.arguments.length === 2) {
      const fallbackNode = evaluateConfigExpression(sourceFile, expr.arguments[1], { ...context, envParamName: undefined }, pathSegments);
      fallback = literalFallbackToPlain(fallbackNode);
      hasFallback = true;
      const expectedType = method === 'number' ? 'number' : method === 'boolean' ? 'boolean' : 'string';
      if (fallback === undefined || typeof fallback !== expectedType) {
        diagnostics.push(configDiagnostic(
          sourceFile,
          expr.arguments[1],
          'PULSEWASM_CONFIG_ENV_FALLBACK',
          `${method === 'string' ? 'env' : `env.${method}`}() fallback must be a ${expectedType} literal.`,
          'Keep fallback values scalar and literal.'
        ));
      }
    }

    const name = nameArg.text;
    const raw = envLookup(context.envValues, name);
    let resolved = raw !== undefined;
    let value;
    try {
      if (method === 'number') {
        value = raw === undefined ? fallback : Number(raw);
        if (value !== undefined && !Number.isFinite(value)) {
          throw new Error(`Pulse env number ${name} must be a finite number`);
        }
      } else if (method === 'boolean') {
        value = raw === undefined ? fallback : parseBoolean(name, raw);
      } else {
        value = raw === undefined ? fallback : raw;
      }
    } catch (error) {
      diagnostics.push(configDiagnostic(
        sourceFile,
        expr,
        'PULSEWASM_CONFIG_ENV_VALUE_INVALID',
        error.message,
        'Pass a valid env value or use a literal fallback with the correct type.'
      ));
      value = fallback;
    }
    if (!resolved && hasFallback && fallback !== undefined) resolved = true;

    const envRef = {
      name,
      type: method === 'string' ? 'string' : method,
      value,
      fallback,
      hasFallback,
      resolved,
      loc: locForNode(sourceFile, expr)
    };
    return valueLiteral(value, sourceFile, expr, envRef);
  }

  diagnostics.push(configDiagnostic(
    sourceFile,
    expr,
    'PULSEWASM_CONFIG_UNSUPPORTED_EXPRESSION',
    `Unsupported config expression: ${nodeText(sourceFile, expr)}`,
    'PulseWasm config v1 supports only literals, object/array literals, and bounded env resolver calls.'
  ));
  return errorValue(sourceFile, expr);
}

function findDefineConfigCall(sourceFile, diagnostics) {
  const calls = collectDefineConfigCalls(ts, sourceFile);

  if (calls.length === 0) {
    diagnostics.push({
      code: 'PULSEWASM_CONFIG_DEFINECONFIG_MISSING',
      message: 'No defineConfig(...) call was found.',
      hint: 'Export or declare a single top-level defineConfig(...) call.',
      loc: { file: sourceFile.fileName }
    });
    return undefined;
  }
  if (calls.length > 1) {
    for (const call of calls) {
      diagnostics.push(configDiagnostic(
        sourceFile,
        call,
        'PULSEWASM_CONFIG_MULTIPLE_DEFINECONFIG',
        'Multiple defineConfig(...) calls are not supported in PulseWasm config v1.',
        'Use one static config declaration per build.'
      ));
    }
    return undefined;
  }
  const call = calls[0];
  if (!isTopLevelDefineConfigCall(ts, sourceFile, call)) {
    diagnostics.push(configDiagnostic(
      sourceFile,
      call,
      'PULSEWASM_CONFIG_DEFINECONFIG_NOT_TOP_LEVEL',
      'defineConfig(...) must be a top-level declaration or default export.',
      'Do not hide config creation inside functions, conditionals, or helper calls.'
    ));
    return undefined;
  }
  return call;
}

function configFactoryBodyExpression(sourceFile, factory, diagnostics) {
  if (factory.modifiers && factory.modifiers.some((mod) => mod.kind === ts.SyntaxKind.AsyncKeyword)) {
    diagnostics.push(configDiagnostic(
      sourceFile,
      factory,
      'PULSEWASM_CONFIG_ASYNC_FACTORY',
      'Async config factories are not supported in PulseWasm config v1.',
      'defineConfig must be synchronously and statically resolvable.'
    ));
  }
  if (factory.parameters.length !== 1 || !ts.isIdentifier(factory.parameters[0].name)) {
    diagnostics.push(configDiagnostic(
      sourceFile,
      factory,
      'PULSEWASM_CONFIG_FACTORY_SHAPE',
      'Config factories must accept exactly one identifier parameter.',
      'Use defineConfig((env) => ({ ... })).'
    ));
    return undefined;
  }

  if (ts.isArrowFunction(factory) && !ts.isBlock(factory.body)) {
    return { envParamName: factory.parameters[0].name.text, body: factory.body };
  }

  const body = factory.body;
  if (!body || !ts.isBlock(body)) {
    diagnostics.push(configDiagnostic(
      sourceFile,
      factory,
      'PULSEWASM_CONFIG_FACTORY_SHAPE',
      'Config factory bodies must return one object literal.',
      'Use defineConfig((env) => ({ ... })) or a single return statement.'
    ));
    return undefined;
  }
  if (body.statements.length !== 1 || !ts.isReturnStatement(body.statements[0]) || !body.statements[0].expression) {
    diagnostics.push(configDiagnostic(
      sourceFile,
      body,
      'PULSEWASM_CONFIG_FACTORY_SHAPE',
      'Config factory blocks must contain exactly one return statement.',
      'Do not declare local variables or run arbitrary code in defineConfig().'
    ));
    return undefined;
  }
  return { envParamName: factory.parameters[0].name.text, body: body.statements[0].expression };
}

function evaluateDefineConfigCall(sourceFile, call, context) {
  if (call.arguments.length !== 1) {
    context.diagnostics.push(configDiagnostic(
      sourceFile,
      call,
      'PULSEWASM_CONFIG_DEFINECONFIG_ARITY',
      'defineConfig() expects exactly one object literal or config factory.',
      'Use defineConfig({ ... }) or defineConfig((env) => ({ ... })).'
    ));
    return errorValue(sourceFile, call);
  }

  const arg = unwrapExpression(call.arguments[0]);
  if (ts.isObjectLiteralExpression(arg)) {
    return evaluateConfigExpression(sourceFile, arg, { ...context, envParamName: undefined }, []);
  }
  if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) {
    const factory = configFactoryBodyExpression(sourceFile, arg, context.diagnostics);
    if (!factory) return errorValue(sourceFile, arg);
    return evaluateConfigExpression(sourceFile, factory.body, { ...context, envParamName: factory.envParamName }, []);
  }

  context.diagnostics.push(configDiagnostic(
    sourceFile,
    arg,
    'PULSEWASM_CONFIG_DEFINECONFIG_INPUT',
    'defineConfig() only accepts an object literal or a one-argument config factory.',
    'Do not pass imported objects, computed values, promises, or helper-produced config.'
  ));
  return errorValue(sourceFile, arg);
}

function pathIsUnder(pathSegments, basePath) {
  if (pathSegments.length < basePath.length) return false;
  for (let i = 0; i < basePath.length; i += 1) {
    if (pathSegments[i] !== basePath[i]) return false;
  }
  return true;
}

function pathStartsWithProfile(pathSegments, profileName) {
  return pathSegments.length >= 2 && pathSegments[0] === 'profiles' && pathSegments[1] === profileName;
}

function validateEnvRefBoundaries(sourceFile, refs, activeProfileName, diagnostics) {
  for (const ref of refs) {
    const first = ref.path[0];
    if (first && SEMANTIC_ENV_KEYS.has(first)) {
      diagnostics.push({
        code: 'PULSEWASM_CONFIG_ENV_SEMANTIC_LEAK',
        message: `Env lookup ${ref.name} is not allowed to define route/compiler semantics at ${ref.path.join('.')}.`,
        hint: 'Use literal entry/rootRouter/route/handler semantics. env() may only resolve profile values and PULSE_PROFILE selection.',
        loc: ref.loc
      });
    }
    if (first === 'profile' && ref.name !== ENV_PROFILE_NAME) {
      diagnostics.push({
        code: 'PULSEWASM_CONFIG_PROFILE_ENV_NAME',
        message: `Profile selection must use ${ENV_PROFILE_NAME}, not ${ref.name}.`,
        hint: `Use profile: env("${ENV_PROFILE_NAME}", "local") or pass --profile explicitly.`,
        loc: ref.loc
      });
    }
    if (isSecretPath(ref.path, ref.name) && ref.hasFallback) {
      diagnostics.push({
        code: 'PULSEWASM_CONFIG_SECRET_FALLBACK',
        message: `Secret env lookup ${ref.name} at ${ref.path.join('.')} has a literal fallback.`,
        hint: 'Do not place secret fallback values in source. Resolve secrets through env at runtime/build boundaries only.',
        loc: ref.loc
      });
    }
    if (activeProfileName && pathStartsWithProfile(ref.path, activeProfileName) && !isSecretPath(ref.path, ref.name) && !ref.resolved) {
      diagnostics.push({
        code: 'PULSEWASM_CONFIG_UNRESOLVED_ENV',
        message: `Active profile env lookup ${ref.name} at ${ref.path.join('.')} is unresolved.`,
        hint: 'Provide the env value, add a non-secret literal fallback, or move it into a secret-bearing config key if it is intentionally runtime-resolved.',
        loc: ref.loc
      });
    }
  }
}

function validateNoRouteSemanticKeysInProfiles(rootNode, diagnostics) {
  const profiles = valueGet(rootNode, 'profiles');
  if (!profiles || profiles.kind !== 'object') return;

  function walk(node, pathSegments) {
    if (!node || node.kind !== 'object') return;
    for (const [key, value] of Object.entries(node.props)) {
      if (SEMANTIC_ENV_KEYS.has(key)) {
        diagnostics.push({
          code: 'PULSEWASM_CONFIG_ROUTE_SEMANTIC_KEY',
          message: `Profile config key ${[...pathSegments, key].join('.')} is reserved for route/compiler semantics.`,
          hint: 'Profiles may configure runtime values, but they may not define routes, routers, handlers, mounts, or middleware.',
          loc: value.loc || node.loc
        });
      }
      walk(value, [...pathSegments, key]);
    }
  }
  walk(profiles, ['profiles']);
}

function validateConfigV2RootBoundary(rootNode, diagnostics) {
  const reservedRootKeys = new Set(['target', 'runtime', 'json', 'backends', 'timeouts', 'assets', 'broadcaster', 'hostCapabilities', 'deployment']);
  if (!rootNode || rootNode.kind !== 'object') return;
  for (const key of Object.keys(rootNode.props || {})) {
    if (!reservedRootKeys.has(key)) continue;
    const value = rootNode.props[key];
    diagnostics.push({
      code: 'PULSEWASM_CONFIG_PROFILE_RUNTIME_KEY_REQUIRED',
      message: `Root config key ${key} belongs under profiles.<name>.runtime in PulseWasm config v2.`,
      hint: 'Root config defines topology only: entry, rootRouter, profiles. Runtime/deployment/payload/capability settings belong to the selected profile runtime object.',
      loc: value.loc || rootNode.loc
    });
  }
}

function selectProfileName(rootNode, rootPlain, options, diagnostics) {
  const profilesPlain = rootPlain && typeof rootPlain === 'object' ? rootPlain.profiles : undefined;
  if (!profilesPlain || typeof profilesPlain !== 'object' || Array.isArray(profilesPlain)) {
    return { selectedProfile: null, profileSource: 'none' };
  }

  const keys = Object.keys(profilesPlain);
  let selectedProfile;
  let profileSource;
  if (options.profile) {
    selectedProfile = options.profile;
    profileSource = 'cli';
  } else if (options.envValues && options.envValues[ENV_PROFILE_NAME] !== undefined && options.envValues[ENV_PROFILE_NAME] !== null && String(options.envValues[ENV_PROFILE_NAME]) !== '') {
    selectedProfile = String(options.envValues[ENV_PROFILE_NAME]);
    profileSource = 'env';
  } else if (typeof rootPlain.profile === 'string' && rootPlain.profile !== '') {
    selectedProfile = rootPlain.profile;
    profileSource = 'config';
  } else if (hasOwn(profilesPlain, 'local')) {
    selectedProfile = 'local';
    profileSource = 'default-local';
  } else {
    selectedProfile = keys[0] || null;
    profileSource = 'default-first';
  }

  if (!selectedProfile || !hasOwn(profilesPlain, selectedProfile)) {
    diagnostics.push({
      code: 'PULSEWASM_CONFIG_PROFILE_NOT_FOUND',
      message: `Pulse config profile ${selectedProfile || '<empty>'} is not defined.`,
      hint: `Available profiles: ${keys.join(', ') || '<none>'}`,
      loc: valueGet(rootNode, 'profiles')?.loc || rootNode.loc
    });
  }
  return { selectedProfile, profileSource };
}

function resolveConfigSourceFile(sourceFile, options = {}) {
  const cwd = options.cwd || process.cwd();
  const diagnostics = [];
  const envValues = normalizeEnvSource(options.env || options.envSource);
  const envDefinitions = [];

  const call = findDefineConfigCall(sourceFile, diagnostics);
  let rootNode = valueObject({}, sourceFile, sourceFile);
  if (call) {
    rootNode = evaluateDefineConfigCall(sourceFile, call, {
      diagnostics,
      envValues,
      envDefinitions,
      envParamName: undefined
    });
  }

  const allEnvRefs = collectEnvRefs(rootNode);
  const rootPlain = valueToPlain(rootNode) || {};
  const { selectedProfile, profileSource } = selectProfileName(rootNode, rootPlain, { ...options, envValues }, diagnostics);
  validateNoRouteSemanticKeysInProfiles(rootNode, diagnostics);
  validateConfigV2RootBoundary(rootNode, diagnostics);
  validateEnvRefBoundaries(sourceFile, allEnvRefs, selectedProfile, diagnostics);

  if (diagnostics.length > 0) {
    throw new ExtractionError(diagnostics);
  }

  const profilePath = selectedProfile ? ['profiles', selectedProfile] : [];
  const activeProfileNode = selectedProfile ? valueGet(valueGet(rootNode, 'profiles'), selectedProfile) : rootNode;
  const activeProfilePlain = plainObject(valueToPlain(activeProfileNode));
  const activeProfileRefs = selectedProfile
    ? allEnvRefs.filter((ref) => pathIsUnder(ref.path, profilePath))
    : allEnvRefs;
  const entry = typeof rootPlain.entry === 'string' ? rootPlain.entry : undefined;
  const rootRouter = typeof rootPlain.rootRouter === 'string' ? rootPlain.rootRouter : undefined;
  const runtime = plainObject(activeProfilePlain.runtime);
  const payload = plainObject(runtime.payload);
  const capabilities = plainObject(runtime.capabilities);
  const json = plainObject(payload.json);
  const body = plainObject(payload.body);
  const backends = plainObject(capabilities.backends || runtime.backends);
  const target = runtime.engine === 'js' ? 'js' : 'wasm';
  const emit = Array.isArray(activeProfilePlain.emit) ? activeProfilePlain.emit : undefined;
  const outDir = typeof activeProfilePlain.outDir === 'string' ? activeProfilePlain.outDir : undefined;

  const artifact = {
    version: 'pulsewasm.resolved-config.v2',
    generatedBy: PACKAGE_VERSION,
    source: stableFileName(sourceFile.fileName, cwd),
    profile: selectedProfile,
    entry,
    rootRouter,
    runtime: valueToArtifact(valueGet(activeProfileNode, 'runtime'), profilePath.concat('runtime')) || {},
    activeProfile: valueToArtifact(activeProfileNode, profilePath),
    config: valueToArtifact(rootNode, []),
    env: {
      definitions: envDefinitions,
      references: serializeEnvRefs(allEnvRefs),
      activeProfileReferences: serializeEnvRefs(activeProfileRefs)
    },
    secretPolicy: {
      mode: 'redact-secret-like-env-values',
      redacted: serializeEnvRefs(allEnvRefs).filter((ref) => ref.secret).map((ref) => ({
        name: ref.name,
        path: ref.path,
        resolved: ref.resolved
      }))
    }
  };

  return {
    sourceFile,
    artifact,
    entry,
    rootRouter,
    target,
    runtime,
    json,
    body,
    backends,
    outDir,
    emit,
    selectedProfile,
    profileSource,
    diagnostics: []
  };
}

function resolveConfigFromFile(filePath, options = {}) {
  const sourceFile = readSourceFile(filePath);
  return resolveConfigSourceFile(sourceFile, options);
}

module.exports = {
  ENV_PROFILE_NAME,
  resolveConfigFromFile,
  resolveConfigSourceFile,
  valueToPlain,
  valueToArtifact,
  isSecretPath
};
