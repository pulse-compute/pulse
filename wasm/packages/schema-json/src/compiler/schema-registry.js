'use strict';

const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const {
  normalizeSchemaRegistry,
  codecInputsForRegistry
} = require('@pulse-compute/wasm-contracts/schema-json/registry');

const SCHEMA_REGISTRY_EXTRACTOR_VERSION = 'pulse.schema-registry-extractor.v1';
const AUTHORING_MODULE = '@pulse-compute/pulse/schema';
const HELPER_EXPORTS = new Set(['defineSchemaRegistry', 'schema', 'response']);
const MARKER_EXPORTS = new Map([['Int32', 'i32'], ['Uint32', 'u32'], ['ScalarRecord', 'scalar-record']]);

class SchemaRegistryExtractionError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'SchemaRegistryExtractionError';
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}

function fail(code, message, node, record, detail = {}) {
  const start = node && record ? node.getStart(record.sourceFile) : 0;
  const loc = record
    ? record.sourceFile.getLineAndCharacterOfPosition(start)
    : { line: 0, character: 0 };
  throw new SchemaRegistryExtractionError(code, message, {
    ...detail,
    source: record ? {
      file: record.relative,
      line: loc.line + 1,
      column: loc.character + 1
    } : undefined
  });
}

function slash(value) {
  return String(value).replace(/\\/g, '/');
}

