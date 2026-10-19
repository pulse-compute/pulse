'use strict';
// Compile-time admission and host response policy for explicitly embedded bytes.
const LIMITS = Object.freeze({ files:256, fileBytes:262144, totalBytes:1048576, pathBytes:1024, serializedBytes:2097152 });
function fail() { throw new TypeError('Invalid or oversized embedded asset manifest.'); }
const { assetPath, validateEmbeddedManifest } = require('./embedded-manifest.js');
function selectEmbeddedAsset(serialized, key) {
  const manifest = validateEmbeddedManifest(serialized, LIMITS, fail);
  assetPath(key, LIMITS, fail);
  const file=manifest.files.find(f=>f.path===key);
  return Object.freeze({embeddedId:manifest.id,embeddedFound:!!file,embeddedData:file?.data??'',embeddedLength:file?.byteLength??0,embeddedType:file?.contentType??'',embeddedEtag:file?`"${file.sha256}"`:''});
}
function embeddedAssetResponse(payload, requestHeaders) {
  const headers=new Headers(requestHeaders), output=new Headers();
  const length=payload.embeddedLength;
  if(!payload.embeddedFound) return {status:404,headers:output,bytes:null};
  if(!Number.isInteger(length)||length<0||length>LIMITS.fileBytes||typeof payload.embeddedData!=='string'||payload.embeddedData.length!==4*Math.ceil(length/3)) fail();
  output.set('content-type',payload.embeddedType); output.set('etag',payload.embeddedEtag); output.set('accept-ranges','bytes');
  const validator=headers.get('if-none-match');
  if(validator!==null) {
    if(!/^(?:\*|(?:W\/)?"[\x21\x23-\x7e]*")$/.test(validator)) return {status:400,headers:new Headers(),bytes:null};
    if(validator==='*'||validator.replace(/^W\//,'')===payload.embeddedEtag) return {status:304,headers:output,bytes:null};
  }
  let start=0,end=length-1,status=200;
  const range=headers.get('range'), ifRange=headers.get('if-range');
  if(payload.method==='GET'&&range!==null&&(ifRange===null||ifRange===payload.embeddedEtag)) {
    const match=/^bytes=(0|[1-9][0-9]*)-(0|[1-9][0-9]*)$/.exec(range);
    if(!match||!Number.isSafeInteger(Number(match[2]))||Number(match[1])>Number(match[2])) return {status:400,headers:new Headers(),bytes:null};
    start=Number(match[1]);end=Math.min(Number(match[2]),end);
    if(start>=length){output.set('content-range',`bytes */${length}`);return {status:416,headers:output,bytes:null};}
    status=206;output.set('content-range',`bytes ${start}-${end}/${length}`);
  }
  output.set('content-length',String(Math.max(0,end-start+1)));
  const bytes=payload.method==='HEAD'?null:Buffer.from(payload.embeddedData,'base64').subarray(start,end+1);
  return {status,headers:output,bytes};
}
function embeddedNativeSource() { return require('node:fs').readFileSync(require('node:path').join(__dirname,'embedded.as.ts'),'utf8'); }
module.exports={embeddedNativeSource,EMBEDDED_ASSET_NATIVE_LIMITS:LIMITS,selectEmbeddedAsset,embeddedAssetResponse};
