export interface IndexRef {hash:string;node:number}
export interface IndexNode {prefix:string;key:string;value:string;children:IndexRef[]}
export interface IndexPack {schemaVersion:number;owner:string;nodes:IndexNode[]}
export interface IndexOperation {key:string;digest:string;value:string;mode:string}
export interface IndexResult {root:IndexRef;values:string[];inserted:boolean[]}
export interface HistoryRecord {revision:number;receipt:string;state:string;audit:string;offset:number}
