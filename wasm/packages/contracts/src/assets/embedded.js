'use strict';
// Compile-time admission and host response policy for explicitly embedded bytes.
const LIMITS = Object.freeze({ files:256, fileBytes:262144, totalBytes:1048576, pathBytes:1024, serializedBytes:2097152 });
const VERSION = 'pulse.embedded-assets.v1';
function fail() { throw new TypeError('Invalid or oversized embedded asset manifest.'); }
function fields(value, names) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== names.length || names.some(name=>!Object.hasOwn(value,name))) fail();
}
function assetPath(value) {
  if (typeof value !== 'string' || !value.isWellFormed() || !value.startsWith('/') || value === '/' || Buffer.byteLength(value)>LIMITS.pathBytes
    || /[\\%?#\u0000-\u001f\u007f-\u009f]/u.test(value) || value.slice(1).split('/').some(p=>!p||p==='.'||p==='..')) fail();
  return value;
}
function selectEmbeddedAsset(serialized, key) {
  if (typeof serialized !== 'string' || serialized.length > LIMITS.serializedBytes || Buffer.byteLength(serialized)>LIMITS.serializedBytes) fail();
  let manifest; try { manifest=JSON.parse(serialized); } catch { fail(); }
  // Canonical serialization rejects duplicate fields and ambiguous encodings.
  if (JSON.stringify(manifest)!==serialized) fail();
  fields(manifest,['version','id','byteLength','files']);
  if (manifest.version!==VERSION || !Array.isArray(manifest.files) || manifest.files.length>LIMITS.files) fail();
  const hash = value=>require('node:crypto').createHash('sha256').update(value).digest('hex');
  let total=0,previous='';
  for (const file of manifest.files) {
    fields(file,['path','data','byteLength','sha256','contentType']);
    const path=assetPath(file.path);
    if (path<=previous || !Number.isInteger(file.byteLength) || file.byteLength<0 || file.byteLength>LIMITS.fileBytes
      || typeof file.contentType!=='string' || !/^[\x20-\x7e]{1,128}$/.test(file.contentType) || file.contentType.trim()!==file.contentType
      || typeof file.data!=='string' || file.data.length!==4*Math.ceil(file.byteLength/3)) fail();
    previous=path; total+=file.byteLength; if(total>LIMITS.totalBytes) fail();
    const bytes=Buffer.from(file.data,'base64');
    if(bytes.length!==file.byteLength || bytes.toString('base64')!==file.data || hash(bytes)!==file.sha256) fail();
  }
  if(manifest.byteLength!==total || hash(JSON.stringify([VERSION,manifest.files.map(f=>[f.path,f.contentType,f.byteLength,f.sha256])]))!==manifest.id) fail();
  assetPath(key);
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
