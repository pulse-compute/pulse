'use strict';

const fs = require('node:fs');
const path = require('node:path');

const META_START = '<!-- pulse-doc-meta:start';
const META_END = 'pulse-doc-meta:end -->';
const REVIEWED_ON = '2026-07-16';
const AUTHORITY_REVIEWED_ON = '2026-07-25';
const AUTHORITY_REVIEW_BY = '2027-01-25';
const GENERATED_MAINTAINER_DOCS = new Set([
  'docs/maintainers/maintenance-policy.md',
  'docs/maintainers/plugin-readiness.md',
  'docs/maintainers/release-manifest.md'
]);
const AUTHORITY_REVIEWED_FILES = new Set([
  'docs/contributing/README.md',
  'docs/contributing/adding-core-provider.md',
  'docs/contributing/adding-first-party-lowerer.md',
  'docs/contributing/package-lowerer-contract.md',
  'docs/contributing/pulse-aware-packages.md',
  'docs/maintainers/public-site.md',
  'docs/maintainers/README.md',
  'docs/maintainers/documentation-deployment.md',
  'docs/maintainers/maintainer-charter.md',
  'docs/maintainers/npm-publishing.md',
  'docs/maintainers/repository-setup.md',
  'docs/maintainers/scope-policy.md',
  'docs/maintainers/support-and-triage.md'
]);

const OWNERS = Object.freeze({
  'docs-platform': Object.freeze({ label: 'Documentation platform maintainers' }),
  'release-engineering': Object.freeze({ label: 'Pulse release maintainers' }),
  'maintainer-council': Object.freeze({ label: 'Pulse maintainer governance' })
});

function slash(value) { return String(value).replace(/\\/g, '/'); }
function stable(value) { return `${String(value).replace(/\r\n/g, '\n').replace(/\s+$/u, '')}\n`; }

function filesUnder(root, predicate = () => true, out = []) {
  if (!fs.existsSync(root)) return out;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) filesUnder(file, predicate, out);
    else if (entry.isFile() && predicate(file)) out.push(file);
  }
  return out;
}

function policyFor(relativeFile) {
  const file = slash(relativeFile);
  const reviewed = AUTHORITY_REVIEWED_FILES.has(file)
    ? { lastReviewed: AUTHORITY_REVIEWED_ON, reviewBy: AUTHORITY_REVIEW_BY }
    : { lastReviewed: REVIEWED_ON, reviewBy: '2027-01-16' };
  if (file.startsWith('docs/maintainers/') && file.endsWith('.md')) {
    return Object.freeze({ owner: 'maintainer-council', status: 'active', ...reviewed });
  }
  if (file.startsWith('docs/contributing/') && file.endsWith('.md')) {
    return Object.freeze({ owner: 'docs-platform', status: 'active', ...reviewed });
  }
  return undefined;
}

function renderMetadata(policy) {
  return [
    META_START,
    `owner: ${policy.owner}`,
    `status: ${policy.status}`,
    `last-reviewed: ${policy.lastReviewed}`,
    `review-by: ${policy.reviewBy}`,
    META_END
  ].join('\n');
}

function withMetadata(source, policy) {
  const block = renderMetadata(policy);
  const pattern = /^<!-- pulse-doc-meta:start\r?\n[\s\S]*?pulse-doc-meta:end -->\r?\n*/;
  if (pattern.test(source)) return stable(source.replace(pattern, `${block}\n\n`));
  return stable(`${block}\n\n${source.replace(/^\s+/, '')}`);
}

function parseMetadata(source) {
  const match = /^<!-- pulse-doc-meta:start\r?\n([\s\S]*?)\r?\npulse-doc-meta:end -->/.exec(String(source));
  if (!match) return undefined;
  const values = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return Object.freeze({
    owner: values.owner,
    status: values.status,
    lastReviewed: values['last-reviewed'],
    reviewBy: values['review-by']
  });
}

function metadataFiles(repoRoot) {
  const roots = [
    path.join(repoRoot, 'docs', 'contributing'),
    path.join(repoRoot, 'docs', 'maintainers')
  ];
  return roots
    .flatMap((root) => filesUnder(root, (file) => file.endsWith('.md')))
    .filter((file) => !GENERATED_MAINTAINER_DOCS.has(slash(path.relative(repoRoot, file))))
    .sort();
}

function synchronizeDocumentationMetadata(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, '..'));
  const write = options.write === true;
  const mismatches = [];
  let changedFiles = 0;
  for (const file of metadataFiles(repoRoot)) {
    const relative = slash(path.relative(repoRoot, file));
    const policy = policyFor(relative);
    if (!policy) throw new Error(`No documentation ownership policy for ${relative}`);
    const source = fs.readFileSync(file, 'utf8');
    const expected = withMetadata(source, policy);
    if (source !== expected) {
      mismatches.push(relative);
      if (write) {
        fs.writeFileSync(file, expected);
        changedFiles += 1;
      }
    }
  }
  if (!write && mismatches.length) throw new Error(`documentation ownership metadata is stale: ${mismatches.join(', ')}. Run pnpm docs:sync`);
  return Object.freeze({ status: 'ok', files: metadataFiles(repoRoot).length, changedFiles, mismatches: Object.freeze(mismatches) });
}

function validateDocumentationMetadata(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, '..'));
  const today = String(options.today || new Date().toISOString().slice(0, 10));
  const files = metadataFiles(repoRoot);
  for (const file of files) {
    const relative = slash(path.relative(repoRoot, file));
    const expected = policyFor(relative);
    const metadata = parseMetadata(fs.readFileSync(file, 'utf8'));
    if (!metadata) throw new Error(`${relative} is missing pulse-doc-meta`);
    if (!OWNERS[metadata.owner]) throw new Error(`${relative} uses unknown documentation owner ${metadata.owner}`);
    for (const field of ['status', 'lastReviewed', 'reviewBy']) if (!metadata[field]) throw new Error(`${relative} metadata is missing ${field}`);
    if (metadata.owner !== expected.owner || metadata.status !== expected.status) throw new Error(`${relative} metadata does not match its ownership policy`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(metadata.lastReviewed) || !/^\d{4}-\d{2}-\d{2}$/.test(metadata.reviewBy)) throw new Error(`${relative} metadata dates must use YYYY-MM-DD`);
    if (metadata.lastReviewed > metadata.reviewBy) throw new Error(`${relative} review-by date precedes last-reviewed`);
    if (metadata.reviewBy < today) throw new Error(`${relative} became stale on ${metadata.reviewBy}; review it before release`);
  }
  return Object.freeze({ status: 'ok', files: files.length, owners: Object.keys(OWNERS).length, checkedOn: today });
}

module.exports = Object.freeze({
  META_START,
  META_END,
  OWNERS,
  REVIEWED_ON,
  policyFor,
  renderMetadata,
  withMetadata,
  parseMetadata,
  metadataFiles,
  synchronizeDocumentationMetadata,
  validateDocumentationMetadata
});

if (require.main === module) {
  try {
    const write = process.argv.includes('--write');
    const result = synchronizeDocumentationMetadata({ write });
    const validation = validateDocumentationMetadata();
    process.stdout.write(`${JSON.stringify({ ...result, validation }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  }
}
