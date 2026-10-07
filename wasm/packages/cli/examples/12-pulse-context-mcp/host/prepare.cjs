#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { MANIFEST, VERSION, digest, stable, describeBuild } = require('./artifacts.cjs')

function prepareHostBuild(buildDir) {
  const build = describeBuild(buildDir)
  // Build-time data only. The serving host never imports this module or handlers.
  const corpusPath = path.join(build.root, build.corpusFile)
  delete require.cache[require.resolve(corpusPath)]
  const { contextCorpus } = require(corpusPath)
  const unsigned = {
    schemaVersion: VERSION,
    buildId: build.buildId,
    corpus: {
      schemaVersion: contextCorpus.schemaVersion,
      corpusHash: contextCorpus.corpusHash,
      pulseVersion: contextCorpus.pulseVersion,
      snapshotStatus: contextCorpus.status,
    },
    files: build.files,
  }
  const manifest = { ...unsigned, identity: digest(stable(unsigned)) }
  fs.writeFileSync(
    path.join(build.root, MANIFEST),
    JSON.stringify(manifest, null, 2) + '\n',
  )
  return manifest
}
if (require.main === module) {
  try {
    if (process.argv.length > 3) throw new Error('Expected at most one build directory.')
    const manifest = prepareHostBuild(
      process.argv[2] || path.resolve(__dirname, '../dist-node-javascript'),
    )
    console.log(
      JSON.stringify({
        event: 'prepared',
        buildId: manifest.buildId,
        identity: manifest.identity,
      }),
    )
  } catch {
    console.error('Pulse context host artifact preparation failed.')
    process.exitCode = 1
  }
}
module.exports = { prepareHostBuild }
