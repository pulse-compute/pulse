'use strict';
// Reuse the externally enforced VIS-06 watchdog, including failed receipts.
const path=require('node:path');
const {supervise}=require('./vis06-run.cjs');
const [input,output]=process.argv.slice(2);
if(!input||!output)throw Error('Usage: vis07-run.cjs INPUT OUTPUT');
supervise({input:path.resolve(input),output:path.resolve(output),mode:'relations-qualified',
  timeoutMs:600000,rssMiB:1536,heapMiB:1024,worker:path.join(__dirname,'vis07-worker.cjs')})
  .then(r=>{console.log(JSON.stringify({status:r.status,failure:r.failure,output}));process.exitCode=r.status==='completed'?0:1;});
