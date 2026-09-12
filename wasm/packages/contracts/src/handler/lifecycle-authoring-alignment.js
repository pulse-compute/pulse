'use strict';

const { ROUTER_API_DEFINITIONS } = require('../definitions/router-api.js');

const LIFECYCLE_AUTHORING_ALIGNMENT_VERSION = 'pulsewasm.lifecycle-authoring-alignment.v1';
const LIFECYCLE_AUTHORING_ALIGNMENT_PHASE = '52';
const LIFECYCLE_AUTHORING_ALIGNMENT_ARTIFACT = 'lifecycle-authoring-alignment.json';
const LIFECYCLE_AUTHORING_ALIGNMENT_CONTRACT_ID = 'pulse.lifecycle-authoring-alignment';

const LIFECYCLE_AUTHORING_ALIGNMENT_SCOPE = Object.freeze({
  betaApp: 'examples/beta-lifecycle/app.js',
  assetsPackageOutApp: 'examples/assets-package-out/app.js',
  command: 'corepack pnpm run -s test:lifecycle-authoring-alignment',
  publicRouterHeadRequired: true,
  routeEffectMethodConsistencyRequired: true,
  doctorAlignmentOutputRequired: true,
  docsExamplesCurrentRequired: true
});

const LIFECYCLE_AUTHORING_ALIGNMENT_POLICY = Object.freeze({
  purpose: 'make the beta lowerable authoring subset explicit and fail fast when route methods and package-owned lowerable effect methods diverge',
  productionCompletenessRequired: false,
  simpleUserFunctionLoweringIntentional: true,
  routerMethods: Object.freeze(ROUTER_API_DEFINITIONS
    .filter((definition) => definition.kind === 'route')
    .map((definition) => definition.method)),
  packageEffectAlignment: Object.freeze({
    assets: Object.freeze({
      rule: 'assets.lookup method must match the owning router route method when route metadata is available',
      diagnostic: 'PULSEWASM_ASSETS_ROUTE_METHOD_MISMATCH',
      fix: 'use router.head(...) with assets.lookup(..., { method: "HEAD" }) or router.get(...) with GET lookups'
    })
  }),
  stillUnsupported: Object.freeze({
    dynamicRouteRegistration: false,
    computedRouterMethods: false,
    dynamicAssetKeys: false,
    dynamicBackends: false,
    asyncAwait: false,
    promises: false,
    arbitraryObjectLowering: false,
    binaryBodies: false,
    streams: false,
    multipart: false,
    uploads: false
  })
});

module.exports = {
  LIFECYCLE_AUTHORING_ALIGNMENT_VERSION,
  LIFECYCLE_AUTHORING_ALIGNMENT_PHASE,
  LIFECYCLE_AUTHORING_ALIGNMENT_ARTIFACT,
  LIFECYCLE_AUTHORING_ALIGNMENT_CONTRACT_ID,
  LIFECYCLE_AUTHORING_ALIGNMENT_SCOPE,
  LIFECYCLE_AUTHORING_ALIGNMENT_POLICY
};
