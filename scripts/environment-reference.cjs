'use strict';

function entry(value) {
  return Object.freeze({
    secret: false,
    ...value,
    sourceFiles: Object.freeze([...(value.sourceFiles || [])])
  });
}

const ENVIRONMENT_CATEGORIES = Object.freeze({
  tooling: Object.freeze({
    title: 'Supported tooling configuration',
    summary: 'Documented environment inputs accepted by release tooling. These configure tools, not handler authority.'
  }),
  contributor: Object.freeze({
    title: 'Contributor and test-only configuration',
    summary: 'Repository harness controls. They are intentionally outside the application compatibility contract.'
  })
});

const ENVIRONMENT_VARIABLES = Object.freeze([
  entry({
    name: 'PULSE_B02_BASELINE_ROOT',
    category: 'contributor',
    value: 'Directory path',
    default: 'Unset; the manual B02 benchmark requires an explicit baseline checkout.',
    precedence: 'Selects the baseline; the candidate is the checkout containing the harness.',
    consumer: 'Manual B02 terminal Router body cost proof.',
    secretSafety: 'Not a secret. The harness executes compiler code from this checkout; use trusted source.',
    stability: 'Contributor/test-only; outside the application compatibility contract.',
    description: 'Identifies a restored pre-B02 checkout for alternating baseline/candidate compiler measurements.',
    sourceFiles: ['wasm/test/runtime/compiler-efficiency/b02-handler-cost.cjs']
  }),
  entry({
    name: 'PULSE_B02_USAGE_DIR',
    category: 'contributor',
    value: 'Directory path',
    default: 'Created separately for each sample by the B02 benchmark harness.',
    precedence: 'The harness supplies and overrides this value in each child process.',
    consumer: 'B02 AssemblyScript child-process RSS collector.',
    secretSafety: 'Not a secret. Contains temporary process IDs and peak RSS measurements.',
    stability: 'Harness-internal test control; not a user or application setting.',
    description: 'Passes the isolated measurement directory to the temporary compiler preload collector.',
    sourceFiles: ['wasm/test/runtime/compiler-efficiency/b02-handler-cost.cjs']
  }),
  entry({
    name: 'PULSE_B03_USAGE_DIR',
    category: 'contributor',
    value: 'Directory path',
    default: 'Created separately for each sample by the B03 benchmark harness.',
    precedence: 'The harness supplies and overrides this value in each compiler child process.',
    consumer: 'B03 AssemblyScript child-process RSS collector.',
    secretSafety: 'Not a secret. Contains temporary process IDs and peak RSS measurements.',
    stability: 'Harness-internal test control; not a user or application setting.',
    description: 'Keeps compiler-process RSS separate from the planning worker and cold execution measurements.',
    sourceFiles: ['wasm/test/runtime/compiler-efficiency/b03-handler-functions.cjs']
  }),
  entry({
    name: 'PULSE_FASTLY_BIN',
    category: 'tooling',
    value: 'Absolute or relative executable path',
    default: 'No explicit path; discover `fastly` on `PATH`.',
    precedence: 'An explicit `binary` option wins, then `PULSE_FASTLY_BIN`, then `PATH` discovery.',
    consumer: 'Fastly CLI inspection and the external Compute reality gate.',
    secretSafety: 'Not a secret. Do not point it at an untrusted executable.',
    stability: 'Supported Beta tooling override.',
    description: 'Selects the Fastly CLI binary used for external target inspection and local Compute execution.',
    sourceFiles: ['packages/provider-fastly/src/testing/fastly-cli.js']
  }),
  entry({
    name: 'PULSE_VICEROY_BIN',
    category: 'tooling',
    value: 'Absolute or relative executable path',
    default: 'Unset; discover the Fastly CLI first, then Viceroy, on `PATH`.',
    precedence: 'An explicit launcher choice wins. Without one, an explicit Fastly CLI path selects CLI ownership; otherwise an explicit `viceroyBinary` or `PULSE_VICEROY_BIN` selects direct Viceroy execution.',
    consumer: 'External Fastly Compute reality gates, either as the direct local engine or as an explicit Fastly CLI engine override.',
    secretSafety: 'Not a secret. Do not point it at an untrusted executable.',
    stability: 'Supported Beta tooling override.',
    description: 'Selects an inspected Viceroy executable for direct local Compute execution when no explicit Fastly CLI launcher is selected.',
    sourceFiles: ['packages/provider-fastly/src/testing/fastly-cli.js']
  }),
  entry({
    name: 'PULSE_PROFILE',
    category: 'tooling',
    value: 'Pulse profile name',
    default: 'Unset; use `pulse.defaultProfile` when declared.',
    precedence: '`--profile` wins, then `PULSE_PROFILE`, then `pulse.defaultProfile`.',
    consumer: 'Project-aware Pulse CLI commands using the `.pulse/config.ts` convention.',
    secretSafety: 'Not a secret. It selects a committed profile and never carries resolved binding values.',
    stability: 'Supported project-selection input.',
    description: 'Selects the flat Pulse project profile when no explicit `--profile` option is supplied.',
    sourceFiles: ['wasm/packages/cli/src/project-config.js']
  }),
  entry({
    name: 'PULSE_RELEASE_REF',
    category: 'contributor',
    value: 'Full Git ref (`refs/tags/v<version>`)',
    default: 'Unset; the protected npm workflow derives it from the sealed candidate.',
    precedence: "When set by the workflow, it must exactly equal GitHub's native release-tag ref.",
    consumer: 'Protected npm publication identity binding.',
    secretSafety: 'Not a secret. It is validated rather than trusted as independent authority.',
    stability: 'Repository release-workflow internal; not an application setting.',
    description: "Carries the sealed candidate release ref into the protected publish process for an equality check against GitHub's native identity.",
    sourceFiles: ['scripts/release-publication.cjs']
  }),
  entry({
    name: 'PULSE_RELEASE_SHA',
    category: 'contributor',
    value: 'Full lowercase 40-character Git commit SHA',
    default: 'Unset; the protected npm workflow derives it from the sealed candidate.',
    precedence: "When set by the workflow, it must exactly equal GitHub's native release-tag commit.",
    consumer: 'Protected npm publication identity binding.',
    secretSafety: 'Not a secret. It is validated rather than trusted as independent authority.',
    stability: 'Repository release-workflow internal; not an application setting.',
    description: "Carries the sealed candidate source commit into the protected publish process for an equality check against GitHub's native identity.",
    sourceFiles: ['scripts/release-publication.cjs']
  }),
  entry({
    name: 'PULSEWASM_ARTIFACTS_DIR',
    category: 'contributor',
    value: 'Directory path',
    default: '`wasm/artifacts`.',
    precedence: 'Overrides the repository artifact root for scripts that opt into it.',
    consumer: 'Build and test isolation.',
    secretSafety: 'Not a secret. Use an isolated writable directory.',
    stability: 'Contributor/test-only.',
    description: 'Redirects generated build and test artifacts away from the default repository directory.',
    sourceFiles: [
      'wasm/packages/build-support/src/artifacts-dir.js',
      'wasm/scripts/build.cjs',
      'wasm/scripts/run-wasm-tests.cjs'
    ]
  }),
  entry({
    name: 'PULSEWASM_TEST_TMP_ROOT',
    category: 'contributor',
    value: 'Directory path',
    default: 'A suite-specific temporary directory.',
    precedence: 'When set, tests create their working directories beneath this root.',
    consumer: 'Documentation, CLI, provider, package-release, and clean-machine acceptance tests.',
    secretSafety: 'Not a secret. The directory may contain generated projects and test data.',
    stability: 'Contributor/test-only; may change with test-runner updates.',
    description: 'Pins test workspaces beneath a caller-managed temporary root.',
    sourceFiles: ['wasm/test/docs/assert-executable-documentation.cjs', 'wasm/test/release/assert-release-packages.cjs']
  }),
  entry({
    name: 'PULSE_FASTLY_REALITY_EVIDENCE',
    category: 'contributor',
    value: 'File path',
    default: 'Unset; the reality gate prints its normal test result without retaining a proof file.',
    precedence: 'When set, the real-host gate writes its redacted machine-readable proof to this path.',
    consumer: 'Fastly CLI-managed or direct-Viceroy local Compute reality gate.',
    secretSafety: 'Not a secret. The proof intentionally excludes secret values and authorization plaintext.',
    stability: 'Contributor/release tooling override.',
    description: 'Selects the output path for the real Fastly host evidence report.',
    sourceFiles: ['wasm/test/provider/assert-fastly-compute-reality.cjs']
  }),
  entry({
    name: 'PULSE_FOUR_MODE_EVIDENCE',
    category: 'contributor',
    value: 'File path',
    default: '`wasm/.test-results/four-mode-conformance.json`.',
    precedence: 'When set, the four-mode conformance suite writes its revision-bound proof to this path.',
    consumer: 'Node/Fastly Native/JavaScript conformance evidence.',
    secretSafety: 'Not a secret. The proof records target identities, support hashes, and test outcomes without application secrets.',
    stability: 'Contributor/release tooling override.',
    description: 'Selects the output path for the four-mode conformance evidence report.',
    sourceFiles: ['wasm/test/contracts/assert-four-mode-conformance.cjs']
  }),
  entry({
    name: 'PULSE_SOURCE_REVISION',
    category: 'contributor',
    value: '40-character lowercase source identity',
    default: 'Current Git commit, or a deterministic archive-tree identity outside a Git checkout.',
    precedence: 'When set by the release runner, every child evidence shard validates and reuses this exact identity.',
    consumer: 'Release-seal task, four-mode, and offline deployment-candidate evidence binding.',
    secretSafety: 'Not a secret. It identifies source but grants no publication or deployment authority.',
    stability: 'Repository release-evidence internal; not an application setting.',
    description: 'Propagates one source identity through an aggregate release replay so independently written evidence cannot drift.',
    sourceFiles: ['scripts/source-identity.cjs']
  }),
  entry({
    name: 'PULSE_SOURCE_IDENTITY_KIND',
    category: 'contributor',
    value: 'Source identity classification',
    default: '`git-commit` in a checkout or `archive-tree-sha256-160` for an extracted source tree.',
    precedence: 'Meaningful only with `PULSE_SOURCE_REVISION`; the release runner supplies both together.',
    consumer: 'Release-seal reports, test reports, four-mode evidence, and offline candidate manifests.',
    secretSafety: 'Not a secret. It prevents an archive digest from being represented as a Git commit.',
    stability: 'Repository release-evidence internal; not an application setting.',
    description: 'Labels the provenance class of the propagated source identity.',
    sourceFiles: ['scripts/source-identity.cjs']
  }),
  entry({
    name: 'PULSE_SOURCE_DIGEST_SHA256',
    category: 'contributor',
    value: '64-character lowercase SHA-256 digest',
    default: 'Unset for Git commits; the full archive-tree digest outside a Git checkout.',
    precedence: 'The release runner supplies it with an archive-tree source identity.',
    consumer: 'Release-seal reports, test reports, four-mode evidence, and offline candidate manifests.',
    secretSafety: 'Not a secret. It is integrity metadata and carries no release authority.',
    stability: 'Repository release-evidence internal; not an application setting.',
    description: 'Preserves the full archive-tree digest behind the compatibility-width source revision field.',
    sourceFiles: ['scripts/source-identity.cjs']
  }),
  entry({
    name: 'PULSE_SOURCE_FILE_COUNT',
    category: 'contributor',
    value: 'Non-negative integer',
    default: 'Unset for Git commits; the deterministic archive-tree inventory count otherwise.',
    precedence: 'The release runner supplies it with an archive-tree source identity.',
    consumer: 'Release-seal reports, test reports, four-mode evidence, and offline candidate manifests.',
    secretSafety: 'Not a secret. It records only the number of source files in the identity inventory.',
    stability: 'Repository release-evidence internal; not an application setting.',
    description: 'Carries the source-file count associated with an archive-tree digest for audit clarity.',
    sourceFiles: ['scripts/source-identity.cjs']
  }),
  entry({
    name: 'PULSE_FAKE_FASTLY_CAPTURE',
    category: 'contributor',
    value: 'File path',
    default: 'Unset.',
    precedence: 'Used only by the fake Fastly CLI fixture when present.',
    consumer: 'Fastly CLI surface test fixture.',
    secretSafety: 'Not a secret. The file records test arguments and paths.',
    stability: 'Fixture-only; not a public tooling setting.',
    description: 'Tells the fake Fastly CLI where to write its captured invocation.',
    sourceFiles: ['wasm/test/provider/assert-fastly-cli-gate-surface.cjs']
  }),
  entry({
    name: 'PULSE_FAKE_VICEROY_CAPTURE',
    category: 'contributor',
    value: 'File path',
    default: 'Unset.',
    precedence: 'Used only by the fake direct-Viceroy fixture when present.',
    consumer: 'Fastly local-engine surface test fixture.',
    secretSafety: 'Not a secret. The file records test arguments and paths.',
    stability: 'Fixture-only; not a public tooling setting.',
    description: 'Tells the fake Viceroy launcher where to write its captured invocation.',
    sourceFiles: ['wasm/test/provider/assert-fastly-cli-gate-surface.cjs']
  }),
  entry({
    name: 'PULSE_ES256_REPRODUCTION_ROOT',
    category: 'contributor',
    value: 'Directory path',
    default: 'Unset; the G5 seal still performs its required local maintainer reconstruction.',
    precedence: 'The `--reproduction-root` G5 option wins, then `PULSE_ES256_REPRODUCTION_ROOT`.',
    consumer: 'Optional independent clean-container output comparison in the ES256 G5 seal.',
    secretSafety: 'Not a secret. The directory must contain only the public verifier source and build output.',
    stability: 'Contributor/test-only proof reproduction control.',
    description: 'Adds an independent source-identical raw guest artifact and Rust metadata comparison to G5.',
    sourceFiles: ['wasm/test/jwt/assert-jwt-es256-final-seal.cjs']
  }),
  entry({
    name: 'PULSE_ES256_REPRODUCTION_ARCHIVE',
    category: 'contributor',
    value: 'File path',
    default: 'Unset; no external archive identity is recorded.',
    precedence: 'The `--reproduction-archive` G5 option wins, then `PULSE_ES256_REPRODUCTION_ARCHIVE`.',
    consumer: 'Optional independent clean-container archive identity in the ES256 G5 seal.',
    secretSafety: 'Not a secret. The archive must contain only the public verifier source and build output.',
    stability: 'Contributor/test-only proof reproduction control.',
    description: 'Records the byte size and hash of the independently supplied ES256 reproduction archive.',
    sourceFiles: ['wasm/test/jwt/assert-jwt-es256-final-seal.cjs']
  }),
  entry({
    name: 'PULSE_RUST_CARGO',
    category: 'contributor',
    value: 'Absolute or relative executable path',
    default: 'No explicit path; discover `cargo` on `PATH`.',
    precedence: '`PULSE_RUST_CARGO` overrides `PATH` discovery in the guest-link proof harnesses.',
    consumer: 'Phase A guest-link Rust fixture compilation and toolchain recording.',
    secretSafety: 'Not a secret. Do not point it at an untrusted executable.',
    stability: 'Contributor/test-only proof reproduction control.',
    description: 'Selects the Cargo executable used to reproduce the sealed first-party Rust guest proof.',
    sourceFiles: [
      'wasm/test/guest-link/assert-scalar-link-control.cjs',
      'wasm/test/guest-link/assert-memory-matrix.cjs',
      'wasm/test/guest-link/assert-final-artifact-reality.cjs'
    ]
  }),
  entry({
    name: 'PULSE_RUSTC',
    category: 'contributor',
    value: 'Absolute or relative executable path',
    default: 'No explicit path; discover `rustc` on `PATH`.',
    precedence: '`PULSE_RUSTC` overrides `PATH` discovery in the guest-link proof harnesses.',
    consumer: 'Phase A guest-link Rust fixture compilation and toolchain recording.',
    secretSafety: 'Not a secret. Do not point it at an untrusted executable.',
    stability: 'Contributor/test-only proof reproduction control.',
    description: 'Selects the Rust compiler used to reproduce the sealed first-party Rust guest proof.',
    sourceFiles: [
      'wasm/test/guest-link/assert-scalar-link-control.cjs',
      'wasm/test/guest-link/assert-memory-matrix.cjs',
      'wasm/test/guest-link/assert-final-artifact-reality.cjs'
    ]
  }),
  entry({
    name: 'PULSEWASM_MEM03_BASE',
    category: 'contributor',
    value: 'Git commit or ref',
    default: 'Merged GEN01 commit `8a6f2ff`.',
    precedence: 'When set, selects the baseline generator source loaded from git; all other dependencies come from the candidate checkout.',
    consumer: 'Manual MEM03 Fastly schema encode materialization proof.',
    secretSafety: 'Not a secret. Use only a trusted baseline generator revision for the proof.',
    stability: 'Contributor/test-only proof reproduction control.',
    description: 'Selects an explicit baseline generator revision for paired semantic and allocator measurements.',
    sourceFiles: ['wasm/test/runtime/compiler-efficiency/mem03-encode-materialization.cjs']
  })
]);

module.exports = Object.freeze({
  ENVIRONMENT_CATEGORIES,
  ENVIRONMENT_VARIABLES
});
