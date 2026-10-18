# Tagged release metadata

Release preparation writes `v<version>.json` here from the previous release's
exact Git tag. These files contain product release manifests, not rendered
documentation, storage receipts or proof that an exact version was hosted.

The corresponding `documentation-versions.json` entry retains `status: archived`
for existing version-catalog readers and records `deliveryOwner: website`, the
source tag, commit and manifest digest. Preparation, PR qualification and tagging
validate the source binding. Existing entries must not be relabeled or rewritten.

Website delivery and the owner's existing recovery retain responsibility for
historical HTML and response metadata. The seven legacy trees in
`../documentation-site-archives/` remain unchanged for their current consumers.
