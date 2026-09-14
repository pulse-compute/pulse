# S3 conformance

`read.json` contains exact key-encoding and raw-body vectors. The package
contract records all three operations: `head`, `getText` and `putText`.

Repository acceptance runs the same read and write failure corpus against
Node Native, Node JavaScript and Fastly Native, then repeats it with the exact
installed release tarballs. It checks independent SigV4 signatures, UTF-8,
metadata limits, truncation, deadlines, write uncertainty and secret redaction.
Fastly Native executes compiled Wasm against host ABI fixtures. These checks
do not establish live origin behavior; that evidence follows infrastructure
setup. Fastly JavaScript is ineligible for S3 because its SDK loses raw header
metadata. See the [S3 guide](https://pulsecompute.io/v1.0.0-beta.3/packages/s3/).
