'use strict';

// Presentation adapter: runtime/facade field names are not always authored paths.
// Keep the runtime schema untouched and retain its old reference anchors.
const { CONFIG_FIELDS, CONFIG_SECTIONS } = require('../wasm/packages/cli/src/project-config-schema.js');
const { PULSE_RESERVED_KEYS, PROFILE_CORE_KEYS, EXECUTION_TARGETS } = require('../wasm/packages/contracts/src/project/config-plan.js');

function anchor(value) {
  return `config-${value.replace(/[<>]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}`;
}
function legacyAnchor(value) {
  return value.replace(/<[^>]+>/g, '').replace(/[^a-zA-Z0-9-]/g, '').toLowerCase();
}
function authoredPath(value) {
  if (value === 'entry') return 'pulse.entry';
  if (value === 'provider') return '<profile>.host';
  if (value === 'fastly.maxWasmBytes') return 'fastly().maxWasmBytes';
  if (/^fastly\.(logEndpoint|configStore|secretStore|kv|backends|dynamicBackends|grip)(\.|$)/.test(value)) return `<profile>.${value.replace('fastly.', 'fastly.bindings.')}`;
  if (/^fastly\.(name|description|authors)$/.test(value)) return `<profile>.${value.replace('fastly.', 'fastly.build.')}`;
  return /^(pulse\.|<profile>\.)/.test(value) ? value : `<profile>.${value}`;
}
const fields = CONFIG_FIELDS.map((field) => ({ ...field, sourcePath: field.path, path: authoredPath(field.path) }));
function update(sourcePath, values) { Object.assign(fields.find(field => field.sourcePath === sourcePath), values); }
update('fastly.logEndpoint', { scope: 'Fastly production logging' });
for (const key of ['requestMaxBytes', 'responseMaxBytes']) update(`fastly.bodyForwarding.${key}`, { required: true });
update('entry', { default: '`src/index.ts`' });
update('provider', { required: true, type: 'string', description: 'Selects the provider for this profile. Built-in host IDs include `node`, `fastly`, and compile-only `none`; a scoped provider package name selects that exact package.', precedence: 'Required in every profile; there is no implicit host selection.' });
update('outDir', { default: '`dist`' });
update('reporting', { default: 'inherit `pulse.reporting`', description: 'Overrides the global logging threshold for the selected profile.' });
update('fastly.maxWasmBytes', { section: 'facade', description: 'Programmatic `fastly({ maxWasmBytes })` helper option. In `.pulse/config.ts`, write `<profile>.fastly.build.maxWasmBytes` instead.' });
function add(section, path, type, description, options = {}) {
  fields.push({ section, path, type, description, required: false, default: 'omitted', allowed: '—', scope: 'conventional project configuration', precedence: 'Configuration value.', security: 'No special handling.', diagnostics: [], ...options });
}
add('project', 'pulse.schema', 'string | null', 'Workspace-relative module that default-exports a `defineSchemaRegistry` registry. Schema identities are declared there; `schemas` configures decoding policy.', { default: '`null`', allowed: 'A workspace-relative module path; absolute paths and workspace escapes are rejected.' });
add('project', 'pulse.tests', 'string | null', 'Workspace-relative test harness module used by `pulse test`.', { default: '`null`', allowed: 'A workspace-relative module path; absolute paths and workspace escapes are rejected.' });
add('project', 'pulse.defaultProfile', 'string | null', 'Profile selected when neither `--profile` nor `PULSE_PROFILE` is supplied. It must name an existing top-level profile.', { default: '`null` (no default profile)', precedence: '`--profile`, then `PULSE_PROFILE`, then this field. No first-profile or implicit local fallback.' });
add('project', 'pulse.strict', 'boolean', 'Requires schema-bound request JSON when true. Setting false permits schema-less JSON where supported; it does not change target eligibility.', { default: '`true`' });
add('project', 'pulse.reporting', "'off' | 'error' | 'warn' | 'info' | 'debug'", 'Global logging threshold, inherited by profiles that omit `reporting`.', { default: '`info`', precedence: 'Selected-profile `reporting` overrides this value.' });
add('project', '<profile>.target', 'string', 'Selects the execution target explicitly. Native requires provable supported source; JavaScript retains ordinary static imports and awaited calls.', { required: true, allowed: EXECUTION_TARGETS.map(value => `\`${value}\``).join(', ') });
add('project', '<profile>.<fragment>', 'static value', 'Additional profile properties are application or provider fragments. They may contain null, finite numbers, strings, booleans, arrays, objects, and symbolic `scope.config(name)` or `scope.secret(name)` references. Functions, undefined values, and asynchronous configuration are rejected.', { security: 'References name bindings; they do not read ambient values during planning. One logical name cannot be both config and secret in the same project.' });
add('project', '<profile>.provider', 'object', 'Compatibility provider-options fragment. Prefer the selected provider namespace (`node` or `fastly`). If that namespace contains an object, it takes precedence over this fragment. Provider selection still comes from `host`.');

for (const [section, path, description] of [
  ['node', '<profile>.node', 'Node provider options for a profile whose host is node.'],
  ['node', '<profile>.node.bindings', 'Named S3 and remote package bindings.'],
  ['fastly', '<profile>.fastly', 'Fastly provider options for a profile whose host is fastly.'],
  ['fastly', '<profile>.fastly.bindings', 'Deployment resource names, static backends, and capability bindings.'],
  ['fastly', '<profile>.fastly.build', 'Fastly package metadata and final Wasm artifact budget.']
]) add(section, path, 'object', description, { default: '`{}` (member defaults apply)' });

