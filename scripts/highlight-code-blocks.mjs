#!/usr/bin/env node

import {common, createStarryNight} from '@wooorm/starry-night'
import process from 'node:process'

const SCHEMA_VERSION = 'pulse.documentation-highlights.v1'

function fail(message) {
  const error = new Error(message)
  error.code = 'PULSE_DOCUMENTATION_HIGHLIGHT_INVALID'
  throw error
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function classNames(value) {
  const names = Array.isArray(value) ? value : value ? [value] : []
  return names.map(String).filter((name) => /^[A-Za-z0-9_-]+$/.test(name))
}

function serialize(node) {
  if (!node || typeof node !== 'object') fail('Starry Night returned an invalid syntax node')
  if (node.type === 'root') return (node.children || []).map(serialize).join('')
  if (node.type === 'text') return escapeHtml(node.value || '')
  if (node.type !== 'element' || node.tagName !== 'span') fail(`Starry Night returned unsupported syntax node ${node.type}:${node.tagName || ''}`)
  const classes = classNames(node.properties?.className)
  const attribute = classes.length ? ` class="${classes.join(' ')}"` : ''
  return `<span${attribute}>${(node.children || []).map(serialize).join('')}</span>`
}

function normalizeFlag(flag) {
  const aliases = new Map([
    ['shell', 'sh'],
    ['console', 'sh'],
    ['zsh', 'sh'],
    ['javascript', 'js'],
    ['typescript', 'ts'],
    ['node', 'js'],
    ['cjs', 'js'],
    ['mjs', 'js'],
    ['markdown', 'md'],
    ['yml', 'yaml']
  ])
  const normalized = String(flag || '').trim().toLowerCase()
  return aliases.get(normalized) || normalized
}

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

async function main() {
  const payload = JSON.parse(await readStdin())
  if (!payload || payload.schemaVersion !== SCHEMA_VERSION || !Array.isArray(payload.blocks)) fail('highlight input must contain the supported schema and a blocks array')
  const starryNight = await createStarryNight(common)
  const highlighted = []
  for (const [index, block] of payload.blocks.entries()) {
    if (!block || typeof block.key !== 'string' || typeof block.value !== 'string') fail(`highlight blocks[${index}] require string key and value fields`)
    const language = normalizeFlag(block.language)
    const scope = language ? starryNight.flagToScope(language) : undefined
    highlighted.push({
      key: block.key,
      language: language || null,
      scope: scope || null,
      highlighted: Boolean(scope),
      html: scope ? serialize(starryNight.highlight(block.value, scope)) : null
    })
  }
  process.stdout.write(`${JSON.stringify({schemaVersion: SCHEMA_VERSION, blocks: highlighted})}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`)
  process.exitCode = 1
})
