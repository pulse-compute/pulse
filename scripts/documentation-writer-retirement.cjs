'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function validateWriterRetirement() {
  const record = JSON.parse(fs.readFileSync(path.join(root, 'release/documentation-writer-retirement.json')));
  const expected = {
    schemaVersion: 'pulse.documentation-writer-retirement.v1', repository: 'pulse-compute/pulse',
    sourceRetirementBranch: 'latest', previousWorkflow: { id: 328773030,
      path: '.github/workflows/documentation-deploy.yml',
      identityEvidence: 'https://github.com/pulse-compute/pulse/actions/runs/37858976410' },
    historicalRefs: 'may-still-contain-writer', dispatchRequirement: 'live-disabled-and-idle',
    absencePolicy: 'reject', replacementRepository: 'pulse-compute/website'
  };
  if (JSON.stringify(record) !== JSON.stringify(expected)) throw new Error('Writer retirement identity or live guard requirement differs');
  if (fs.existsSync(path.join(root, expected.previousWorkflow.path))) throw new Error('Retired writer workflow reintroduced');
  const reader = require('./documentation-deployment.cjs');
  for (const name of ['sealDocumentationCandidate', 'deployDocumentation', 'filesystemAdapter', 'awsAdapter', 'verifyStorage', 'verifyPublicDocumentation']) {
    if (name in reader) throw new Error(`Retired writer export reintroduced: ${name}`);
  }
  for (const file of fs.readdirSync(path.join(root, '.github/workflows'))) {
    const source = fs.readFileSync(path.join(root, '.github/workflows', file), 'utf8');
    if (source.includes('environment: documentation-production') || /documentation-deployment\.cjs (deploy|seal|verify-public)/.test(source)) {
      throw new Error(`Old writer authority reintroduced in ${file}`);
    }
  }
  return { status: 'source-retired', historicalRefs: record.historicalRefs, liveDisabledState: 'not-observed' };
}
module.exports = { validateWriterRetirement };
if (require.main === module) console.log(JSON.stringify(validateWriterRetirement()));
