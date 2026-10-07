import type { DeepReadonly } from '@pulse-compute/entities'
import { contextCorpus } from '../context-corpus.js'
import { selectContextCorpus } from '../corpus-version.js'
import type {
  Applicability,
  Source,
  BaseOutput,
  RecordSummary,
  RecordContent,
  StartInput,
  StartOutput,
  SearchInput,
  SearchOutput,
  ReadInput,
  ReadOutput,
  ExampleInput,
  ExampleOutput,
  DiagnosticInput,
  DiagnosticOutput,
  Selection,
} from './schemas.js'

export const limits = Object.freeze({
  maxReplyBytes: 24576,
  maxReadBytes: 12288,
  maxEncodedContentBytes: 16384,
  maxQueryBytes: 256,
  maxQueryTerms: 8,
  maxResults: 5,
  maxExcerptBytes: 384,
  maxSelectionBytes: 192,
})
interface CorpusRecord {
  readonly id: string
  readonly title: string
  readonly category: string
  readonly tags: readonly string[]
  readonly applicability: readonly Readonly<Applicability>[]
  readonly source: Readonly<Source>
  readonly content: string
  readonly contentSha256: string
}
const records: readonly CorpusRecord[] = contextCorpus.records
const encoder = new TextEncoder()
const bytes = (text: string) => encoder.encode(text).length
const jsonBytes = (value: unknown) => bytes(JSON.stringify(value))
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const categories = [
  'contract',
  'guide',
  'package',
  'target',
  'command',
  'diagnostic',
  'example',
]
const goals = [
  {
    id: 'json-api',
    example: '01-hello-json',
    contracts: [
      'contract/application-root',
      'contract/project-configuration',
      'contract/targets',
    ],
    choices: [
      'Choose a package name and routes.',
      'Choose the response shape and whether explicit JSON schemas are needed.',
    ],
  },
  {
    id: 'schema-api',
    example: '02-request-schema',
    contracts: [
      'contract/schema-declarations',
      'schema/registry',
      'schema/boundaries',
      'schema/strict',
    ],
    choices: [
      'Choose request and response types and stable schema IDs.',
      'Choose the structured body byte limit and validation policy.',
    ],
  },
  {
    id: 'fetch-api',
    example: '03-fetch-composition',
    contracts: [
      'contract/effects',
      'contract/managed-async',
      'contract/fetch-json',
      'contract/parallel',
    ],
    choices: [
      'Choose fixed upstream origins and provider network bindings.',
      'Choose sequential awaits or an explicit portable parallel group.',
    ],
  },
  {
    id: 'router-api',
    example: '09-router-lowering',
    contracts: [
      'contract/application-root',
      'contract/application',
      'contract/source-compatibility',
    ],
    choices: [
      'Choose route groups and middleware boundaries.',
      'Choose stable request and response schemas.',
    ],
  },
]
const starterSelections = [
  { provider: 'node', target: 'native' },
  { provider: 'node', target: 'javascript' },
]

function base(version: string): BaseOutput {
  const meta = {
    pulseVersion: contextCorpus.pulseVersion,
    corpusSchemaVersion: contextCorpus.schemaVersion,
    corpusHash: contextCorpus.corpusHash,
    snapshotStatus: contextCorpus.status,
    applicationVersion: 'pulse.context-application.v1',
    maxReplyBytes: limits.maxReplyBytes,
    ...(bytes(version) <= 64 ? { requestedVersion: version } : {}),
  }
  if (!version || bytes(version) > 64)
    return {
      meta,
      status: 'invalid-input',
      error: {
        code: 'invalid-version',
        message: 'Supply an exact version of at most 64 UTF-8 bytes.',
      },
    }
  if (selectContextCorpus(version).status !== 'ok')
    return {
      meta,
      status: 'version-mismatch',
      error: {
        code: 'version-mismatch',
        message:
          'The requested version is not bundled. See meta.pulseVersion; no fallback was selected.',
      },
    }
  return { meta, status: 'ok' }
}
function fail<T extends BaseOutput>(
  reply: T,
  status: BaseOutput['status'],
  code: string,
  message: string,
): T {
  return { ...reply, status, error: { code, message } }
}
function complete<T extends BaseOutput>(reply: T, empty: T): T {
  return jsonBytes(reply) <= limits.maxReplyBytes
    ? reply
    : fail(
        empty,
        'response-too-large',
        'response-too-large',
        'Reply exceeds the byte budget. Retrieve individual corpus IDs with pulse.read.',
      )
}
const boundedName = (value: string) =>
  value.length > 0 && bytes(value) <= limits.maxSelectionBytes