function isInside(root, file) {
  const relative = path.relative(root, file);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function sourceLocation(record, node) {
  const start = node.getStart(record.sourceFile);
  const loc = record.sourceFile.getLineAndCharacterOfPosition(start);
  return Object.freeze({
    file: record.relative,
    line: loc.line + 1,
    column: loc.character + 1
  });
}

function isExported(node) {
  return Boolean(node.modifiers && node.modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
}

function staticPropertyName(node, record, options = {}) {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (options.identifiers && ts.isIdentifier(node)) return node.text;
  fail(
    options.code || 'PULSE_SCHEMA_REGISTRY_STATIC_KEY_REQUIRED',
    options.message || 'Schema registry keys must be string literals.',
    node,
    record
  );
}

function unwrapExpression(node) {
  let current = node;
  while (
    current
    && (
      ts.isParenthesizedExpression(current)
      || ts.isAsExpression(current)
      || ts.isTypeAssertionExpression(current)
      || ts.isSatisfiesExpression(current)
      || ts.isNonNullExpression(current)
    )
  ) current = current.expression;
  return current;
}

class TypeGraph {
  constructor(root) {
    this.root = path.resolve(root);
    this.records = new Map();
    this.dependencies = new Set();
  }

  resolveRelative(fromFile, specifier, node, record) {
    if (!specifier.startsWith('./') && !specifier.startsWith('../') && specifier !== '.' && specifier !== '..') {
      fail(
        'PULSE_SCHEMA_TYPE_IMPORT_NONRELATIVE',
        `Schema type import ${JSON.stringify(specifier)} must be workspace-relative.`,
        node,
        record,
        { specifier }
      );
    }
    const base = path.resolve(path.dirname(fromFile), specifier);
    const extension = path.extname(base);
    const withoutJs = /\.(?:js|mjs|cjs)$/.test(extension) ? base.slice(0, -extension.length) : base;
    const candidates = extension && !/\.(?:js|mjs|cjs)$/.test(extension)
      ? [base]
      : [
          `${withoutJs}.ts`,
          `${withoutJs}.tsx`,
          `${withoutJs}.d.ts`,
          path.join(base, 'index.ts'),
          path.join(base, 'index.tsx'),
          path.join(base, 'index.d.ts')
        ];
    const resolved = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    if (!resolved) {
      fail('PULSE_SCHEMA_TYPE_IMPORT_NOT_FOUND', `Could not resolve schema type import ${JSON.stringify(specifier)}.`, node, record, {
        specifier
      });
    }
    if (!isInside(this.root, resolved)) {
      fail('PULSE_SCHEMA_TYPE_IMPORT_ESCAPE', `Schema type import ${JSON.stringify(specifier)} escapes the Pulse workspace.`, node, record, {
        specifier,
        resolved
      });
    }
    return resolved;
  }

  load(file) {
    const absolute = path.resolve(file);
    if (!isInside(this.root, absolute)) {
      throw new SchemaRegistryExtractionError(
        'PULSE_SCHEMA_POINTER_ESCAPE',
        'pulse.schema must remain inside the Pulse workspace.',
        { root: this.root, file: absolute }
      );
    }
    if (this.records.has(absolute)) return this.records.get(absolute);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
      throw new SchemaRegistryExtractionError(
        'PULSE_SCHEMA_REGISTRY_NOT_FOUND',
        `Pulse schema registry does not exist: ${absolute}`,
        { file: absolute }
      );
    }
    const text = fs.readFileSync(absolute, 'utf8');
    const sourceFile = ts.createSourceFile(
      absolute,
      text,
      ts.ScriptTarget.Latest,
      true,
      absolute.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );
    const record = {
      file: absolute,
      relative: slash(path.relative(this.root, absolute)),
      text,
      sourceFile,
      declarations: new Map(),
      imports: new Map(),
      helpers: new Map(),
      markers: new Map(),
      reExports: new Map(),
      exportStars: []
    };
    this.records.set(absolute, record);
    this.dependencies.add(absolute);
    const parseError = (sourceFile.parseDiagnostics || []).find((entry) => entry.category === ts.DiagnosticCategory.Error);
    if (parseError) {
      const start = typeof parseError.start === 'number' ? parseError.start : 0;
      const loc = sourceFile.getLineAndCharacterOfPosition(start);
      throw new SchemaRegistryExtractionError(
        'PULSE_SCHEMA_REGISTRY_PARSE_FAILED',
        ts.flattenDiagnosticMessageText(parseError.messageText, '\n'),
        { source: { file: record.relative, line: loc.line + 1, column: loc.character + 1 } }
      );
    }
    this.index(record);
    return record;
  }

  index(record) {
    for (const statement of record.sourceFile.statements) {
      if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
        record.declarations.set(statement.name.text, {
          node: statement,
          exported: isExported(statement)
        });
      }
      if (ts.isImportDeclaration(statement)) this.indexImport(record, statement);
      if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) this.indexReExport(record, statement);
    }
  }

  indexImport(record, statement) {
    const specifier = statement.moduleSpecifier.text;
    if (specifier === 'json-as' || specifier.startsWith('json-as/')) {
      fail(
        'PULSE_SCHEMA_PUBLIC_JSON_AS_IMPORT_FORBIDDEN',
        'Application schema modules must not import json-as; Pulse owns that internal backend.',
        statement.moduleSpecifier,
        record,
        { specifier }
      );
    }
    const clause = statement.importClause;
    if (!clause) {
      fail('PULSE_SCHEMA_REGISTRY_SIDE_EFFECT_IMPORT_UNSUPPORTED', 'Schema registry graphs do not allow side-effect imports.', statement, record, {
        specifier
      });
    }
    if (specifier === AUTHORING_MODULE) {
      if (clause.name || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) {
        fail(
          'PULSE_SCHEMA_AUTHORING_IMPORT_INVALID',
          `Import named schema helpers and marker types from ${AUTHORING_MODULE}.`,
          statement,
          record
        );
      }
      for (const element of clause.namedBindings.elements) {
        const imported = element.propertyName ? element.propertyName.text : element.name.text;
        const local = element.name.text;
        if (HELPER_EXPORTS.has(imported)) {
          if (clause.isTypeOnly || element.isTypeOnly) {
            fail('PULSE_SCHEMA_HELPER_VALUE_IMPORT_REQUIRED', `${imported} must be imported as a value.`, element, record, { imported });
          }
          record.helpers.set(local, imported);
        } else if (MARKER_EXPORTS.has(imported)) {
          if (!clause.isTypeOnly && !element.isTypeOnly) {
            fail('PULSE_SCHEMA_MARKER_TYPE_IMPORT_REQUIRED', `${imported} must be imported with import type.`, element, record, {
              imported
            });
          }
          record.markers.set(local, MARKER_EXPORTS.get(imported));
        } else {
          fail('PULSE_SCHEMA_AUTHORING_IMPORT_UNKNOWN', `Unsupported schema authoring import ${imported}.`, element, record, {
            imported
          });
        }
      }
      return;
    }
    if (!clause.isTypeOnly && !(clause.namedBindings && ts.isNamedImports(clause.namedBindings)
      && clause.namedBindings.elements.every((element) => element.isTypeOnly))) {
      fail(
        'PULSE_SCHEMA_REGISTRY_VALUE_IMPORT_UNSUPPORTED',
        'Schema registry graphs allow only Pulse schema helpers and relative type-only imports.',
        statement,
        record,
        { specifier }
      );
    }
    if (clause.name || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) {
      fail('PULSE_SCHEMA_TYPE_IMPORT_NAMED_REQUIRED', 'Schema type imports must use named import type syntax.', statement, record, {
        specifier
      });
    }
    const resolved = this.resolveRelative(record.file, specifier, statement.moduleSpecifier, record);
    this.load(resolved);
    for (const element of clause.namedBindings.elements) {
      record.imports.set(element.name.text, {
        file: resolved,
        name: element.propertyName ? element.propertyName.text : element.name.text
      });
    }
  }

  indexReExport(record, statement) {
    const namedTypeOnly = statement.exportClause
      && ts.isNamedExports(statement.exportClause)
      && statement.exportClause.elements.length > 0
      && statement.exportClause.elements.every((element) => element.isTypeOnly);
    if (statement.isTypeOnly !== true && !namedTypeOnly) {
      fail(
        'PULSE_SCHEMA_REGISTRY_VALUE_REEXPORT_UNSUPPORTED',
        'Schema registry graphs allow only type-only re-exports.',
        statement,
        record
      );
    }
    const resolved = this.resolveRelative(record.file, statement.moduleSpecifier.text, statement.moduleSpecifier, record);
    this.load(resolved);
    if (!statement.exportClause) {
      record.exportStars.push(resolved);
      return;
    }
    if (!ts.isNamedExports(statement.exportClause)) {
      fail('PULSE_SCHEMA_TYPE_REEXPORT_NAMED_REQUIRED', 'Schema type re-exports must be named.', statement, record);
    }
    for (const element of statement.exportClause.elements) {
      const exported = element.name.text;
      const imported = element.propertyName ? element.propertyName.text : element.name.text;
      record.reExports.set(exported, { file: resolved, name: imported });
    }
  }

  resolve(record, name, requireExport = false, seen = new Set()) {
    const key = `${record.file}#${name}#${requireExport}`;
    if (seen.has(key)) {
      fail('PULSE_SCHEMA_TYPE_REFERENCE_CYCLE', `Cyclic schema type export while resolving ${name}.`, record.sourceFile, record, {
        typeName: name
      });
    }
    seen.add(key);
    const local = record.declarations.get(name);
    if (local && (!requireExport || local.exported)) return { record, declaration: local.node };
    const imported = record.imports.get(name);
    if (imported) return this.resolve(this.load(imported.file), imported.name, true, seen);
    const reExport = record.reExports.get(name);
    if (reExport) return this.resolve(this.load(reExport.file), reExport.name, true, seen);
    for (const file of record.exportStars) {
      const resolved = this.resolve(this.load(file), name, true, new Set(seen));
      if (resolved) return resolved;
    }
    return undefined;
  }
}

