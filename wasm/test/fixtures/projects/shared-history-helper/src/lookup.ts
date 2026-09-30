import {crypto} from '@pulse-compute/crypto';
import {s3} from '@pulse-compute/s3';
import type {IndexRef,IndexNode,IndexPack,IndexOperation} from './types';
export const lookup=async(ctx,owner:string,rootHash:string,rootNode:number,key:string)=>{
 const ixOwner=owner;let ixRoot:IndexRef={hash:rootHash,node:rootNode};const ixKey=key;
 if(ixRoot.hash.length!==64||ixRoot.node<0||ixRoot.node>=2048||ixRoot.node%1!==0)return {code:'HISTORY_INDEX_INVALID',status:503,value:''};
 const ixDigest=await crypto.digestText(ctx,'catalog-history-key-v1|'+ixKey);if(ixDigest.status!=='ok')return {code:'HISTORY_INDEX_UNAVAILABLE',status:503,value:''};
 const ixOperations:IndexOperation[]=[{key:ixKey,digest:ixDigest.sha256,value:'',mode:'get'}];
// Inputs: ixOwner, ixRoot, ixOperations. All persisted nodes are immutable.
// A local reference has an empty hash; its node index selects this pack.
const ixOriginal:IndexRef=ixRoot;
let ixNodes:IndexNode[]=[];let ixResults:string[]=[];let ixInserted:boolean[]=[];
let ixOperation=0;let ixCursor:IndexRef=ixRoot;let ixExpected='';
let ixParent=-1;let ixSlot=-1;let ixError='';let ixChanged=false;let ixStopped=false;
let ixCached='';let ixPack:IndexPack={schemaVersion:1,owner:ixOwner,nodes:[]};
let ixPackHashes:string[]=[];let ixPacks:IndexPack[]=[];
let ixReads=0;
{
for(let ixRound=0;ixRound<64&&ixOperation<ixOperations.length&&ixError===''&&!ixStopped;ixRound++){
 if(ixCursor.hash!==''&&ixCursor.hash!==ixCached){
  for(let ixCache=0;ixCache<65&&ixCache<ixPackHashes.length;ixCache++)if(ixPackHashes[ixCache]===ixCursor.hash){ixPack=ixPacks[ixCache];ixCached=ixCursor.hash;}
 }
 if(ixCursor.hash!==''&&ixCursor.hash!==ixCached){
  let ixHashValid=ixCursor.hash.length===64&&ixCursor.node>=0&&ixCursor.node<2048&&ixCursor.node%1===0;
  for(let ixHex=0;ixHex<64&&ixHex<ixCursor.hash.length;ixHex++){const ixCharacter=ixCursor.hash[ixHex];if(!((ixCharacter>='0'&&ixCharacter<='9')||(ixCharacter>='a'&&ixCharacter<='f')))ixHashValid=false;}
  if(!ixHashValid)return {code:'HISTORY_INDEX_INVALID',status:503,value:''};
  if(ixReads>=65){ixStopped=true;break;}
  const ixRead=await s3.getText(ctx,'objects','catalog/history/index/'+ixCursor.hash+'.json');ixReads++;
  if(ixRead.status!=='found')return {code:'HISTORY_INDEX_UNAVAILABLE',status:503,value:''};
  const ixHash=await crypto.digestText(ctx,ixRead.text);
  if(ixHash.status!=='ok'||ixHash.sha256!==ixCursor.hash||ixHash.byteLength>1835008)return {code:'HISTORY_INDEX_CORRUPT',status:503,value:''};
  ixPack=ctx.decodeJson<IndexPack>(ixRead.text,'history.IndexPack');ixCached=ixCursor.hash;
  if(ixPack.schemaVersion!==1||ixPack.owner!==ixOwner||ixPack.nodes.length<1||ixPack.nodes.length>2048)return {code:'HISTORY_INDEX_INVALID',status:503,value:''};
  ixPackHashes[ixPacks.length]=ixCached;ixPacks[ixPacks.length]=ixPack;
 }
 // Four rounds of this machine permit 4096 pure traversal steps. Each nested
 // loop stays within Pulse's 65536 combined-iteration contract.
 for(let ixStep=0;ixStep<16&&ixOperation<ixOperations.length&&ixError==='';ixStep++){
  if(ixCursor.hash!==''&&ixCursor.hash!==ixCached)break;
  const ixOp=ixOperations[ixOperation];let ixDone=false;let ixFound='';let ixAdded=false;
  if(false&&ixExpected===''&&ixParent===-1&&(ixNodes.length>=960||ixReads>=8)){ixStopped=true;break;}
  if(ixOp.key.length<1||ixOp.key.length>2048||ixOp.digest.length!==64||ixOp.value.length>16384||ixOp.mode!=='get'){ixError='HISTORY_INDEX_INPUT';break;}
  let ixBadDigest=false;for(let ixD=0;ixD<64;ixD++){const ixC=ixOp.digest[ixD];if(!((ixC>='0'&&ixC<='9')||(ixC>='a'&&ixC<='f')))ixBadDigest=true;}
  if(ixBadDigest||ixCursor.node%1!==0||ixCursor.node< -1||(ixCursor.hash!==''&&ixCursor.hash.length!==64)){ixError='HISTORY_INDEX_INVALID';break;}
  if(ixCursor.node===-1){
   if(ixCursor.hash!==''){ixError='HISTORY_INDEX_INVALID';break;}

   ixDone=true;
  }else{
   const ixLocal=ixCursor.hash==='';
   if(ixCursor.node>=(ixLocal?ixNodes.length:ixPack.nodes.length)){ixError='HISTORY_INDEX_INVALID';break;}
   const ixNode=ixLocal?ixNodes[ixCursor.node]:ixPack.nodes[ixCursor.node];
   let ixPrefixValid=ixNode.prefix.length>=ixExpected.length&&ixNode.prefix.length<=64;
   let ixCommon='';let ixMatch=true;
   for(let ixP=0;ixP<64&&ixP<ixNode.prefix.length;ixP++){
    const ixC=ixNode.prefix[ixP];if(!((ixC>='0'&&ixC<='9')||(ixC>='a'&&ixC<='f')))ixPrefixValid=false;
    if(ixP<ixExpected.length&&ixC!==ixExpected[ixP])ixPrefixValid=false;
    if(ixC!==ixOp.digest[ixP])ixMatch=false;
    if(ixMatch)ixCommon+=ixC;
   }
   const ixLeaf=ixNode.prefix.length===64;
   if(!ixPrefixValid||(ixLeaf?(ixNode.children.length!==0||ixNode.key===''||ixNode.value===''):(ixNode.children.length!==16||ixNode.key!==''||ixNode.value!==''))){ixError='HISTORY_INDEX_INVALID';break;}
   if(!ixMatch){

    ixDone=true;
   }else if(ixLeaf){
    if(ixNode.key!==ixOp.key){ixError='HISTORY_INDEX_KEY_COLLISION';break;}
    ixFound=ixNode.value;

    ixDone=true;
   }else{
    let ixBranchNumber=ixCursor.node;let ixChildren:IndexRef[]=[];let ixNonempty=0;
    for(let ixChild=0;ixChild<16;ixChild++){
     const ixRef=ixNode.children[ixChild];
     if(ixRef.node%1!==0||ixRef.node< -1||ixRef.node>=2048||(ixRef.hash!==''&&ixRef.hash.length!==64)||(ixRef.node===-1&&ixRef.hash!=='')){ixError='HISTORY_INDEX_INVALID';break;}
     if(ixRef.node>=0)ixNonempty++;
     ixChildren[ixChild]={hash:ixRef.node>=0&&ixRef.hash===''&&!ixLocal?ixCursor.hash:ixRef.hash,node:ixRef.node};
    }
    if(ixError!==''||ixNonempty<2){ixError='HISTORY_INDEX_INVALID';break;}
    const ixDigits='0123456789abcdef';let ixChildSlot=-1;
    for(let ixDigit=0;ixDigit<16;ixDigit++)if(ixDigits[ixDigit]===ixOp.digest[ixNode.prefix.length])ixChildSlot=ixDigit;
    if(ixChildSlot<0){ixError='HISTORY_INDEX_INVALID';break;}

    ixExpected=ixNode.prefix+ixDigits[ixChildSlot];
    ixParent=-1;ixSlot=ixChildSlot;
    ixCursor=ixChildren[ixChildSlot];
   }
  }
  if(ixNodes.length>2048){ixError='HISTORY_INDEX_PREPARATION_LIMIT';break;}
  if(ixDone){ixResults[ixOperation]=ixFound;ixInserted[ixOperation]=ixAdded;ixOperation++;ixCursor=ixRoot;ixExpected='';ixParent=-1;ixSlot=-1;}
 }
}

}
{
for(let ixRound=0;ixRound<64&&ixOperation<ixOperations.length&&ixError===''&&!ixStopped;ixRound++){
 if(ixCursor.hash!==''&&ixCursor.hash!==ixCached){
  for(let ixCache=0;ixCache<65&&ixCache<ixPackHashes.length;ixCache++)if(ixPackHashes[ixCache]===ixCursor.hash){ixPack=ixPacks[ixCache];ixCached=ixCursor.hash;}
 }
 if(ixCursor.hash!==''&&ixCursor.hash!==ixCached){
  let ixHashValid=ixCursor.hash.length===64&&ixCursor.node>=0&&ixCursor.node<2048&&ixCursor.node%1===0;
  for(let ixHex=0;ixHex<64&&ixHex<ixCursor.hash.length;ixHex++){const ixCharacter=ixCursor.hash[ixHex];if(!((ixCharacter>='0'&&ixCharacter<='9')||(ixCharacter>='a'&&ixCharacter<='f')))ixHashValid=false;}
  if(!ixHashValid)return {code:'HISTORY_INDEX_INVALID',status:503,value:''};
  if(ixReads>=65){ixStopped=true;break;}
  const ixRead=await s3.getText(ctx,'objects','catalog/history/index/'+ixCursor.hash+'.json');ixReads++;
  if(ixRead.status!=='found')return {code:'HISTORY_INDEX_UNAVAILABLE',status:503,value:''};
  const ixHash=await crypto.digestText(ctx,ixRead.text);
  if(ixHash.status!=='ok'||ixHash.sha256!==ixCursor.hash||ixHash.byteLength>1835008)return {code:'HISTORY_INDEX_CORRUPT',status:503,value:''};
  ixPack=ctx.decodeJson<IndexPack>(ixRead.text,'history.IndexPack');ixCached=ixCursor.hash;
  if(ixPack.schemaVersion!==1||ixPack.owner!==ixOwner||ixPack.nodes.length<1||ixPack.nodes.length>2048)return {code:'HISTORY_INDEX_INVALID',status:503,value:''};
  ixPackHashes[ixPacks.length]=ixCached;ixPacks[ixPacks.length]=ixPack;
 }
 // Four rounds of this machine permit 4096 pure traversal steps. Each nested
 // loop stays within Pulse's 65536 combined-iteration contract.
 for(let ixStep=0;ixStep<16&&ixOperation<ixOperations.length&&ixError==='';ixStep++){
  if(ixCursor.hash!==''&&ixCursor.hash!==ixCached)break;
  const ixOp=ixOperations[ixOperation];let ixDone=false;let ixFound='';let ixAdded=false;
  if(false&&ixExpected===''&&ixParent===-1&&(ixNodes.length>=960||ixReads>=8)){ixStopped=true;break;}
  if(ixOp.key.length<1||ixOp.key.length>2048||ixOp.digest.length!==64||ixOp.value.length>16384||ixOp.mode!=='get'){ixError='HISTORY_INDEX_INPUT';break;}
  let ixBadDigest=false;for(let ixD=0;ixD<64;ixD++){const ixC=ixOp.digest[ixD];if(!((ixC>='0'&&ixC<='9')||(ixC>='a'&&ixC<='f')))ixBadDigest=true;}
  if(ixBadDigest||ixCursor.node%1!==0||ixCursor.node< -1||(ixCursor.hash!==''&&ixCursor.hash.length!==64)){ixError='HISTORY_INDEX_INVALID';break;}
  if(ixCursor.node===-1){
   if(ixCursor.hash!==''){ixError='HISTORY_INDEX_INVALID';break;}

   ixDone=true;
  }else{
   const ixLocal=ixCursor.hash==='';
   if(ixCursor.node>=(ixLocal?ixNodes.length:ixPack.nodes.length)){ixError='HISTORY_INDEX_INVALID';break;}
   const ixNode=ixLocal?ixNodes[ixCursor.node]:ixPack.nodes[ixCursor.node];
   let ixPrefixValid=ixNode.prefix.length>=ixExpected.length&&ixNode.prefix.length<=64;
   let ixCommon='';let ixMatch=true;
   for(let ixP=0;ixP<64&&ixP<ixNode.prefix.length;ixP++){
    const ixC=ixNode.prefix[ixP];if(!((ixC>='0'&&ixC<='9')||(ixC>='a'&&ixC<='f')))ixPrefixValid=false;
    if(ixP<ixExpected.length&&ixC!==ixExpected[ixP])ixPrefixValid=false;
    if(ixC!==ixOp.digest[ixP])ixMatch=false;
    if(ixMatch)ixCommon+=ixC;
   }
   const ixLeaf=ixNode.prefix.length===64;
   if(!ixPrefixValid||(ixLeaf?(ixNode.children.length!==0||ixNode.key===''||ixNode.value===''):(ixNode.children.length!==16||ixNode.key!==''||ixNode.value!==''))){ixError='HISTORY_INDEX_INVALID';break;}
   if(!ixMatch){

    ixDone=true;
   }else if(ixLeaf){
    if(ixNode.key!==ixOp.key){ixError='HISTORY_INDEX_KEY_COLLISION';break;}
    ixFound=ixNode.value;

    ixDone=true;
   }else{
    let ixBranchNumber=ixCursor.node;let ixChildren:IndexRef[]=[];let ixNonempty=0;
    for(let ixChild=0;ixChild<16;ixChild++){
     const ixRef=ixNode.children[ixChild];
     if(ixRef.node%1!==0||ixRef.node< -1||ixRef.node>=2048||(ixRef.hash!==''&&ixRef.hash.length!==64)||(ixRef.node===-1&&ixRef.hash!=='')){ixError='HISTORY_INDEX_INVALID';break;}
     if(ixRef.node>=0)ixNonempty++;
     ixChildren[ixChild]={hash:ixRef.node>=0&&ixRef.hash===''&&!ixLocal?ixCursor.hash:ixRef.hash,node:ixRef.node};
    }
    if(ixError!==''||ixNonempty<2){ixError='HISTORY_INDEX_INVALID';break;}
    const ixDigits='0123456789abcdef';let ixChildSlot=-1;
    for(let ixDigit=0;ixDigit<16;ixDigit++)if(ixDigits[ixDigit]===ixOp.digest[ixNode.prefix.length])ixChildSlot=ixDigit;
    if(ixChildSlot<0){ixError='HISTORY_INDEX_INVALID';break;}

    ixExpected=ixNode.prefix+ixDigits[ixChildSlot];
    ixParent=-1;ixSlot=ixChildSlot;
    ixCursor=ixChildren[ixChildSlot];
   }
  }
  if(ixNodes.length>2048){ixError='HISTORY_INDEX_PREPARATION_LIMIT';break;}
  if(ixDone){ixResults[ixOperation]=ixFound;ixInserted[ixOperation]=ixAdded;ixOperation++;ixCursor=ixRoot;ixExpected='';ixParent=-1;ixSlot=-1;}
 }
}

}
if(ixError!=='')return {code:ixError,status:503,value:''};
if(ixOperation!==ixOperations.length&&!false)return {code:'HISTORY_INDEX_WORK_LIMIT',status:409,value:''};
if(!ixChanged)ixRoot=ixOriginal;

return {code:'',status:200,value:ixResults[0]};
}
