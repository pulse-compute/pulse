'use strict';

// Monotonic intervals are adjacent, so stage durations add to the recorded total.
// The end is the inventory capture boundary, before report serialization/writes.
function startBuild() {
  const started = process.hrtime.bigint(), stages = [];
  let elapsed = 0;
  return {
    mark(name) {
      const next = Math.round(Number(process.hrtime.bigint() - started) / 1e6);
      stages.push({ name, durationMs: next - elapsed }); elapsed = next;
    },
    finish(prepared, artifacts, operation) {
      this.mark('verification and manifest');
      const compilers = [];
      function add(phase, observation, hash) {
        const artifact = artifacts.find(row => row.sha256 === hash);
        if (observation && artifact) compilers.push({ phase, artifactId: artifact.id, ...observation });
      }
      add('portable', prepared.native.buildObservation, prepared.native.manifest.wasm.sha256);
      add('provider', prepared.providerBuildObservation, artifacts[0].sha256);
      const providerReuse = operation === 'compile' ? 'not-applicable'
        : prepared.providerPortableReuse === true ? 'reused' : prepared.providerBuildObservation ? 'not-reused' : 'not-recorded';
      const complete = compilers.some(row => row.phase === 'portable')
        && (operation === 'compile' || providerReuse === 'reused' || compilers.some(row => row.phase === 'provider'));
      return { version: 1, operation, timingScope: 'build-start-through-inventory-capture',
        totalDurationMs: elapsed, compilationDurationMs: complete ? compilers.reduce((sum, row) => sum + row.durationMs, 0) : null,
        stages, compilers, providerArtifactReuse: providerReuse, cache: 'not-recorded' };
    }
  };
}
module.exports = { startBuild };