function classifyType(graph, record, typeNode, state) {
  if (!typeNode) fail('PULSE_SCHEMA_FIELD_TYPE_REQUIRED', 'Every schema field requires an explicit type.', state.node, record);
  if (ts.isParenthesizedTypeNode(typeNode)) return classifyType(graph, record, typeNode.type, state);
  if (typeNode.kind === ts.SyntaxKind.StringKeyword) return Object.freeze({ kind: 'string' });
  if (typeNode.kind === ts.SyntaxKind.BooleanKeyword) return Object.freeze({ kind: 'boolean' });
  if (typeNode.kind === ts.SyntaxKind.NumberKeyword) return Object.freeze({ kind: 'f64' });
  if (typeNode.kind === ts.SyntaxKind.UndefinedKeyword || typeNode.kind === ts.SyntaxKind.VoidKeyword) {
    fail('PULSE_SCHEMA_OPTIONAL_FIELD_RESERVED', 'Explicit undefined schema types are reserved; use a question-mark property for absence.', typeNode, record);
  }
  if (ts.isArrayTypeNode(typeNode)) {
    return Object.freeze({ kind: 'array', element: classifyType(graph, record, typeNode.elementType, state) });
  }
  if (ts.isTypeLiteralNode(typeNode)) return classifyMembers(graph, record, typeNode.members, state);
  if (ts.isUnionTypeNode(typeNode)) {
    const isNullType = (part) => part.kind === ts.SyntaxKind.NullKeyword
      || (ts.isLiteralTypeNode(part) && part.literal.kind === ts.SyntaxKind.NullKeyword);
    const nonNull = typeNode.types.filter((part) => !isNullType(part));
    const nullCount = typeNode.types.length - nonNull.length;
    if (nullCount === 1 && nonNull.length === 1) {
      return Object.freeze({ kind: 'nullable', value: classifyType(graph, record, nonNull[0], state) });
    }
    if (nullCount === 0 && typeNode.types.every((part) => ts.isLiteralTypeNode(part) && ts.isStringLiteral(part.literal))) {
      return Object.freeze({
        kind: 'string-enum',
        values: Object.freeze(typeNode.types.map((part) => part.literal.text))
      });
    }
    fail(
      'PULSE_SCHEMA_UNION_UNSUPPORTED',
      'Schema IR v1 supports only string-literal enums or one supported type unioned with null.',
      typeNode,
      record
    );
  }
  if (ts.isLiteralTypeNode(typeNode)) {
    if (ts.isStringLiteral(typeNode.literal)) {
      return Object.freeze({ kind: 'string-enum', values: Object.freeze([typeNode.literal.text]) });
    }
    fail('PULSE_SCHEMA_LITERAL_TYPE_UNSUPPORTED', 'Only string literal schema types are supported.', typeNode, record);
  }
  if (ts.isTypeReferenceNode(typeNode) && ts.isIdentifier(typeNode.typeName)) {
    const name = typeNode.typeName.text;
    if (name === 'Array') {
      if (!typeNode.typeArguments || typeNode.typeArguments.length !== 1) {
        fail('PULSE_SCHEMA_ARRAY_ELEMENT_REQUIRED', 'Array<T> requires exactly one schema element type.', typeNode, record);
      }
      return Object.freeze({ kind: 'array', element: classifyType(graph, record, typeNode.typeArguments[0], state) });
    }
    const marker = record.markers.get(name);
    if (marker) {
      if (typeNode.typeArguments && typeNode.typeArguments.length > 0) {
        fail('PULSE_SCHEMA_MARKER_GENERIC_UNSUPPORTED', `${name} does not accept type arguments.`, typeNode, record);
      }
      return Object.freeze({ kind: marker });
    }
    if (typeNode.typeArguments && typeNode.typeArguments.length > 0) {
      fail('PULSE_SCHEMA_GENERIC_TYPE_UNSUPPORTED', `Generic schema type ${name} is not supported in IR v1.`, typeNode, record, {
        typeName: name
      });
    }
    const resolved = graph.resolve(record, name);
    if (!resolved) {
      fail('PULSE_SCHEMA_TYPE_NOT_FOUND', `Could not resolve schema type ${name}.`, typeNode, record, { typeName: name });
    }
    const key = `${resolved.record.file}#${resolved.declaration.name.text}`;
    if (state.stack.has(key)) {
      fail('PULSE_SCHEMA_RECURSIVE_TYPE_RESERVED', `Recursive schema type ${name} is reserved beyond IR v1.`, typeNode, record, {
        typeName: name
      });
    }
    const next = { ...state, stack: new Set([...state.stack, key]) };
    if (ts.isInterfaceDeclaration(resolved.declaration)) {
      if (resolved.declaration.typeParameters || resolved.declaration.heritageClauses) {
        fail('PULSE_SCHEMA_INHERITANCE_UNSUPPORTED', `Schema interface ${name} must not be generic or extend another type.`, resolved.declaration, resolved.record);
      }
      return classifyMembers(graph, resolved.record, resolved.declaration.members, next);
    }
    if (resolved.declaration.typeParameters) {
      fail('PULSE_SCHEMA_GENERIC_TYPE_UNSUPPORTED', `Generic schema type ${name} is not supported in IR v1.`, resolved.declaration, resolved.record);
    }
    return classifyType(graph, resolved.record, resolved.declaration.type, next);
  }
  fail(
    'PULSE_SCHEMA_TYPE_UNSUPPORTED',
    `Unsupported schema type syntax ${JSON.stringify(typeNode.getText(record.sourceFile))}.`,
    typeNode,
    record
  );
}