function validSelection(input: Selection): boolean {
  if (input.provider === undefined && input.target === undefined) return true
  return records.some(
    (record) =>
      record.category === 'target' &&
      record.applicability.some(
        (pair) => pair.provider === input.provider && pair.target === input.target,
      ),
  )
}
function applies(record: CorpusRecord, input: Selection): boolean {
  return (
    (input.provider === undefined && input.target === undefined) ||
    record.applicability.some(
      (pair) => pair.provider === input.provider && pair.target === input.target,
    )
  )
}
function summary(record: CorpusRecord): RecordSummary {
  return {
    id: record.id,
    title: record.title,
    category: record.category,
    tags: [...record.tags],
    applicability: record.applicability.map((pair) => ({ ...pair })),
    source: { ...record.source },
    contentSha256: record.contentSha256,
  }
}
function required(id: string): CorpusRecord {
  const record = records.find((record) => record.id === id)
  if (!record) throw new Error('Bundled context application/corpus identity mismatch')
  return record
}
function validOffset(offset: number, length: number): boolean {
  return Number.isInteger(offset) && offset >= 0 && offset <= length
}
function textBoundary(text: string, offset: number): boolean {
  return !(
    offset > 0 &&
    offset < text.length &&
    /[\uD800-\uDBFF]/.test(text[offset - 1]) &&
    /[\uDC00-\uDFFF]/.test(text[offset])
  )
}
// Count both UTF-8 content and JSON escaping, preserving whole Unicode code points.
export function clip(
  text: string,
  offset: number,
  rawBudget: number,
  encodedBudget: number,
) {
  let end = offset,
    raw = 0,
    encoded = 0
  for (const point of text.slice(offset)) {
    const rawNext = bytes(point),
      encodedNext = jsonBytes(point) - 2
    if (raw + rawNext > rawBudget || encoded + encodedNext > encodedBudget) break
    end += point.length
    raw += rawNext
    encoded += encodedNext
  }
  return {
    content: text.slice(offset, end),
    truncated: end < text.length,
    ...(end < text.length ? { nextOffset: end } : {}),
  }
}
function content(record: CorpusRecord, offset = 0): RecordContent {
  return {
    ...summary(record),
    ...clip(record.content, offset, limits.maxReadBytes, limits.maxEncodedContentBytes),
    offset,
    totalBytes: bytes(record.content),
  }
}

