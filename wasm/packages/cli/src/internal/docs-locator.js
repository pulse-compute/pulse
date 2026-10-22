'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { TextDecoder } = require('node:util');
const { PulseProjectError } = require('./project-error.js');

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== '' && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep);
}

function locateDocumentation() {
  try {
    const packageRoot = fs.realpathSync(path.resolve(__dirname, '../..'));
    const root = fs.realpathSync(path.join(packageRoot, 'docs'));
    const invalid = () => new PulseProjectError('PULSE_DOCS_INVALID', 'The installed CLI documentation index is invalid.');
    if (!inside(packageRoot, root) || !fs.statSync(root).isDirectory()) throw invalid();
    const index = fs.realpathSync(path.join(root, 'README.md'));
    if (!inside(root, index) || !fs.statSync(index).isFile()) throw invalid();
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(index)); }
    catch (error) { if (error.code === 'ERR_ENCODING_INVALID_ENCODED_DATA') throw invalid(); throw error; }
    if (!text.trim() || text.includes('\0')) throw invalid();
    return Object.freeze({ status: 'ok', version: require('../../package.json').version,
      docs: Object.freeze({ root, index }) });
  } catch (error) {
    if (error instanceof PulseProjectError) throw error;
    throw new PulseProjectError('PULSE_DOCS_UNAVAILABLE', 'The installed CLI documentation index cannot be read.');
  }
}

module.exports = { locateDocumentation };
