# Retrieval and immutable representation

All limits refer to [contract.json](./contract.json). This is the selected v1
design; availability in Native must be established by 02, not inferred from
this document. Exact initial workload numbers are in [measurement.json](./measurement.json).

## Encoder, records and scores

One existing canonical corpus record is one vector row and one citation unit.
Do not rechunk by token windows or truncate long records. Preserve the source
allowlist, stable record IDs, source selection/ranges, exact content and content
SHA-256. Duplicate IDs, malformed Unicode, missing/mixed versions and records
over the limits reject generation. Record order is ascending ASCII ID; there
are no locale comparisons. Existing IDs are ASCII by the corpus contract.

Normalize each of `id`, `title`, joined `tags` and `content` separately: fold only
ASCII `A`–`Z` to `a`–`z`; take maximal runs of `[a-z0-9_]`. All other characters
are delimiters. Do not normalize Unicode, stem, remove stop words, apply IDF,
hash features, count repeated occurrences or join tokens across fields. Any
document token over 64 bytes rejects the build; none is silently dropped.
Sort the union of tokens in ASCII byte order and assign zero-based term IDs.
Vocabulary cardinality is the vector dimension; no padding dimensions.

For term `t`, the document coordinate is the sum of **presence** weights
`8*id + 6*title + 4*tags + 1*content`. Nonzero coordinates are integers 1–19.
Terms in each row are strictly increasing IDs. The query uses the same token
rules, then distinct sorted terms with binary weights of one. Its raw input
must be 1–256 UTF-8 bytes and consist only of printable ASCII or TAB/LF/CR;
there must be 1–8 tokens **before** deduplication, each at most 64 bytes. Invalid
input returns `invalid-search`; unknown vocabulary terms yield zero matches.
Examples: `PARALLEL parallel` becomes `[parallel]`; `@pulse-compute/pulse`
becomes `[compute, pulse]`. Non-ASCII query rejection is explicit, never an
empty query produced by silently deleting Unicode.

Apply category and exact provider/target-pair filters first. Require **all**
distinct query terms to be present. Score is the integer dot product (at most
152); sort score descending, then row/ID ascending. No float32 rounding,
normalization, ANN index, NaN, Infinity, negative-zero or CPU math-library
variation participates. `pulse.search` keeps integer `offset`, default 0, and
`limit` 1–5, default 5. Offset must be within 0..totalMatches inclusive; equal
means an empty terminal page, greater means `invalid-offset`. Always return the
complete count, deterministic next offset and truncation flag. Never silently
stop at a corpus or work-budget boundary and return partial success.

Advertise `pulse.context-application.v2` and encoder ID in tool result metadata.
The existing host application can retain v1 search until explicitly migrated;
host transport API preservation does not mean v1/v2 search ranking equality.

## Binary formats

Exactly three resources: logical IDs `context.vector`, `context.text` and
`context.metadata`, backed by `vector.bin`, `text.bin` and `metadata.bin`.
Headers are 64 bytes. All numeric words are unsigned 32-bit little-endian;
offsets are absolute byte offsets within the owning file. Layout is tightly
packed, including unaligned word reads; no padding or native structs.

Common header: bytes 0..7 magic; words at offsets 8, 12, 16, 20 respectively
format version (1), header bytes (64), total file bytes, row count. Bytes 32..63
are the raw 32-byte canonical corpus SHA-256. The two words at 24/28 depend on
the file as below. No trailing bytes, unused sections or optional extensions.

| File | Magic (eight ASCII bytes) | Words 24 / 28 | Sections immediately after header |
| --- | --- | --- | --- |
| vector.bin | `PCTXV001` | vocabulary count / nonzero entry count | vocabulary directory: V × (token offset, token byte length); row directory: N × (first entry index, entry count); entries: E × (term ID, weight); concatenated ASCII tokens |
| text.bin | `PCTXT001` | 0 / 0 | row directory: N × (content offset, content byte length, UTF-16 code-unit length); concatenated original UTF-8 contents |
| metadata.bin | `PCTXM001` | 0 / 0 | row directory: N × (JSON offset, JSON byte length); concatenated canonical UTF-8 JSON metadata objects |

Metadata is the existing corpus record minus `content`, retaining ID, title,
category, tags, applicability, pulseVersion, status, source and contentSha256.
Serialize keys recursively in ASCII order, arrays in their canonical existing
order, compact JSON with no final newline; never absolute filesystem paths.
Offsets/counts in row directories are contiguous and exhaust the relevant
section. Empty corpus/vocabulary is invalid; resource infrastructure still must
support zero-byte resources independently. Content may be empty if its source
contract permits it. Dimensions, byte lengths and file SHA-256 are repeated in
the external manifest; all identities must agree.

Production validation in 03 must reject short headers/sections, wrong magic or
version, overflow in offset arithmetic, gaps/overlap/trailing data, mismatched
row counts/hashes, duplicate or unsorted IDs/terms, wrong term lengths/ranges,
zero/out-of-range weights, invalid UTF-8, wrong UTF-16 counts, wrong content
hashes and metadata schema mismatch. Recompute the encoding from authoritative
records and compare every coordinate, not just hash self-consistency. Installed
07 tests must substitute/truncate each file and mix files from different
manifests. Runtime starts only from a compiler-validated immutable closure;
header/row reads still check ranges and failure never becomes an empty result.

## Text retrieval and Unicode

Metadata is decoded through a literal registered schema with
`ctx.decodeJson`, at most 4,096 bytes per record. Generate derived scalar filter
tables from the same manifest for search, so scoring does not parse 512 metadata
records. 02 must prove their exact Native representation; no assumed general
support for imported arrays of objects or arbitrary structured helper returns.

