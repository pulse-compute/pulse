'use strict';

function loadAssetsContracts() {
  try {
    return require('@pulse-compute/wasm-contracts/assets/contracts');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../../../wasm/packages/contracts/src/assets/contracts.js');
    }
    throw error;
  }
}

function loadDiagnostics() {
  try {
    return require('@pulse-compute/wasm-contracts/diagnostics');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('@pulse-compute/wasm-contracts')) {
      return require('../../../../wasm/packages/contracts/src/diagnostics.js');
    }
    throw error;
  }
}

const assetsContracts = loadAssetsContracts();
const { normalizeDiagnostic } = loadDiagnostics();

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]));
  return value;
}

function normalizeHeaders(headers) {
  if (!headers) return [];
  if (Array.isArray(headers)) {
    return headers
      .filter((pair) => pair && pair[0] !== undefined && pair[1] !== undefined)
      .map((pair) => [String(pair[0]), String(pair[1])]);
  }
  if (typeof headers[Symbol.iterator] === 'function' && typeof headers !== 'string') {
    return Array.from(headers, ([name, value]) => [String(name), String(value)]);
  }
  return Object.entries(headers).map(([name, value]) => [String(name), String(value)]);
}

function headerValue(headers, name) {
  const lower = String(name).toLowerCase();
  const found = normalizeHeaders(headers).find(([key]) => String(key).toLowerCase() === lower);
  return found ? found[1] : undefined;
}

function setHeader(headers, name, value) {
  const out = normalizeHeaders(headers).filter(([key]) => String(key).toLowerCase() !== String(name).toLowerCase());
  if (value !== undefined && value !== null) out.push([String(name), String(value)]);
  return out;
}

function appendMissingHeader(headers, name, value) {
  if (headerValue(headers, name) !== undefined) return headers;
  return headers.concat([[String(name), String(value)]]);
}

function normalizeKey(key) {
  const text = String(key || '');
  return text.startsWith('/') ? text : `/${text}`;
}

function normalizeAssetRecord(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string' || Buffer.isBuffer(value)) {
    return { status: 200, body: value, headers: [] };
  }
  if (typeof value === 'object') {
    return {
      status: value.status || 200,
      body: value.body !== undefined ? value.body : value.text !== undefined ? value.text : value.content,
      headers: normalizeHeaders(value.headers),
      cacheControl: value.cacheControl,
      contentType: value.contentType,
      payloadMode: value.payloadMode
    };
  }
  return { status: 200, body: String(value), headers: [] };
}

function normalizeStores(stores) {
  const out = new Map();
  for (const [storeName, records] of Object.entries(stores || {})) {
    const byKey = new Map();
    for (const [key, value] of Object.entries(records || {})) {
      byKey.set(normalizeKey(key), normalizeAssetRecord(value));
    }
    out.set(String(storeName), byKey);
  }
  return out;
}

function normalizePlan(input) {
  const artifact = input && input.artifact ? input.artifact : input;
  if (!artifact || typeof artifact !== 'object') return undefined;
  return {
    ...artifact,
    entries: Array.isArray(artifact.entries) ? artifact.entries.map(clone) : [],
    payloadModes: artifact.payloadModes ? clone(artifact.payloadModes) : {
      classification: assetsContracts.assetsPayloadModeClassification(),
      responsePolicy: clone(assetsContracts.ASSETS_RESPONSE_POLICY)
    }
  };
}

function entriesFromPlan(plan) {
  return (plan && Array.isArray(plan.entries) ? plan.entries : [])
    .filter((entry) => entry && entry.status !== 'unsupported' && entry.lookup && entry.lookup.store && entry.lookup.key)
    .map(clone);
}

