# B10-MCP-01 validation

Validation date: 2026-10-19. Node 24.19.0. Base source:
`0b2a861c20f427cae0bfcaaca5549c90d201fa04`, tree
`12a50235da1f6fde406e1eb3f30fc53cdac2986d`. Only this internal design directory
is added. These results are design/source evidence, not Native, installed,
client, Fastly, production builder or seal qualification.

The design calculator uses the pinned actual corpus module and checks its
declared corpus identity. Its retained report records that module's SHA-256,
exact size calculations, relevance examples and sparse/direct comparisons.
It emits no production binary files and tests no production binary decoder.
Full Native execution, independent serialization/corruption tests and held-out
retrieval quality remain assigned to 02/03/06.

| Check | Terminal result |
| --- | --- |
| `node docs/internal/b10-mcp-01/measure.cjs --check` | Passed; 244 records, 2,453 dimensions, 14,361 nonzeros; 2,453 singleton, eight multi-term and eight filtered sparse/direct comparisons; eight relevance smoke cases and invalid-query assertions |
| `node scripts/pulse-context-corpus.cjs --check` | Passed; 244 records, 516,102 module bytes, exact baseline corpus hash |
| `npm run maintainer:sync` | Passed; no changes outside the new design directory |
| `npm run docs:sync` | Passed; 243 generated files, five policy outputs, 59 blocks and 19 owned pages synchronized; no generated changes |
| `npm run maintainer:check` | Passed; seven classes, 11 boundaries, nine instruction files, 42 commands, nine workflows, 17 scope cases |
| `npm run docs:check` | Passed; terminal status `ok`, package-source validation |
| `node scripts/documentation-release.cjs` | Passed; terminal status `ok`, package-source/local release contract validation |
| Internal design relative links | Passed; all 13 local Markdown links resolve |

All checks exited zero. Synchronization preceded the repository checks. The
validation narrative was finalized after those executions; no calculator,
contract or product bytes changed afterward. Scope declaration and whitespace
checks are also required on the final committed diff before opening the PR.

No Native compile/runtime, full release selection, real Fastly/Viceroy, external
client, clean installed-package or seal run is claimed or needed for this
internal design-only diff. Hosted checks must be assessed at their own tested
revision. The present measurement is not a serialized binary artifact size
measurement: it is the exact size implied by the specified layout on these
inputs. Wasm/artifact/copy/memory sizes remain unmeasured until 02/08/10.

Dependency setup is inherited from 00: 19 dependency trees were copied after
verifying identical lockfile bytes; no lifecycle scripts ran. The earlier fresh
offline install failed for missing `@bytecodealliance/weval` registry metadata.
This is not a successful clean dependency installation or installed-consumer
proof. No new production dependency was added.
