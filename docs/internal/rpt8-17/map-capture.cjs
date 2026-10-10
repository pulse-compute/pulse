'use strict';
// Evidence-only observer. Return exactly the emitted bytes; maps stay sideband.
const fs=require('node:fs');
module.exports=class MapCapture {
  afterCompile(module){
    const emit=module.emitBinary.bind(module);
    module.emitBinary=(...args)=>{
      const result=emit(...args);
      if(args.length && result.sourceMap)fs.writeFileSync(process.env.RPT817_MAP_FILE,result.sourceMap);
      return result;
    };
  }
};