function createDefaultStoresFromPlan(plan) {
  const stores = {};
  for (const entry of entriesFromPlan(plan)) {
    const lookup = entry.lookup;
    const store = lookup.store;
    const key = normalizeKey(lookup.key);
    if (!stores[store]) stores[store] = {};
    if (!stores[store][key]) {
      stores[store][key] = {
        status: entry.response && entry.response.status ? entry.response.status : 200,
        body: `asset:${store}:${key}`,
        headers: [
          ['Content-Type', 'text/plain; charset=utf-8'],
          ['X-PulseWasm-Asset-Store', store],
          ['X-PulseWasm-Asset-Key', key]
        ],
        cacheControl: lookup.cacheControl
      };
    }
  }
  return stores;
}

function makeDiagnostic(code, message, severity, details) {
  return normalizeDiagnostic({
    phase: 'node-assets-provider',
    severity: severity || 'error',
    code,
    message,
    hint: details && details.hint,
    details,
    loc: { file: '<node-assets-provider>' }
  });
}

function unsupportedMethodResult(method) {
  return {
    status: 405,
    kind: 'empty',
    headers: [['Allow', assetsContracts.ASSETS_ALLOWED_METHODS.join(', ')]],
    body: undefined,
    diagnostics: [makeDiagnostic(
      assetsContracts.ASSETS_DIAGNOSTIC_CODES.UNSUPPORTED_METHOD,
      `Node assets provider proof only accepts ${assetsContracts.ASSETS_ALLOWED_METHODS.join(' / ')} requests.`,
      'error',
      { method, allowedMethods: assetsContracts.ASSETS_ALLOWED_METHODS }
    )]
  };
}

function reservedBinaryResult(entry) {
  return {
    status: 501,
    kind: 'empty',
    headers: [['Content-Type', 'text/plain; charset=utf-8']],
    body: undefined,
    entryId: entry && entry.id,
    diagnostics: [makeDiagnostic(
      assetsContracts.ASSETS_DIAGNOSTIC_CODES.BINARY_BODY_RESERVED,
      'Node assets provider proof explicitly rejects binary-buffer assets until the binary body ABI is implemented.',
      'error',
      { payloadMode: 'binary-buffer', status: 'reserved-with-diagnostic' }
    )]
  };
}

function unsupportedPayloadResult(entry, payloadMode) {
  return {
    status: 415,
    kind: 'empty',
    headers: [['Content-Type', 'text/plain; charset=utf-8']],
    body: undefined,
    entryId: entry && entry.id,
    diagnostics: [makeDiagnostic(
      'PULSEWASM_ASSETS_PAYLOAD_MODE_UNSUPPORTED',
      `Node assets provider proof cannot serve assets payload mode ${JSON.stringify(payloadMode)}.`,
      'error',
      { payloadMode }
    )]
  };
}

function notFoundResult(entry, request) {
  const lookup = entry && entry.lookup ? entry.lookup : {};
  const passThrough = lookup.passThroughOn404 !== false;
  const headers = [
    ['Content-Type', 'text/plain; charset=utf-8'],
    ['X-PulseWasm-Asset-Miss', '1']
  ];
  const body = passThrough || String(request.method || 'GET').toUpperCase() === 'HEAD'
    ? undefined
    : `asset not found:${lookup.store || '<unknown>'}:${normalizeKey(lookup.key || request.path || '/')}`;
  return {
    status: 404,
    kind: body === undefined ? 'empty' : 'text',
    headers,
    body,
    passThroughOn404: passThrough,
    entryId: entry && entry.id,
    diagnostics: [makeDiagnostic(
      assetsContracts.ASSETS_DIAGNOSTIC_CODES.NODE_PROVIDER_ASSET_NOT_FOUND,
      'Node assets provider proof could not resolve the static store/key from the lowering plan.',
      'info',
      { store: lookup.store, key: lookup.key, path: request.path, passThroughOn404: passThrough }
    )]
  };
}

function resolveAsset(stores, store, key) {
  const byKey = stores.get(String(store));
  if (!byKey) return undefined;
  return byKey.get(normalizeKey(key)) || byKey.get(String(key));
}

