'use strict';

const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// This resolver reads source; it never imports a package or its compiler metadata.
const CONDITIONS = new Set(['pulse', 'import', 'default']);

function fail(message) { throw new Error(message); }

function exportTarget(exports, subpath) {
  let selected = exports;
  if (exports && typeof exports === 'object' && !Array.isArray(exports)) {
    const keys = Object.keys(exports);
    if (keys.some(key => key.startsWith('.'))) {
      if (keys.some(key => !key.startsWith('.'))) fail('Mixed export subpaths and conditions are unsupported.');
      if (!Object.hasOwn(exports, subpath)) fail(`No exact declared export for ${subpath}; wildcard exports are unsupported.`);
      selected = exports[subpath];
    } else if (subpath !== '.') fail(`No exact declared export for ${subpath}.`);
  } else if (subpath !== '.') fail(`No exact declared export for ${subpath}.`);
  while (selected && typeof selected === 'object' && !Array.isArray(selected)) {
    const key = Object.keys(selected).find(key => CONDITIONS.has(key));
    if (!key) fail('No pulse, import or default export condition.');
    selected = selected[key];
  }
  if (typeof selected !== 'string') fail('A source export must select one string target; blocked, missing and array targets are unsupported.');
  if (!selected.startsWith('./') || /[\\%?#*\0]/.test(selected)
      || selected.slice(2).split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === 'node_modules')) {
    fail('A source export must name a contained relative file without traversal or node_modules.');
  }
  return selected;
}

function sourceFile(root, candidate, declaration = false) {
  const relative = path.relative(root, candidate);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
      || relative.split(path.sep).some(part => part.toLowerCase() === 'node_modules')) fail('Source file escapes its package root.');
  const supported = file => /\.(?:ts|mts|js|mjs)$/.test(file) && (declaration || !/\.d\.(?:ts|mts)$/.test(file));
  if (!supported(candidate)) fail('Only .ts, .mts, .js and .mjs ESM source files are supported.');
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) fail('Declared source file does not exist.');
  const real = fs.realpathSync(candidate);
  if (!supported(real)) fail('Source symlink must resolve to a supported ESM source file.');
  const realRelative = path.relative(root, real);
  if (!realRelative || realRelative === '..' || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)
      || realRelative.split(path.sep).some(part => part.toLowerCase() === 'node_modules')) fail('Source symlink escapes its package root.');
  return real;
}

function packageSource(manifestPath, manifest, packageName, subpath, manifestHash) {
  if (manifest.name !== packageName || typeof manifest.version !== 'string'
      || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(manifest.version)) fail('Source packages require a matching name and concrete version.');
  const root = fs.realpathSync(path.dirname(manifestPath));
  const target = exportTarget(manifest.exports, subpath);
  const absolute = sourceFile(root, path.resolve(root, target));
  if (manifest.type === 'commonjs' && /\.(?:js|ts)$/.test(absolute)) fail('Explicit CommonJS package sources are unsupported; declare an ESM source export.');
  return Object.freeze({ root, absolute, packageName, packageVersion: manifest.version, packageManifestHash: manifestHash, packageType: manifest.type,
    prefix: `npm/${packageName}@${manifest.version}/${manifestHash}` });
}

function relativeSource(owner, importer, specifier, declaration = false) {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) fail('Package source cannot use application tsconfig aliases.');
  if (/[\\%?#\0]/.test(specifier)) fail('Unsupported package source specifier.');
  // Exact ESM file links only: no extension substitution, directory or main fallback.
  const absolute = sourceFile(owner.root, path.resolve(path.dirname(importer), specifier), declaration);
  if (!declaration && owner.packageType === 'commonjs' && /\.(?:js|ts)$/.test(absolute)) fail('Explicit CommonJS package sources are unsupported.');
  return absolute;
}

function unsupportedStatement(sourceFile) {
  const functionValue = node => {
    while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node))) node = node.expression;
    return node && (ts.isArrowFunction(node) || ts.isFunctionExpression(node));
  };
  return sourceFile.statements.find(statement => {
    if (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement) || ts.isFunctionDeclaration(statement)
        || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEmptyStatement(statement)) return false;
    if (ts.isExportAssignment(statement)) return statement.isExportEquals || !(ts.isIdentifier(statement.expression) || functionValue(statement.expression));
    if (ts.isVariableStatement(statement)) return !(statement.declarationList.flags & ts.NodeFlags.Const)
      || statement.declarationList.declarations.some(declaration => !ts.isIdentifier(declaration.name) || !functionValue(declaration.initializer));
    return true;
  });
}

module.exports = Object.freeze({ packageSource, relativeSource, unsupportedStatement });