Text remains UTF-8 in `text.bin`; no JSON-escaped copy, base64 payload, duplicate
full TS content literal or runtime filesystem read. A proposed generic resource
operation `view.readUtf8(offset, byteLength)` returns a fresh scalar string,
validates integer/range/scalar boundaries and rejects malformed UTF-8 without
replacement. The maximum admitted length is 12,288 bytes per call, fixed in the
canonical operation; UTF-8 decode loops perform deadline checks and are charged
to the existing execution budget. It is not a view escape or an implicit
resource read quota. It must have canonical-plan validation and Node Native,
Fastly Native and JavaScript parity. This operation **does not exist today**.

`pulse.read` offsets remain UTF-16 code units. Scan at most the record's 24,576
UTF-8 bytes to map a requested offset to a scalar boundary: ASCII and 2/3-byte
scalars consume one UTF-16 unit, 4-byte scalars consume two. An offset in the
middle of a surrogate pair is invalid. Choose the maximal next scalar-aligned
slice within 12 KiB raw and 16 KiB JSON-escaped content; compute escaping before
decode, then verify the whole 24 KiB tool reply cap. Return original offset,
nextOffset only when more content exists, totalBytes and citation. A terminal
offset returns empty content. Reject invalid integers/out-of-range offsets.
Never split a scalar or change content to make it fit.

Search excerpts are a deliberately simpler v2 rule: the leading scalar-aligned
384 raw UTF-8 bytes of the original content (maximum 2,304 escaped bytes), with
an explicit truncation flag. They remain exact substrings, including whitespace;
no runtime full-record whitespace normalization or search-centering scan.
Read gives the complete cited text. This is a documented change from v1 snippets.

## Bounded execution plan for 02

Use binary searches over resource directories/rows. A request owns at most
three immutable resource handles and a fixed-capacity numeric heap of 512 keys.
Encode a positive hit as `score*512 + (511-row)`; all keys fit an exact i32.
Insert with at most nine heap steps, pop with at most nine steps. Skip `offset`
largest keys then pop up to `limit`. The key gives exactly the selected ordering;
no unbounded JavaScript sort or state shared between requests. Invalid offsets
are rejected after counting matches. A request with an unknown term may return
the known zero-result outcome early.

The current Native helper contract cannot mutate borrowed arrays. 02 therefore
owns a **general fresh local numeric workspace** admission: literal capacity
at most 1,024, initialized values, checked integer indexing, no aliases to
borrowed/structured input, no escape/retention and no resource handles in cells.
Canonical plan validation must prove allocation ownership and all writes. Use
fixed local numeric array syntax; do not invent an application-specific effect,
`ctx.vectorSearch`, or compiler source-path exception. Whether this generic
extension is deliverable must be proven before committing to 03/06. No workspace
support or public syntax is added by 01.

| Phase | Conservative admitted work, excluding serialization/ABI overhead |
| --- | --- |
| Query ASCII folding/tokenization | 256 units; even a 26-letter lookup is at most 6,656 comparisons |
| Dictionary lookup | 8 × 13 × 64 = 6,656 character comparisons; no more than 104 token decodes |
| Scoring | 512 × 8 × 11 = 45,056 row-entry comparisons (11 covers a 1,024-entry binary search) |
| Heap insert and pagination | At most 512 × 9 insert steps and 512 × 9 pop steps = 9,216 steps |
| Search output data | At most 5 × 4,096 metadata bytes plus 5 × 384 text bytes |
| Single record read | At most 24,576 bytes to locate offset, then at most 12,288 bytes for clipping and 12,288 bytes for decode |

These are bounds, **not timing or allocation measurements**. Sum phase work in
the receipt; do not mistake the 65,536 nested-loop product for a whole-request
instruction budget. Each authored loop must fit the current 1,024 per-loop and
65,536 nested/helper-product rules. Long text scans require a justified bounded
block traversal (24 × 1,024), not arbitrary loop duplication. Internal generic
UTF-8 loops need their own validated bounds and synchronous deadline checks.
Sibling loops aren't summed by that compiler rule; their total cost still
counts for deadline, memory and whole-request proof. No general ceiling increase.

The app selects 5 MiB per resource, 8 MiB total, 16 MiB serialized resource
representation, three files/bindings and a 2 MiB canonical corpus ceiling.
These are explicit app budgets, not HTTP Assets limits or implicit global
defaults. All ceilings apply simultaneously; 512 records of maximum size need
not be admissible. Do not evade a byte cap by dropping records. 03 must check the
actual admitted resource serialization, not assume it equals raw byte totals.

## Quality acceptance

The design calculator checks the actual corpus, sparse/direct integer scoring
agreement for every vocabulary singleton, eight multi-term/diagnostic cases,
eight filtered cases, stable IDs and representative invalid query boundaries.
Those eight expected-relevance cases are smoke evidence, not a held-out study.

Before accepting 06, maintain a separately reviewed 24-query set: six exact
API/diagnostic names, six configuration/workflow questions, six provider/target
or category-filtered questions, and six failure/ambiguity cases. Freeze relevance
IDs before tuning. Require all exact-name cases at rank 1, a relevant citation
in the first five for every admitted workflow/filter case, correct negatives,
exact oracle order/count/pagination and byte-exact citation resolution. Publish
v1 lexical baseline and v2 results, including declines; any failed criterion
blocks acceptance and requires an explicit design/relevance review, not dropping
the test or narrowing the corpus. Paraphrase/synonym and non-ASCII cases must
show the selected lexical limitations; they do not pass as semantic retrieval.