export function start(_ctx: unknown, input: DeepReadonly<StartInput>): StartOutput {
  const empty: StartOutput = {
    ...base(input.version),
    supportedGoals: goals.map((goal) => goal.id),
    supportedSelections: starterSelections.map((pair) => ({ ...pair })),
  }
  if (empty.status !== 'ok') return empty
  if (![input.goal, input.provider, input.target].every(boundedName))
    return fail(
      empty,
      'invalid-input',
      'invalid-selection',
      'Goal/provider/target must be nonempty bounded names.',
    )
  const goal = goals.find((goal) => goal.id === input.goal)
  if (!goal)
    return fail(empty, 'unknown-goal', 'unknown-goal', 'Choose one of supportedGoals.')
  if (
    !starterSelections.some(
      (pair) => pair.provider === input.provider && pair.target === input.target,
    )
  )
    return fail(
      empty,
      'unsupported-selection',
      'unsupported-starter',
      'This snapshot has maintained Node starter examples only. Wider provider ' +
        'contracts remain available through search/read.',
    )
  const prefix = `example/${goal.example}/`
  const configuration = required(prefix + '.pulse/config.ts')
  const packageData = JSON.parse(required(prefix + 'package.json').content) as {
    dependencies: { [name: string]: string }
    devDependencies: { [name: string]: string }
  }
  const adapted = input.target === 'javascript'
  const contracts = [
    ...goal.contracts,
    'start/requirements',
    'command/init',
    'command/doctor',
    'command/test',
    'command/build',
  ]
  return complete(
    {
      ...empty,
      plan: {
        goal: goal.id,
        provider: input.provider,
        target: input.target,
        imports:
          goal.id === 'schema-api'
            ? ['@pulse-compute/pulse', '@pulse-compute/pulse/schema']
            : ['@pulse-compute/pulse'],
        dependencies: [
          ...Object.entries(packageData.dependencies).map(([name, version]) => ({
            name,
            version,
            kind: 'runtime',
          })),
          ...Object.entries(packageData.devDependencies).map(([name, version]) => ({
            name,
            version,
            kind: 'development',
          })),
        ],
        configuration: {
          path: '.pulse/config.ts',
          sourceId: configuration.id,
          content: adapted
            ? configuration.content.replace("target: 'native'", "target: 'javascript'")
            : configuration.content,
          changedFields: adapted ? ['local.target: native -> javascript'] : [],
        },
        contracts: contracts.map((id) => summary(required(id))),
        exampleId: goal.example,
        exampleApplicability: configuration.applicability.map((pair) => ({ ...pair })),
        commands: [
          {
            command: 'pulse init ./my-pulse-app',
            purpose:
              'Create the workspace locally, then choose its name and copy the selected ' +
              'example files/configuration.',
            sourceId: 'command/init',
          },
          {
            command: 'cd ./my-pulse-app',
            purpose: 'Enter the local project.',
            sourceId: 'start/create',
          },
          {
            command: 'npm install',
            purpose: 'Install the exact dependencies listed in this plan.',
            sourceId: 'start/create',
          },
          {
            command: 'pulse doctor --profile local',
            purpose: 'Audit the chosen project locally.',
            sourceId: 'command/doctor',
          },
          {
            command: 'pulse test --profile local',
            purpose: 'Run the chosen harness locally.',
            sourceId: 'command/test',
          },
          {
            command: 'pulse build --profile local',
            purpose: 'Build the explicitly selected provider/target locally.',
            sourceId: 'command/build',
          },
        ],
        unresolvedChoices: [
          ...goal.choices,
          'Choose a local directory and install the required toolchain. No commands ' +
            'or file writes have been performed.',
          ...(adapted
            ? [
                'The bundled example retains its Node Native provenance. Apply the explicit ' +
                  'target change above and validate JavaScript locally.',
              ]
            : []),
        ],
      },
    },
    empty,
  )
}