function responseStatus(entry, asset) {
  if (entry && entry.response && entry.response.status) return entry.response.status;
  return asset && asset.status ? asset.status : 200;
}

function assetHeaders(entry, asset) {
  const lookup = entry.lookup || {};
  let headers = normalizeHeaders(asset && asset.headers);
  headers = appendMissingHeader(headers, 'Content-Type', (asset && asset.contentType) || 'text/plain; charset=utf-8');
  headers = setHeader(headers, 'X-PulseWasm-Asset-Store', lookup.store);
  headers = setHeader(headers, 'X-PulseWasm-Asset-Key', normalizeKey(lookup.key));
  const cacheControl = lookup.cacheControl || (asset && asset.cacheControl);
  if (cacheControl) headers = setHeader(headers, 'Cache-Control', cacheControl);
  return headers;
}

function bodyText(asset) {
  const body = asset && asset.body !== undefined ? asset.body : '';
  return Buffer.isBuffer(body) ? body.toString('utf8') : String(body);
}

function streamFromText(text) {
  return { chunks: [String(text)] };
}

function payloadModeForEntry(entry, asset) {
  return (entry && entry.response && entry.response.payloadMode) ||
    (entry && entry.lookup && entry.lookup.payloadMode) ||
    (asset && asset.payloadMode) ||
    'text-response-body';
}

function matchEntry(entries, request) {
  const method = String(request.method || 'GET').toUpperCase();
  const path = normalizeKey(request.path || '/');
  const candidates = entries.filter((entry) => normalizeKey(entry.lookup.key) === path);
  return candidates.find((entry) => String(entry.lookup.method || 'GET').toUpperCase() === method) ||
    (method === 'HEAD' ? candidates.find((entry) => String(entry.lookup.method || 'GET').toUpperCase() === 'GET') : undefined) ||
    candidates[0];
}

function createNodeAssetsProvider(options = {}) {
  const plan = normalizePlan(options.plan || options.assetsLoweringPlan);
  const diagnostics = [];
  if (!plan) {
    diagnostics.push(makeDiagnostic(
      assetsContracts.ASSETS_DIAGNOSTIC_CODES.NODE_PROVIDER_PLAN_REQUIRED,
      'Node assets provider proof requires an assets-lowering-plan artifact.',
      'error',
      { hint: 'Emit --assets-lowering-plan before invoking the Node assets provider proof.' }
    ));
  }
  const entries = entriesFromPlan(plan);
  const stores = normalizeStores(options.stores || createDefaultStoresFromPlan(plan));

  function executeRequest(input = {}) {
    const request = {
      method: String(input.method || 'GET').toUpperCase(),
      path: normalizeKey(input.path || input.key || '/')
    };
    if (!assetsContracts.ASSETS_ALLOWED_METHODS.includes(request.method)) return unsupportedMethodResult(request.method);
    const entry = matchEntry(entries, request);
    if (!entry) return notFoundResult({ lookup: { key: request.path, store: '<none>', passThroughOn404: true } }, request);
    const asset = resolveAsset(stores, entry.lookup.store, entry.lookup.key);
    if (!asset) return notFoundResult(entry, request);
    const payloadMode = payloadModeForEntry(entry, asset);
    if (payloadMode === 'binary-buffer') return reservedBinaryResult(entry);
    const mode = assetsContracts.assetsPayloadMode(payloadMode);
    if (mode && mode.status === 'unsupported') return unsupportedPayloadResult(entry, payloadMode);
    const headers = assetHeaders(entry, asset);
    const status = responseStatus(entry, asset);
    if (request.method === 'HEAD') {
      return { status, kind: 'empty', headers, body: undefined, entryId: entry.id, lookup: clone(entry.lookup), diagnostics: [] };
    }
    if (payloadMode === 'stream-pass-through-response') {
      return {
        status,
        kind: 'stream',
        headers,
        bodyStream: streamFromText(bodyText(asset)),
        entryId: entry.id,
        lookup: clone(entry.lookup),
        payloadMode,
        providerStreamWired: true,
        diagnostics: []
      };
    }
    return {
      status,
      kind: 'text',
      headers,
      body: bodyText(asset),
      entryId: entry.id,
      lookup: clone(entry.lookup),
      payloadMode,
      diagnostics: []
    };
  }

  return {
    version: assetsContracts.ASSETS_NODE_PROVIDER_RUNTIME_VERSION,
    provider: 'node',
    mode: options.mode || 'local-static-fixture',
    plan,
    entries: entries.map(clone),
    diagnostics,
    executeRequest,
    lookup(store, key) { return resolveAsset(stores, store, key); },
    stores
  };
}