add('resources', 'pulse.binaryResources.manifest', 'string', 'Canonical serialized embedded manifest supplied explicitly at build time. This is manifest content, not a filesystem path.', { required: true });
add('resources', 'pulse.binaryResources.bindings', 'Readonly<Record<string, string>>', 'Maps logical binary-resource binding names to file paths within the manifest.', { required: true });
add('resources', 'pulse.binaryResources.budgets', 'object', 'Explicit upper bounds for resource admission. All five limits must be supplied.', { required: true });
for (const [key, description] of Object.entries({ files: 'Maximum number of resource files.', fileBytes: 'Maximum bytes in one resource file.', totalBytes: 'Maximum total bytes across resource files.', serializedBytes: 'Maximum bytes in the serialized resource payload.', bindings: 'Maximum number of logical bindings.' })) {
  add('resources', `pulse.binaryResources.budgets.${key}`, 'non-negative safe integer', description, { required: true, allowed: 'An integer from 0 through Number.MAX_SAFE_INTEGER.' });
}
add('node', '<profile>.node.bodyForwarding.maxBytes', 'positive safe integer', 'Maximum bytes forwarded per transfer direction. The containing `bodyForwarding` object also requires `node.maxDurationMs`.', { required: true });

const s3Fields = {
  endpoint: ['string', 'Fixed HTTPS origin without a path, query, or fragment.'],
  bucket: ['string', 'Fixed bucket name; portable lowercase DNS subset, 3–63 characters, without consecutive hyphens.'],
  region: ['string', 'Explicit signing region; 1–64 lowercase letters, digits, or hyphens.'],
  accessKeyIdSecret: ['string', 'Name of the secret containing the access key ID.'],
  secretAccessKeySecret: ['string', 'Name of the secret containing the secret access key.'],
  sessionTokenSecret: ['string', 'Optional name of the secret containing the session token.', { required: false }],
  maxTextBytes: ['integer', 'Maximum buffered text body bytes.', { required: false, default: '`32_768`', allowed: '1–2,097,152' }],
  timeoutMs: ['integer', 'Request timeout in milliseconds.', { required: false, default: '`10_000`', allowed: '1–30,000' }]
};
for (const provider of ['node', 'fastly']) {
  for (const [key, [type, description, options]] of Object.entries(s3Fields)) add('s3', `<profile>.${provider}.bindings.s3.<name>.${key}`, type, description, { required: true, security: 'Credentials resolve from named secrets at execution; request data cannot override binding authority.', ...options });
}
add('s3', '<profile>.fastly.bindings.s3.<name>.backend', 'string', 'Named static Fastly backend for this S3 endpoint; dynamic backends are not permitted.', { required: true });
for (const [key, description] of Object.entries({ package: 'Package identity.', contractId: 'Package operation contract identity.', artifact: 'Opaque deployed artifact identifier; not an automatic filesystem path.', operations: 'Nonempty, unique allowlist of 1–16 operation names.', secret: 'Name of the authentication secret, not the secret value.', keyId: 'Authentication key identity.', keyVersion: 'Authentication key version.', trustDomain: 'Expected trust domain.', origin: 'Fixed HTTPS origin without a path, query, or fragment.' })) {
  add('packages', `<profile>.node.bindings.packages.<name>.${key}`, key === 'operations' ? 'readonly string[]' : 'string', description, { required: true, security: 'These values bind the remote package authority; handlers cannot substitute an endpoint or credential.' });
}
const sections = CONFIG_SECTIONS.map(section => ({ ...section,
  description: section.id === 'fastly' ? 'Options nested under `<profile>.fastly`; bindings and build metadata have separate objects.' : section.id === 'crypto' ? 'Declare algorithms globally or replace the complete declaration for one profile.' : section.description
}));
sections.push(
  { id: 'resources', title: 'Binary resource fields', description: 'Required members when `pulse.binaryResources` is configured; no implicit resource budgets.' },
  { id: 's3', title: 'S3 binding fields', description: 'Each logical S3 binding has this shape. Fastly additionally requires a static backend.' },
  { id: 'packages', title: 'Node package binding fields', description: 'Each named remote package binding requires all fields below. At most 32 bindings may be configured.' },
  { id: 'facade', title: 'Programmatic helper option', description: 'This retained helper spelling is separate from the conventional configuration object.' }
);

function validateCoverage(candidate = fields) {
  const paths = new Set(candidate.map(field => field.path));
  if (paths.size !== candidate.length) throw new Error('Duplicate authored configuration path');
  for (const key of PULSE_RESERVED_KEYS) if (!paths.has(`pulse.${key}`)) throw new Error(`Missing reserved configuration key: ${key}`);
  for (const key of PROFILE_CORE_KEYS) if (!paths.has(`<profile>.${key}`)) throw new Error(`Missing profile configuration key: ${key}`);
  for (const field of CONFIG_FIELDS) if (!candidate.some(value => value.sourcePath === field.path)) throw new Error(`Missing runtime/facade field: ${field.path}`);
}
validateCoverage();
module.exports = { CONFIG_DOCUMENTATION_FIELDS: fields, CONFIG_DOCUMENTATION_SECTIONS: sections, anchor, legacyAnchor, validateCoverage };