function classifyMembers(graph, record, members, state) {
  const names = new Set();
  const fields = [];
  for (const member of members) {
    if (!ts.isPropertySignature(member)) {
      fail(
        'PULSE_SCHEMA_OBJECT_MEMBER_UNSUPPORTED',
        'Schema object types allow property signatures only.',
        member,
        record
      );
    }
    const name = staticPropertyName(member.name, record, {
      identifiers: true,
      code: 'PULSE_SCHEMA_FIELD_NAME_STATIC_REQUIRED',
      message: 'Schema field names must be identifiers or string literals.'
    });
    if (names.has(name)) {
      fail('PULSE_SCHEMA_FIELD_DUPLICATE', `Schema object declares field ${name} more than once.`, member.name, record, { name });
    }
    names.add(name);
    fields.push(Object.freeze({
      name,
      required: !member.questionToken,
      value: classifyType(graph, record, member.type, { ...state, node: member }),
      source: sourceLocation(record, member.name)
    }));
  }
  return Object.freeze({ kind: 'object', fields: Object.freeze(fields) });
}

function objectProperties(expression, record, allowed, field, options = {}) {
  const value = unwrapExpression(expression);
  if (!ts.isObjectLiteralExpression(value)) {
    fail('PULSE_SCHEMA_REGISTRY_OBJECT_LITERAL_REQUIRED', `${field} must be an object literal.`, value, record, { field });
  }
  const out = new Map();
  for (const property of value.properties) {
    if (!ts.isPropertyAssignment(property)) {
      fail(
        'PULSE_SCHEMA_REGISTRY_STATIC_PROPERTY_REQUIRED',
        `${field} does not allow spreads, methods, getters, setters, or shorthand properties.`,
        property,
        record,
        { field }
      );
    }
    const key = staticPropertyName(property.name, record, {
      identifiers: true,
      code: options.keyCode || 'PULSE_SCHEMA_REGISTRY_STATIC_PROPERTY_REQUIRED',
      message: options.keyMessage || `${field} property names must be static.`
    });
    if (allowed && !allowed.has(key)) {
      fail('PULSE_SCHEMA_REGISTRY_PROPERTY_UNSUPPORTED', `${field} contains unsupported property ${key}.`, property.name, record, {
        field,
        key
      });
    }
    if (out.has(key)) {
      fail(options.duplicateCode || 'PULSE_SCHEMA_REGISTRY_PROPERTY_DUPLICATE', `${field} contains duplicate property ${key}.`, property.name, record, {
        field,
        key
      });
    }
    out.set(key, property);
  }
  return { expression: value, properties: out };
}