function stripLeadingSlash(value) {
  return normalizeKey(value).replace(/^\/+/, '');
}

function contentTypeForAssetPath(file) {
  const ext = String(file || '').split('.').pop().toLowerCase();
  if (ext === 'html') return 'text/html; charset=utf-8';
  if (ext === 'js' || ext === 'mjs' || ext === 'cjs') return 'application/javascript; charset=utf-8';
  if (ext === 'css') return 'text/css; charset=utf-8';
  if (ext === 'json') return 'application/json; charset=utf-8';
  if (ext === 'txt' || ext === 'md') return 'text/plain; charset=utf-8';
  return 'text/plain; charset=utf-8';
}

function assetConfigFromOptions(options = {}) {
  const resolved = options.resolvedConfig && (options.resolvedConfig.artifact || options.resolvedConfig);
  return options.assetConfig ||
    options.assets ||
    (options.config && options.config.assets) ||
    (options.config && options.config.runtime && options.config.runtime.assets) ||
    (resolved && resolved.runtime && resolved.runtime.assets) ||
    (resolved && resolved.config && resolved.config.runtime && resolved.config.runtime.assets);
}

function createStoresFromAssetConfig(options = {}) {
  const plan = normalizePlan(options.plan || options.assetsLoweringPlan);
  const entries = entriesFromPlan(plan);
  const assetConfig = assetConfigFromOptions(options);
  const configRoot = options.configRoot || options.cwd || process.cwd();
  const diagnostics = [];
  const stores = {};
  const configuredStores = [];

  if (!assetConfig || !assetConfig.stores || typeof assetConfig.stores !== 'object') {
    diagnostics.push(makeDiagnostic(
      assetsContracts.ASSETS_DIAGNOSTIC_CODES.STORE_CONFIG_REQUIRED,
      'Node compiled-Wasm assets lifecycle requires an explicit runtime.assets.stores configuration.',
      'error',
      { hint: 'Configure runtime.assets.stores.public with mode "local", dir, methods, and responseBody.' }
    ));
    return { stores, diagnostics, configuredStores, assetConfig };
  }

  const neededStores = Array.from(new Set(entries.map((entry) => entry.lookup && entry.lookup.store).filter(Boolean)));
  for (const storeName of neededStores) {
    const storeConfig = assetConfig.stores[storeName];
    if (!storeConfig) {
      diagnostics.push(makeDiagnostic(
        assetsContracts.ASSETS_DIAGNOSTIC_CODES.STORE_NOT_CONFIGURED,
        `Node compiled-Wasm assets lifecycle needs store ${JSON.stringify(storeName)} but it is not configured.`,
        'error',
        { store: storeName, configuredStores: Object.keys(assetConfig.stores || {}) }
      ));
      continue;
    }
    if (storeConfig.mode && storeConfig.mode !== 'local') {
      diagnostics.push(makeDiagnostic(
        assetsContracts.ASSETS_DIAGNOSTIC_CODES.STORE_CONFIG_INVALID,
        `Node compiled-Wasm assets lifecycle only supports local asset stores in this proof, got ${JSON.stringify(storeConfig.mode)}.`,
        'error',
        { store: storeName, mode: storeConfig.mode }
      ));
      continue;
    }
    if (!storeConfig.dir) {
      diagnostics.push(makeDiagnostic(
        assetsContracts.ASSETS_DIAGNOSTIC_CODES.STORE_CONFIG_INVALID,
        `Node compiled-Wasm assets lifecycle local store ${JSON.stringify(storeName)} must declare dir.`,
        'error',
        { store: storeName }
      ));
      continue;
    }
    const methods = Array.isArray(storeConfig.methods) ? storeConfig.methods.map((method) => String(method).toUpperCase()) : assetsContracts.ASSETS_ALLOWED_METHODS.slice();
    const responseBody = Array.isArray(storeConfig.responseBody) ? storeConfig.responseBody.map(String) : ['text'];
    const storeDir = require('node:path').resolve(configRoot, storeConfig.dir);
    configuredStores.push({ store: storeName, mode: storeConfig.mode || 'local', dir: storeDir, methods, responseBody, cacheControl: storeConfig.cacheControl });
    if (!stores[storeName]) stores[storeName] = {};

    for (const entry of entries.filter((candidate) => candidate.lookup && candidate.lookup.store === storeName)) {
      const lookup = entry.lookup || {};
      const method = String(lookup.method || 'GET').toUpperCase();
      if (!methods.includes(method)) {
        diagnostics.push(makeDiagnostic(
          assetsContracts.ASSETS_DIAGNOSTIC_CODES.COMPILED_METHOD_UNSUPPORTED,
          `Node compiled-Wasm assets lifecycle store ${JSON.stringify(storeName)} does not allow ${method}.`,
          'error',
          { store: storeName, method, allowedMethods: methods }
        ));
        continue;
      }
      if (!responseBody.includes('text')) {
        diagnostics.push(makeDiagnostic(
          assetsContracts.ASSETS_DIAGNOSTIC_CODES.STORE_CONFIG_INVALID,
          `Node compiled-Wasm assets lifecycle store ${JSON.stringify(storeName)} must allow text response bodies for Pass 49.`,
          'error',
          { store: storeName, responseBody }
        ));
        continue;
      }
      const rel = stripLeadingSlash(lookup.key);
      const file = require('node:path').resolve(storeDir, rel);
      if (!file.startsWith(storeDir + require('node:path').sep) && file !== storeDir) {
        diagnostics.push(makeDiagnostic(
          assetsContracts.ASSETS_DIAGNOSTIC_CODES.STORE_CONFIG_INVALID,
          `Node compiled-Wasm assets lifecycle rejected asset key ${JSON.stringify(lookup.key)} because it escapes the configured store directory.`,
          'error',
          { store: storeName, key: lookup.key, dir: storeDir }
        ));
        continue;
      }
      if (!require('node:fs').existsSync(file) || !require('node:fs').statSync(file).isFile()) {
        diagnostics.push(makeDiagnostic(
          assetsContracts.ASSETS_DIAGNOSTIC_CODES.STORE_ASSET_FILE_NOT_FOUND,
          `Node compiled-Wasm assets lifecycle could not find ${JSON.stringify(lookup.key)} in configured store ${JSON.stringify(storeName)}.`,
          'error',
          { store: storeName, key: lookup.key, file }
        ));
        continue;
      }
      const body = require('node:fs').readFileSync(file, 'utf8');
      stores[storeName][normalizeKey(lookup.key)] = {
        status: entry.response && entry.response.status ? entry.response.status : 200,
        body,
        cacheControl: lookup.cacheControl || storeConfig.cacheControl,
        headers: [
          ['Content-Type', contentTypeForAssetPath(file)],
          ['X-PulseWasm-Compiled-Assets', '1']
        ],
        payloadMode: 'text-response-body'
      };
    }
  }

  return { stores, diagnostics, configuredStores, assetConfig };
}