export function search(_ctx: unknown, input: DeepReadonly<SearchInput>): SearchOutput {
  const empty: SearchOutput = {
    ...base(input.version),
    results: [],
    totalMatches: 0,
    truncated: false,
  }
  if (empty.status !== 'ok') return empty
  const terms = input.query.toLowerCase().trim().split(/\s+/).filter(Boolean)
  const limit = Number(input.limit ?? limits.maxResults),
    offset = Number(input.offset ?? 0)
  if (
    !input.query.trim() ||
    bytes(input.query) > limits.maxQueryBytes ||
    terms.length > limits.maxQueryTerms ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > limits.maxResults ||
    !validOffset(offset, records.length)
  )
    return fail(
      empty,
      'invalid-input',
      'invalid-search',
      'Use a query of 1\u2013256 UTF-8 bytes and at most eight terms, limit 1\u20135 and a ' +
        'valid result offset.',
    )
  if (input.category !== undefined && !categories.includes(input.category))
    return fail(
      empty,
      'invalid-input',
      'unknown-category',
      'Category must be contract, guide, package, target, command, diagnostic or example.',
    )
  if (!validSelection(input))
    return fail(
      empty,
      'unsupported-selection',
      'unsupported-selection',
      'Supply both provider and target as a supported pair, or neither.',
    )
  const ranked = records
    .filter(
      (record) =>
        applies(record, input) && (!input.category || record.category === input.category),
    )
    .map((record) => {
      const fields = [record.id, record.title, record.tags.join(' '), record.content].map(
        (text) => text.toLowerCase(),
      )
      const score = terms.reduce(
        (sum, term) =>
          sum +
          fields.reduce(
            (weight, field, index) =>
              weight + (field.includes(term) ? [8, 6, 4, 1][index] : 0),
            0,
          ),
        0,
      )
      return {
        record,
        score,
        matches: terms.every((term) => fields.some((field) => field.includes(term))),
      }
    })
    .filter((hit) => hit.matches)
    .sort((a, b) => b.score - a.score || compare(a.record.id, b.record.id))
  if (offset > ranked.length)
    return fail(
      empty,
      'invalid-input',
      'invalid-offset',
      'Result offset exceeds the matching result count.',
    )
  const results = ranked.slice(offset, offset + limit).map(({ record, score }) => {
    const text = record.content.replace(/\s+/g, ' ').trim()
    const found = text.toLowerCase().indexOf(terms[0])
    let begin = Math.max(0, found - 80)
    if (!textBoundary(text, begin)) begin--
    const excerpt = clip(text, begin, limits.maxExcerptBytes, limits.maxExcerptBytes * 6)
    return {
      ...summary(record),
      score,
      excerpt: excerpt.content,
      excerptTruncated: begin > 0 || excerpt.truncated,
    }
  })
  const next = offset + results.length,
    truncated = next < ranked.length
  return complete(
    {
      ...empty,
      results,
      totalMatches: ranked.length,
      truncated,
      ...(truncated ? { nextOffset: next } : {}),
    },
    empty,
  )
}

export function read(_ctx: unknown, input: DeepReadonly<ReadInput>): ReadOutput {
  const empty: ReadOutput = { ...base(input.version), truncated: false }
  if (empty.status !== 'ok') return empty
  if (!boundedName(input.id))
    return fail(
      empty,
      'invalid-input',
      'invalid-id',
      'Supply one nonempty bounded corpus ID.',
    )
  const record = records.find((record) => record.id === input.id)
  if (!record)
    return fail(empty, 'unknown-id', 'unknown-id', 'No bundled record has that exact ID.')
  if (!validSelection(input) || !applies(record, input))
    return fail(
      empty,
      'unsupported-selection',
      'record-not-applicable',
      'The record does not apply to the requested provider/target pair.',
    )
  const offset = Number(input.offset ?? 0)
  if (
    !validOffset(offset, record.content.length) ||
    !textBoundary(record.content, offset)
  )
    return fail(
      empty,
      'invalid-input',
      'invalid-offset',
      'Use a UTF-16 content boundary, normally the preceding nextOffset.',
    )
  const selected = content(record, offset)
  return complete(
    {
      ...empty,
      record: selected,
      truncated: selected.truncated,
      ...(selected.nextOffset !== undefined ? { nextOffset: selected.nextOffset } : {}),
    },
    empty,
  )
}