function helperCall(expression, record, helperName) {
  const value = unwrapExpression(expression);
  if (!ts.isCallExpression(value) || !ts.isIdentifier(value.expression) || record.helpers.get(value.expression.text) !== helperName) {
    fail(
      'PULSE_SCHEMA_REGISTRY_HELPER_REQUIRED',
      `Schema registry declaration must call ${helperName} imported from ${AUTHORING_MODULE}.`,
      value,
      record,
      { helper: helperName }
    );
  }
  return value;
}

function extractSchemas(graph, record, property) {
  const object = objectProperties(property.initializer, record, null, 'schemas', {
    duplicateCode: 'PULSE_SCHEMA_ID_DUPLICATE',
    keyCode: 'PULSE_SCHEMA_REGISTRY_STATIC_KEY_REQUIRED',
    keyMessage: 'Schema IDs must be fixed string-literal keys.'
  });
  const schemas = [];
  const ids = new Set();
  for (const declaration of object.expression.properties) {
    const id = staticPropertyName(declaration.name, record);
    if (ids.has(id)) fail('PULSE_SCHEMA_ID_DUPLICATE', `Schema ID ${id} is declared more than once.`, declaration.name, record, { id });
    ids.add(id);
    const call = helperCall(declaration.initializer, record, 'schema');
    if (call.arguments.length !== 0 || !call.typeArguments || call.typeArguments.length !== 1) {
      fail(
        'PULSE_SCHEMA_DECLARATION_SIGNATURE_INVALID',
        `Schema ${id} must use schema<Type>() with one type argument and no runtime arguments.`,
        call,
        record,
        { id }
      );
    }
    const typeNode = call.typeArguments[0];
    const typeReferenceName = ts.isTypeReferenceNode(typeNode) && ts.isIdentifier(typeNode.typeName)
      ? typeNode.typeName.text
      : null;
    const resolvedRoot = typeReferenceName ? graph.resolve(record, typeReferenceName) : null;
    const typeName = resolvedRoot
      ? resolvedRoot.declaration.name.text
      : `Inline_${id.replace(/[^A-Za-z0-9_$]+/g, '_')}`;
    const root = classifyType(graph, record, typeNode, {
      stack: new Set(),
      node: typeNode
    });
    schemas.push(Object.freeze({
      id,
      typeName,
      root,
      source: resolvedRoot
        ? sourceLocation(resolvedRoot.record, resolvedRoot.declaration.name)
        : sourceLocation(record, declaration.name)
    }));
  }
  return schemas;
}