function methodCodeForAssetMethod(method) {
  const upper = String(method || 'GET').toUpperCase();
  return upper === 'HEAD' ? 2 : 1;
}

function methodFromAssetMethodCode(code) {
  return Number(code) === 2 ? 'HEAD' : 'GET';
}

function encodeU32(value) {
  let n = Number(value >>> 0);
  const out = [];
  do {
    let byte = n & 0x7f;
    n >>>= 7;
    if (n !== 0) byte |= 0x80;
    out.push(byte);
  } while (n !== 0);
  return out;
}

function encodeString(value) {
  const bytes = Array.from(Buffer.from(String(value), 'utf8'));
  return [...encodeU32(bytes.length), ...bytes];
}

function section(id, payload) {
  return [id, ...encodeU32(payload.length), ...payload];
}

function vec(items) {
  return [...encodeU32(items.length), ...items.flat()];
}

function instrI32Const(value) {
  return [0x41, ...encodeU32(Number(value))];
}

function makeTerminalAssetsWasm(effects = []) {
  const normalizedEffects = effects.map((effect, index) => ({
    index,
    id: effect.id || `asset-${index}`,
    store: String(effect.store || (effect.lookup && effect.lookup.store) || 'public'),
    key: normalizeKey(effect.key || (effect.lookup && effect.lookup.key) || '/'),
    method: String(effect.method || (effect.lookup && effect.lookup.method) || 'GET').toUpperCase()
  }));
  let offset = 16;
  const data = [];
  const layouts = [];
  for (const effect of normalizedEffects) {
    const storeBytes = Buffer.from(effect.store, 'utf8');
    const keyBytes = Buffer.from(effect.key, 'utf8');
    const storePtr = offset;
    data.push({ offset: storePtr, bytes: Array.from(storeBytes) });
    offset += storeBytes.length + 1;
    const keyPtr = offset;
    data.push({ offset: keyPtr, bytes: Array.from(keyBytes) });
    offset += keyBytes.length + 1;
    layouts.push({ ...effect, storePtr, storeLen: storeBytes.length, keyPtr, keyLen: keyBytes.length, methodCode: methodCodeForAssetMethod(effect.method) });
  }

  const typeSection = section(1, vec([
    [0x60, ...vec([[0x7f], [0x7f], [0x7f], [0x7f], [0x7f], [0x7f]]), ...vec([[0x7f]])],
    [0x60, ...vec([[0x7f], [0x7f]]), ...vec([[0x7f]])],
    [0x60, ...vec([]), ...vec([[0x7f]])]
  ]));
  const importSection = section(2, vec([
    [...encodeString('pulse_assets'), ...encodeString('pulse_assets_lookup'), 0x00, ...encodeU32(0)],
    [...encodeString('pulse_assets'), ...encodeString('pulse_assets_respond'), 0x00, ...encodeU32(1)]
  ]));
  const functionSection = section(3, vec(layouts.map(() => encodeU32(2))));
  const memorySection = section(5, vec([[0x00, ...encodeU32(1)]]));
  const exports = [[...encodeString('memory'), 0x02, ...encodeU32(0)]];
  layouts.forEach((layout, index) => {
    exports.push([...encodeString(`pulse_assets_route_${index}`), 0x00, ...encodeU32(2 + index)]);
  });
  const exportSection = section(7, vec(exports));
  const codeBodies = layouts.map((layout) => {
    const instructions = [
      ...instrI32Const(layout.storePtr),
      ...instrI32Const(layout.storeLen),
      ...instrI32Const(layout.keyPtr),
      ...instrI32Const(layout.keyLen),
      ...instrI32Const(layout.methodCode),
      ...instrI32Const(0),
      0x10, ...encodeU32(0),
      ...instrI32Const(0),
      0x10, ...encodeU32(1),
      0x0b
    ];
    const body = [...vec([]), ...instructions];
    return [...encodeU32(body.length), ...body];
  });
  const codeSection = section(10, vec(codeBodies));
  const dataSegments = data.map((segment) => [0x00, ...instrI32Const(segment.offset), 0x0b, ...vec(segment.bytes.map((byte) => [byte]))]);
  const dataSection = section(11, vec(dataSegments));
  const bytes = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, ...typeSection, ...importSection, ...functionSection, ...memorySection, ...exportSection, ...codeSection, ...dataSection]);
  const module = new WebAssembly.Module(bytes);
  return {
    module,
    bytes,
    effects: layouts,
    imports: WebAssembly.Module.imports(module).map(clone),
    exports: WebAssembly.Module.exports(module).map(clone)
  };
}

