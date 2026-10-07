'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const MANIFEST = 'pulse-context-host.json'
const VERSION = 'pulse.context-host.v1'
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const stable = (value) =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  )
const fail = () => {
  throw new Error('Missing, mismatched or unsupported Pulse context build artifacts.')
}
const hash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)

// Trusted local build input, never a tool argument. No application code is loaded here.
function describeBuild(buildDir) {
  const root = fs.realpathSync(buildDir),
    files = new Map()
  function read(name) {
    if (
      typeof name !== 'string' ||
      !name ||
      name.includes('\\') ||
      path.isAbsolute(name) ||
      name.split('/').some((part) => !part || part === '.' || part === '..')
    )
      fail()
    const file = fs.realpathSync(path.join(root, name))
    const stat = fs.statSync(file)
    if (!file.startsWith(root + path.sep) || !stat.isFile() || stat.size > 4194304) fail()
    const bytes = fs.readFileSync(file)
    files.set(name, { file: name, bytes: bytes.length, sha256: digest(bytes) })
    return bytes
  }
  function json(name) {
    const bytes = read(name)
    if (bytes.length > 1048576) fail()
    return JSON.parse(bytes.toString('utf8'))
  }
  const build = json('pulse-build.json')
  if (
    build.version !== 'pulse.project-execution.v10' ||
    build.status !== 'built' ||
    build.provider !== 'node' ||
    build.configuredTarget !== 'javascript' ||
    build.automaticFallback !== false ||
    !hash(build.application?.planHash)
  )
    fail()
  const source = json(build.application.sourcePackage),
    plan = json(build.application.plan)
  if (
    source.version !== 'pulse.node-javascript-source-package.v2' ||
    source.provider !== 'node' ||
    source.target !== 'javascript' ||
    source.automaticFallback !== false ||
    source.plan?.planHash !== build.application.planHash ||
    plan.planHash !== build.application.planHash ||
    source.plan.graphHash !== build.application.graphHash ||
    !source.schemas?.active ||
    source.schemas.registryHash !== build.schemas?.registryHash ||
    !Array.isArray(source.modules) ||
    source.modules.length > 64
  )
    fail()
  read(source.package.manifest)
  read(source.package.entry)
  read(source.package.schemaCodecs)
  const schemas = json(source.package.schemaRegistry)
  if (
    schemas.registryHash !== source.schemas.registryHash ||
    source.package.schemaRegistry !== build.schemas.registry ||
    source.package.schemaCodecs !== build.schemas.codecs
  )
    fail()
  const outputs = new Set()
  for (const module of source.modules) {
    if (outputs.has(module.output)) fail()
    outputs.add(module.output)
    if (!hash(module.outputSha256) || digest(read(module.output)) !== module.outputSha256)
      fail()
  }
  const corpus = source.modules.find((module) => module.source === 'context-corpus.ts')
  if (!corpus || corpus.output !== 'application/context-corpus.js') fail()
  const catalogs = build.packageInspection?.artifacts?.filter(
    (item) =>
      item.contractId === 'pulse.entities' && item.file === 'entities-catalog.json',
  )
  if (catalogs?.length !== 1 || !hash(catalogs[0].sha256)) fail()
  const catalog = json(catalogs[0].file)
  if (
    files.get(catalogs[0].file).sha256 !== catalogs[0].sha256 ||
    !hash(catalog.catalogHash) ||
    catalog.routers?.length !== 1
  )
    fail()
  const names = [
    'pulse.example',
    'pulse.explain_diagnostic',
    'pulse.read',
    'pulse.search',
    'pulse.start',
  ]
  if (stable(catalog.routers[0].entities?.map((entity) => entity.name)) !== stable(names))
    fail()
  return {
    root,
    catalog,
    schemas,
    corpusFile: corpus.output,
    buildId: build.application.planHash,
    files: [...files.values()].sort((a, b) =>
      a.file < b.file ? -1 : a.file > b.file ? 1 : 0,
    ),
  }
}

function loadHostBuild(buildDir) {
  const described = describeBuild(buildDir)
  const manifestPath = fs.realpathSync(path.join(described.root, MANIFEST))
  if (
    !manifestPath.startsWith(described.root + path.sep) ||
    fs.statSync(manifestPath).size > 65536
  )
    fail()
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const { identity, ...unsigned } = manifest
  if (
    manifest.schemaVersion !== VERSION ||
    !hash(identity) ||
    digest(stable(unsigned)) !== identity ||
    manifest.buildId !== described.buildId ||
    stable(manifest.files) !== stable(described.files) ||
    !hash(manifest.corpus?.corpusHash) ||
    typeof manifest.corpus.pulseVersion !== 'string' ||
    manifest.corpus.schemaVersion !== 'pulse.context-corpus.v1' ||
    !['candidate', 'released'].includes(manifest.corpus.snapshotStatus)
  )
    fail()
  return { ...described, manifest }
}

module.exports = { MANIFEST, VERSION, digest, stable, describeBuild, loadHostBuild }
