'use strict';
module.exports=Object.freeze({
 version:'pulsewasm.lowerable-library-manifest.v2',kind:'pulsewasm.lowerable-library-manifest',
 contractId:'pulse.cache',npmPackage:'@pulse-compute/cache',lowerableSubpath:'@pulse-compute/cache',
 facade:{namespace:'cache',import:'@pulse-compute/cache',symbols:['getText','putText']},
 publicApi:{package:'@pulse-compute/cache',symbols:['cache'],compatibilitySubpaths:[],loweringIntentionallyNarrow:true},
 compiler:{version:'pulsewasm.lowerable-compiler-builder.v1',entry:'./pulsewasm.compiler.cjs',export:'buildCacheLoweringPlan',artifact:'cache-lowering-plan.json',builderOwner:'@pulse-compute/cache',trust:'first-party',inputs:['typescript.SourceFile']},
 modes:{typescript:{entry:'./src/index.js'},jsEngine:{entry:'./src/index.js',behavior:'unsupported'},
 wasm:{mode:'wasm-sidecar',sidecar:'./as/cache.as.ts',lowerings:['getText','putText'].map(name=>({tsSymbol:'cache.'+name,asSymbol:'__pulse_cache_effect',callShape:'context-literal-key-options',hostCapabilities:['result']})),hostCapabilities:['result']}},
 policy:{packageOwnsFacadeMapping:true,canonicalRootLowering:true,automaticFallback:false}
});