function createNodeCompiledWasmAssetsLifecycleRuntime(options = {}) {
  const plan = normalizePlan(options.assetsLoweringPlan || options.plan);
  const sidecarPlan = options.assetsCompiledWasmSidecarPlan && (options.assetsCompiledWasmSidecarPlan.artifact || options.assetsCompiledWasmSidecarPlan);
  const baseEffects = Array.isArray(sidecarPlan && sidecarPlan.terminalAssetResponseEffects)
    ? sidecarPlan.terminalAssetResponseEffects
    : entriesFromPlan(plan).filter((entry) => entry.response).map((entry) => ({
      id: entry.id,
      store: entry.lookup.store,
      key: entry.lookup.key,
      method: entry.lookup.method || 'GET'
    }));
  const terminalEffects = baseEffects.concat(Array.isArray(options.extraTerminalEffects) ? options.extraTerminalEffects : []);
  const storeBuild = createStoresFromAssetConfig({
    plan,
    assetConfig: options.assetConfig,
    assets: options.assets,
    config: options.config,
    resolvedConfig: options.resolvedConfig,
    cwd: options.cwd,
    configRoot: options.configRoot
  });
  const provider = createNodeAssetsProvider({
    plan,
    stores: storeBuild.stores,
    mode: options.mode || 'compiled-wasm-assets-lifecycle'
  });
  const diagnostics = [...storeBuild.diagnostics, ...(provider.diagnostics || [])];
  const wasm = makeTerminalAssetsWasm(terminalEffects);
  const handles = new Map();
  const results = new Map();
  let handleSeq = 1;
  let resultSeq = 1;
  let instance;
  const decoder = new TextDecoder();
  function memory() { return instance.exports.memory; }
  function readUtf8(ptr, len) {
    if (!ptr || !len) return '';
    return decoder.decode(new Uint8Array(memory().buffer, ptr, len));
  }
  const imports = {
    pulse_assets: {
      pulse_assets_lookup(storePtr, storeLen, keyPtr, keyLen, methodCode, optionsRef) {
        const handle = handleSeq++;
        const lookup = {
          handle,
          store: readUtf8(storePtr, storeLen),
          key: normalizeKey(readUtf8(keyPtr, keyLen)),
          method: methodFromAssetMethodCode(methodCode),
          methodCode: Number(methodCode),
          optionsRef: Number(optionsRef || 0)
        };
        handles.set(handle, lookup);
        return handle;
      },
      pulse_assets_respond(assetHandle, optionsRef) {
        const lookup = handles.get(Number(assetHandle));
        const resultHandle = resultSeq++;
        const response = lookup
          ? provider.executeRequest({ method: lookup.method, path: lookup.key })
          : { status: 500, kind: 'empty', headers: [], diagnostics: [makeDiagnostic(assetsContracts.ASSETS_DIAGNOSTIC_CODES.HANDLE_ESCAPE_UNSUPPORTED, 'Unknown compiled-Wasm asset handle.', 'error', { assetHandle })] };
        results.set(resultHandle, { resultHandle, assetHandle: Number(assetHandle), optionsRef: Number(optionsRef || 0), lookup, response });
        return resultHandle;
      }
    }
  };
  instance = new WebAssembly.Instance(wasm.module, imports);

  function executeEffect(index) {
    const exportName = `pulse_assets_route_${index}`;
    const fn = instance.exports[exportName];
    if (typeof fn !== 'function') throw new Error(`Missing compiled assets export ${exportName}.`);
    const resultHandle = fn();
    const execution = results.get(Number(resultHandle));
    return {
      index,
      exportName,
      resultHandle: Number(resultHandle),
      effect: wasm.effects[index],
      lookup: execution && execution.lookup,
      response: execution && execution.response,
      diagnostics: execution && execution.response ? execution.response.diagnostics || [] : []
    };
  }

  function executeAll() {
    return wasm.effects.map((_, index) => executeEffect(index));
  }

  return {
    version: assetsContracts.ASSETS_NODE_COMPILED_WASM_LIFECYCLE_RUNTIME_VERSION,
    provider: 'node',
    mode: options.mode || 'compiled-wasm-assets-lifecycle',
    plan,
    sidecarPlan,
    providerRuntime: provider,
    storeConfig: storeBuild,
    diagnostics,
    wasm: {
      bytes: wasm.bytes,
      byteLength: wasm.bytes.length,
      imports: wasm.imports,
      exports: wasm.exports,
      effects: wasm.effects
    },
    instance,
    executeEffect,
    executeAll
  };
}