function extractResponses(record, property) {
  if (!property) return [];
  const object = objectProperties(property.initializer, record, null, 'responses', {
    duplicateCode: 'PULSE_RESPONSE_CASE_ID_DUPLICATE',
    keyCode: 'PULSE_RESPONSE_CASE_STATIC_KEY_REQUIRED',
    keyMessage: 'Response case IDs must be fixed string-literal keys.'
  });
  const responses = [];
  const ids = new Set();
  for (const declaration of object.expression.properties) {
    const id = staticPropertyName(declaration.name, record);
    if (ids.has(id)) {
      fail('PULSE_RESPONSE_CASE_ID_DUPLICATE', `Response case ID ${id} is declared more than once.`, declaration.name, record, { id });
    }
    ids.add(id);
    const call = helperCall(declaration.initializer, record, 'response');
    if (call.typeArguments && call.typeArguments.length > 0 || call.arguments.length !== 2) {
      fail(
        'PULSE_RESPONSE_CASE_SIGNATURE_INVALID',
        `Response case ${id} must use response(status, 'schema.id').`,
        call,
        record,
        { id }
      );
    }
    const statusNode = unwrapExpression(call.arguments[0]);
    const schemaNode = unwrapExpression(call.arguments[1]);
    if (!ts.isNumericLiteral(statusNode) || !Number.isSafeInteger(Number(statusNode.text))) {
      fail('PULSE_RESPONSE_STATUS_LITERAL_REQUIRED', `Response case ${id} requires a static integer status.`, statusNode, record, { id });
    }
    if (!ts.isStringLiteral(schemaNode) && !ts.isNoSubstitutionTemplateLiteral(schemaNode)) {
      fail('PULSE_RESPONSE_SCHEMA_LITERAL_REQUIRED', `Response case ${id} requires a string-literal schema ID.`, schemaNode, record, {
        id
      });
    }
    responses.push(Object.freeze({
      id,
      status: Number(statusNode.text),
      schemaId: schemaNode.text,
      source: sourceLocation(record, declaration.name)
    }));
  }
  return responses;
}