export function example(_ctx: unknown, input: DeepReadonly<ExampleInput>): ExampleOutput {
  const empty: ExampleOutput = {
    ...base(input.version),
    availableIds: [],
    records: [],
    totalRecords: 0,
    truncated: false,
  }
  if (empty.status !== 'ok') return empty
  if (!boundedName(input.id))
    return fail(
      empty,
      'invalid-input',
      'invalid-id',
      'Supply one known bounded example ID.',
    )
  if (!goals.some((goal) => goal.example === input.id))
    return fail(
      empty,
      'unknown-example',
      'unknown-example',
      'Choose a maintained example ID supplied by pulse.start.',
    )
  const available = records.filter(
    (record) =>
      record.category === 'example' && record.id.startsWith(`example/${input.id}/`),
  )
  const listing = { ...empty, availableIds: available.map((record) => record.id) }
  if (!validSelection(input) || !available.every((record) => applies(record, input)))
    return fail(
      listing,
      'unsupported-selection',
      'example-not-applicable',
      'The bundled example files have an exact Node Native profile; pulse.start ' +
        'describes explicit adaptations.',
    )
  if (
    input.files &&
    (input.files.length < 1 ||
      input.files.length > limits.maxResults ||
      new Set(input.files).size !== input.files.length ||
      input.files.some(
        (id) => !boundedName(id) || !available.some((record) => record.id === id),
      ))
  )
    return fail(
      listing,
      'unknown-id',
      'unknown-file-id',
      'Select one to five distinct exact IDs from availableIds; arbitrary paths ' +
        'and URLs are not accepted.',
    )
  const selected = input.files
    ? available.filter((record) => input.files!.includes(record.id))
    : available
  const offset = Number(input.offset ?? 0)
  if (!validOffset(offset, selected.length))
    return fail(
      listing,
      'invalid-input',
      'invalid-offset',
      'Offset exceeds the selected example record count.',
    )
  const page: RecordContent[] = []
  selected.slice(offset, offset + limits.maxResults).some((record) => {
    const whole = content(record)
    if (
      whole.truncated ||
      jsonBytes({
        ...listing,
        records: [...page, whole],
        totalRecords: selected.length,
        truncated: true,
        nextOffset: selected.length,
      }) > limits.maxReplyBytes
    )
      return true
    page.push(whole)
    return false
  })
  if (page.length === 0 && offset < selected.length)
    return fail(
      listing,
      'response-too-large',
      'record-requires-read',
      'Retrieve the selected file as bounded pulse.read chunks using its corpus ID.',
    )
  const next = offset + page.length,
    truncated = next < selected.length
  return complete(
    {
      ...listing,
      records: page,
      totalRecords: selected.length,
      truncated,
      ...(truncated ? { nextOffset: next } : {}),
    },
    empty,
  )
}

export function explainDiagnostic(
  _ctx: unknown,
  input: DeepReadonly<DiagnosticInput>,
): DiagnosticOutput {
  const empty: DiagnosticOutput = base(input.version)
  if (empty.status !== 'ok') return empty
  if (!boundedName(input.code))
    return fail(
      empty,
      'invalid-input',
      'invalid-code',
      'Supply one exact bounded public diagnostic code.',
    )
  const record = records.find((record) => record.id === `diagnostic/${input.code}`)
  if (!record)
    return fail(
      empty,
      'unknown-code',
      'unknown-code',
      'That public diagnostic is not in the bundled snapshot; no substitute ' +
        'explanation was selected.',
    )
  const diagnostic = JSON.parse(record.content) as {
    code: string
    summary: unknown
    category: string
    remediation: string[]
  }
  const related =
    diagnostic.category === 'schema'
      ? ['contract/schema-declarations', 'schema/boundaries', 'schema/strict']
      : /effect|async|continuation/.test(diagnostic.category)
        ? ['contract/effects', 'contract/managed-async']
        : /provider|native|target/.test(diagnostic.category)
          ? ['contract/targets', 'contract/eligibility']
          : ['contract/application', 'contract/project-configuration']
  return complete(
    {
      ...empty,
      explanation: {
        code: diagnostic.code,
        summary:
          typeof diagnostic.summary === 'string'
            ? diagnostic.summary
            : 'The canonical catalog has no textual summary for this code.',
        summaryAvailable: typeof diagnostic.summary === 'string',
        remediation: diagnostic.remediation,
        diagnostic: content(record),
        contracts: related.map((id) => summary(required(id))),
        nextLocalChecks: [
          {
            command: 'pulse doctor --json',
            purpose:
              'Inspect the local project diagnostics. This server has not run the command.',
            sourceId: 'command/doctor',
          },
        ],
      },
    },
    empty,
  )
}
