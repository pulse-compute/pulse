'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {prepare}=require('./prepare.cjs');
const {hash}=require('./bundle.cjs');
const {installedAcceptanceReport}=require('../../support/installed-acceptance-report.cjs');
const output=process.argv[2]||fs.mkdtempSync(path.join(path.resolve(__dirname,'../../../../..'),'pulse-terminal-evidence-'));
prepare(output).then(receipt=>{
 const report={status:'passed',source:receipt.candidate.sourceRevision,sourceTree:receipt.candidate.sourceTree,workingTree:'',workingDiffSha256:hash(''),acceptanceScriptSha256:hash(fs.readFileSync(__filename)),packages:receipt.packages,bundle:path.resolve(output),installedReceiptSha256:hash(fs.readFileSync(path.join(output,'installed.json'))),transportQualified:false};
 fs.writeFileSync(installedAcceptanceReport(path.join(output,'acceptance.json')),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));
}).catch(error=>{console.error(error);process.exitCode=1;});