function findDefaultExport(record) {
  const exports = record.sourceFile.statements.filter((statement) => ts.isExportAssignment(statement) && !statement.isExportEquals);
  if (exports.length !== 1) {
    fail(
      'PULSE_SCHEMA_REGISTRY_DEFAULT_EXPORT_REQUIRED',
      'pulse.schema must contain exactly one explicit default registry export.',
      exports[1] || record.sourceFile,
      record,
      { count: exports.length }
    );
  }
  return exports[0];
}

function legacyFieldType(node) {
  if (node.kind === 'string') return 'string';
  if (node.kind === 'boolean') return 'bool';
  if (node.kind === 'i32' || node.kind === 'u32' || node.kind === 'f64') return node.kind;
  return null;
}

function schemaRegistryLegacyBridge(registry) {
  const compatible = [];
  const deferred = [];
  for (const schema of registry.schemas) {
    const fieldPairs = schema.root.fields.map((field) => [field.name, legacyFieldType(field.value)]);
    if (schema.typeName.startsWith('Inline_') || schema.root.fields.some(field => !field.required) || fieldPairs.some(([, type]) => type === null)) {
      deferred.push(schema.id);
      continue;
    }
    const separator = schema.id.lastIndexOf('.');
    compatible.push(Object.freeze({
      id: schema.id,
      namespace: schema.id.slice(0, separator),
      name: schema.id.slice(separator + 1),
      type: schema.typeName,
      fields: Object.freeze(Object.fromEntries(fieldPairs))
    }));
  }
  return Object.freeze({
    version: 'pulse.schema-registry-legacy-codec-bridge.v1',
    authority: 'pulse.schema',
    fullCodecRealization: false,
    compatibleIds: Object.freeze(compatible.map((entry) => entry.id)),
    deferredIds: Object.freeze(deferred),
    entries: Object.freeze(compatible)
  });
}

function extractSchemaRegistry(schemaFile, options = {}) {
  const projectRoot = path.resolve(options.projectRoot || path.dirname(path.resolve(schemaFile)));
  const graph = new TypeGraph(projectRoot);
  const record = graph.load(schemaFile);
  const defaultExport = findDefaultExport(record);
  const registryCall = helperCall(defaultExport.expression, record, 'defineSchemaRegistry');
  if ((registryCall.typeArguments && registryCall.typeArguments.length > 0) || registryCall.arguments.length !== 1) {
    fail(
      'PULSE_SCHEMA_REGISTRY_SIGNATURE_INVALID',
      'defineSchemaRegistry requires one static registry object and no explicit type arguments.',
      registryCall,
      record
    );
  }
  const registryObject = objectProperties(
    registryCall.arguments[0],
    record,
    new Set(['schemas', 'responses']),
    'defineSchemaRegistry'
  );
  const schemasProperty = registryObject.properties.get('schemas');
  if (!schemasProperty) {
    fail('PULSE_SCHEMA_REGISTRY_SCHEMAS_REQUIRED', 'defineSchemaRegistry requires a schemas object.', registryObject.expression, record);
  }
  const schemas = extractSchemas(graph, record, schemasProperty);
  const responses = extractResponses(record, registryObject.properties.get('responses'));
  let registry;
  try {
    registry = normalizeSchemaRegistry({
      source: sourceLocation(record, defaultExport),
      schemas,
      responses
    });
  } catch (error) {
    if (error && error.code) {
      throw new SchemaRegistryExtractionError(error.code, error.message, error.details || {});
    }
    throw error;
  }
  const codecInputs = codecInputsForRegistry(registry);
  const legacyBridge = schemaRegistryLegacyBridge(registry);
  return Object.freeze({
    version: SCHEMA_REGISTRY_EXTRACTOR_VERSION,
    registry,
    codecInputs,
    legacyBridge,
    dependencies: Object.freeze([...graph.dependencies].map((file) => path.resolve(file)).sort())
  });
}

module.exports = Object.freeze({
  SCHEMA_REGISTRY_EXTRACTOR_VERSION,
  AUTHORING_MODULE,
  HELPER_EXPORTS,
  MARKER_EXPORTS,
  SchemaRegistryExtractionError,
  extractSchemaRegistry,
  schemaRegistryLegacyBridge
});