function groupHeaders(headers) {
  const order = [];
  const groups = new Map();
  for (const [name, value] of normalizeHeaders(headers)) {
    const display = String(name);
    const lower = display.toLowerCase();
    if (!groups.has(lower)) {
      groups.set(lower, { name: display, values: [] });
      order.push(lower);
    }
    groups.get(lower).values.push(String(value));
  }
  return order.map((key) => groups.get(key));
}

function writeNodeResponse(res, hostResult) {
  const result = hostResult || { status: 500, kind: 'empty', headers: [] };
  res.statusCode = result.status || 500;
  for (const group of groupHeaders(result.headers || [])) {
    res.setHeader(group.name, group.values.length === 1 ? group.values[0] : group.values.slice());
  }
  if (result.kind === 'stream' && result.bodyStream) {
    if (typeof result.bodyStream.pipe === 'function') {
      result.bodyStream.pipe(res);
      return result;
    }
    if (Array.isArray(result.bodyStream.chunks)) {
      if (typeof res.write === 'function') {
        for (const chunk of result.bodyStream.chunks) {
          res.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        }
        res.end();
      } else {
        res.end(Buffer.concat(result.bodyStream.chunks.map((chunk) => Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))));
      }
      return result;
    }
    if (typeof result.bodyStream === 'string' || Buffer.isBuffer(result.bodyStream)) {
      res.end(result.bodyStream);
      return result;
    }
  }
  const body = result.body === undefined || result.body === null ? '' : String(result.body);
  res.end(body);
  return result;
}

function normalizeNodePath(req) {
  const rawUrl = req && req.url ? String(req.url) : '/';
  try {
    return new URL(rawUrl, 'http://pulsewasm.local').pathname || '/';
  } catch (_) {
    return rawUrl.split('?')[0] || '/';
  }
}

function createNodeAssetsHandler(provider) {
  if (!provider || typeof provider.executeRequest !== 'function') {
    throw new Error('createNodeAssetsHandler requires a Node assets provider.');
  }
  return function pulseWasmNodeAssetsHandler(req, res) {
    const result = provider.executeRequest({ method: req && req.method, path: normalizeNodePath(req) });
    writeNodeResponse(res, result);
    return result;
  };
}

module.exports = {
  createNodeAssetsProvider,
  createDefaultStoresFromPlan,
  createStoresFromAssetConfig,
  createNodeCompiledWasmAssetsLifecycleRuntime,
  makeTerminalAssetsWasm,
  createNodeAssetsHandler,
  writeNodeResponse,
  normalizeHeaders,
  normalizeNodePath
};
