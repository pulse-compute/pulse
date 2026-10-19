'use strict';
// Internal shared integrity parser. Callers own admission policy; HTTP Assets
// always supplies its original fixed limits. Resources supply explicit budgets.
const VERSION = 'pulse.embedded-assets.v1';
function fields(value, names, fail) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== names.length || names.some(name=>!Object.hasOwn(value,name))) fail();
}
function assetPath(value, limits, fail) {
  if (typeof value !== 'string' || !value.isWellFormed() || !value.startsWith('/') || value === '/' || Buffer.byteLength(value)>limits.pathBytes
    || /[\\%?#\u0000-\u001f\u007f-\u009f]/u.test(value) || value.slice(1).split('/').some(p=>!p||p==='.'||p==='..')) fail();
  return value;
}
function validateEmbeddedManifest(serialized, limits, fail) {
  if (typeof serialized !== 'string' || serialized.length > limits.serializedBytes || Buffer.byteLength(serialized)>limits.serializedBytes) fail();
  let manifest; try { manifest=JSON.parse(serialized); } catch { fail(); }
  // Canonical serialization rejects duplicate fields and ambiguous encodings.
  if (JSON.stringify(manifest)!==serialized) fail();
  fields(manifest,['version','id','byteLength','files'], fail);
  if (manifest.version!==VERSION || !Array.isArray(manifest.files) || manifest.files.length>limits.files) fail();
  const hash = value=>require('node:crypto').createHash('sha256').update(value).digest('hex');
  let total=0,previous='';
  for (const file of manifest.files) {
    fields(file,['path','data','byteLength','sha256','contentType'], fail);
    const path=assetPath(file.path, limits, fail);
    if (path<=previous || !Number.isInteger(file.byteLength) || file.byteLength<0 || file.byteLength>limits.fileBytes
      || typeof file.contentType!=='string' || !/^[\x20-\x7e]{1,128}$/.test(file.contentType) || file.contentType.trim()!==file.contentType
      || typeof file.data!=='string' || file.data.length!==4*Math.ceil(file.byteLength/3)) fail();
    previous=path; total+=file.byteLength; if(total>limits.totalBytes) fail();
    const bytes=Buffer.from(file.data,'base64');
    if(bytes.length!==file.byteLength || bytes.toString('base64')!==file.data || hash(bytes)!==file.sha256) fail();
  }
  if(manifest.byteLength!==total || hash(JSON.stringify([VERSION,manifest.files.map(f=>[f.path,f.contentType,f.byteLength,f.sha256])]))!==manifest.id) fail();
  return manifest;
}
module.exports = { VERSION, assetPath, validateEmbeddedManifest };
