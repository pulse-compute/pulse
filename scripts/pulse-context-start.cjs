'use strict';
// Deterministic authoring of one finite tool; all execution remains ordinary ctx.call.
const TOOLS = require('./pulse-context-tools.cjs');
const PROJECT = 'examples/12-pulse-context-mcp';
const APP = `${PROJECT}/application`;
const INPUTS = ['scripts/pulse-context-start.json', `${APP}/.pulse/config.template.ts`,
  `${APP}/src/start.template.ts`, `${APP}/src/index.template.ts`,
  `${PROJECT}/src/schemas.ts`, `${APP}/package.json`, `${APP}/tsconfig.json`, ...TOOLS.INPUTS];
function generate(corpus, config, files, manifest, read) {
  const declaration = JSON.parse(read(INPUTS[0]));
  if (declaration.goals.length !== 4 || new Set(declaration.goals.map(g => g.id)).size !== 4) throw Error('Expected four distinct starter goals');
  const record = id => { const r = corpus.records.find(r => r.id === id); if (!r) throw Error(`Missing starter record ${id}`); return r; };
  const summary = id => { const { content, pulseVersion, status, ...r } = record(id); return r; };
  const meta = { pulseVersion: corpus.pulseVersion, corpusSchemaVersion: corpus.schemaVersion,
    corpusHash: corpus.corpusHash, snapshotStatus: corpus.status, applicationVersion: config.applicationVersion,
    maxReplyBytes: config.limits.toolReplyBytes };
  const common = { meta, supportedGoals: declaration.goals.map(g => g.id),
    supportedSelections: [{provider:'node',target:'native'},{provider:'node',target:'javascript'}] };
  // Only this private sentinel is substituted with source; user/corpus strings
  // remain JSON-escaped literals. Reject sentinel collisions before substitution.
  const sentinel = '__PULSE_START_REQUEST_VERSION__';
  if (JSON.stringify(corpus).includes(sentinel)) throw Error('Starter source sentinel collision');
  function response(value, requested = true) {
    const result = {...common,...value,meta:{...meta,...(requested ? {requestedVersion:sentinel} : {})}};
    return JSON.stringify(result).replace(JSON.stringify(sentinel),'input.version');
  }
  const error = (status, code, message, requested = true) => response({status,error:{code,message}},requested);
  const invalidVersion = ['invalid-input','invalid-version','Supply an exact version of at most 64 UTF-8 bytes.'];
  let body = `  if (versionBytes > 64) return ${error(...invalidVersion,false)}\n`
    + `  if (input.version.length === 0) return ${error(...invalidVersion)}\n`
    + `  if (input.version !== ${JSON.stringify(corpus.pulseVersion)}) return ${error('version-mismatch','version-mismatch','The requested version is not bundled. See meta.pulseVersion; no fallback was selected.')}\n`
    + `  if (goalBytes === 0 || goalBytes > 192 || providerBytes === 0 || providerBytes > 192 || targetBytes === 0 || targetBytes > 192) return ${error('invalid-input','invalid-selection','Goal/provider/target must be nonempty bounded names.')}\n`
    + `  if (${declaration.goals.map(g=>`input.goal !== ${JSON.stringify(g.id)}`).join(' && ')}) return ${error('unknown-goal','unknown-goal','Choose one of supportedGoals.')}\n`
    + `  if (input.provider !== 'node' || (input.target !== 'native' && input.target !== 'javascript')) return ${error('unsupported-selection','unsupported-starter','This snapshot has maintained Node starter examples only. Wider provider contracts remain available through search/read.')}\n`
    + `  const text = ctx.resources.map('context.text')\n`;
  const plans = [];
  for (const goal of declaration.goals) for (const target of ['native','javascript']) {
    const configuration = record(`example/${goal.example}/.pulse/config.ts`);
    const pkg = JSON.parse(record(`example/${goal.example}/package.json`).content);
    const dependencies = ['dependencies','devDependencies'].flatMap((field,i)=>Object.entries(pkg[field] || {}).map(([name,version])=>({name,version,kind:i?'development':'runtime'})));
    for (const d of dependencies) if(d.name.startsWith('@pulse-compute/') && d.version !== corpus.pulseVersion) throw Error('Starter dependency version mismatch');
    const adapted = target === 'javascript';
    const content = adapted ? configuration.content.replace("target: 'native'", "target: 'javascript'") : configuration.content;
    if (configuration.content.split("target: 'native'").length !== 2) throw Error('Starter target adaptation must identify exactly one field');
    const plan = {goal:goal.id,provider:'node',target,imports:goal.id==='schema-api'?['@pulse-compute/pulse','@pulse-compute/pulse/schema']:['@pulse-compute/pulse'],dependencies,
      configuration:{path:'.pulse/config.ts',sourceId:configuration.id,content,changedFields:adapted?['local.target: native -> javascript']:[]},
      contracts:[...goal.contracts,'start/requirements','command/init','command/doctor','command/test','command/build'].map(summary),
      exampleId:goal.example,exampleApplicability:configuration.applicability,
      commands:[
        {command:'pulse init ./my-pulse-app',purpose:'Create the workspace locally, then choose its name and copy the selected example files/configuration.',sourceId:'command/init'},
        {command:'cd ./my-pulse-app',purpose:'Enter the local project.',sourceId:'start/create'},
        {command:'npm install',purpose:'Install the exact dependencies listed in this plan.',sourceId:'start/create'},
        {command:'pulse doctor --profile local',purpose:'Audit the chosen project locally.',sourceId:'command/doctor'},
        {command:'pulse test --profile local',purpose:'Run the chosen harness locally.',sourceId:'command/test'},
        {command:'pulse build --profile local',purpose:'Build the explicitly selected provider/target locally.',sourceId:'command/build'}],
      unresolvedChoices:[...goal.choices,'Choose a local directory and install the required toolchain. No commands or file writes have been performed.',...(adapted?['The bundled example retains its Node Native provenance. Apply the explicit target change above and validate JavaScript locally.']:[])]};
    // Worst echoed version is 64 ASCII control characters, six JSON bytes each.
    const upperBound = Buffer.byteLength(JSON.stringify({...common,status:'ok',plan,meta:{...meta,requestedVersion:'\0'.repeat(64)}}));
    if(TOOLS.projectedSize({...common,status:'ok',plan,meta:{...meta,requestedVersion:corpus.pulseVersion}},corpus.pulseVersion)>config.limits.toolReplyBytes) throw Error('Starter MCP result exceeds tool byte budget');
    if(upperBound>config.limits.toolReplyBytes) throw Error('Starter reply exceeds tool byte budget');
    const row=corpus.records.indexOf(configuration), bytes=files['text.bin'];
    const begin=bytes.readUInt32LE(64+row*12), length=bytes.readUInt32LE(68+row*12);
    if(length>config.limits.readRawBytes)throw Error('Starter configuration exceeds one bounded UTF-8 resource read');
    let expression=`text.readUtf8(${begin}, ${length})`;
    if(adapted){const before=Buffer.byteLength(configuration.content.split("target: 'native'")[0]);const after=before+Buffer.byteLength("target: 'native'");
      expression=`text.readUtf8(${begin}, ${before}) + "target: 'javascript'" + text.readUtf8(${begin+after}, ${length-after})`;}
    const planSentinel='__PULSE_START_CONFIGURATION__';
    if(JSON.stringify(plan).includes(planSentinel))throw Error('Starter configuration sentinel collision');
    const source=response({status:'ok',plan:{...plan,configuration:{...plan.configuration,content:planSentinel}}}).replace(JSON.stringify(planSentinel),expression);
    body+=`  if (input.goal === ${JSON.stringify(goal.id)} && input.target === ${JSON.stringify(target)}) return ${source}\n`;
    plans.push({goal:goal.id,target,configurationRow:row,maxReplyBytes:upperBound});
  }
  body+=`  return ${error('unknown-goal','unknown-goal','Choose one of supportedGoals.')}\n`;
  const substitute = (source, token, value) => {if(source.split(token).length!==2)throw Error(`Expected one ${token} in starter template`);return source.replace(token,()=>value);};
  const replace = (file, token, value) => substitute(read(file).toString(),token,value);
  let index=replace(INPUTS[3],'__TOOL_METADATA__',JSON.stringify(declaration.tool));
  index=substitute(index,'__SERVER_INFO__',JSON.stringify({name:'pulse-context',version:corpus.pulseVersion}));
  index=substitute(index,'__MCP_LIMITS__',JSON.stringify({maxRequestBytes:config.limits.requestBytes,maxResponseBytes:config.limits.mcpResponseBytes,maxDepth:config.limits.requestDepth,deadlineMs:config.limits.deadlineMs}));
  const tools = TOOLS.generate(corpus, config, files, read);
  for (const [name, metadata] of Object.entries(tools.declarations)) index=substitute(index,`__${name.toUpperCase()}_METADATA__`,JSON.stringify(metadata));
  const outputs = new Map([
    [`${APP}/.pulse/config.ts`, Buffer.from(replace(INPUTS[1],"'__CONTEXT_RESOURCE_MANIFEST__'",JSON.stringify(JSON.stringify(manifest))))],
    [`${APP}/src/start.ts`,Buffer.from(replace(INPUTS[2],'__START_BODY__',body))],
    [`${APP}/src/index.ts`,Buffer.from(index)],
    [`${APP}/src/schemas.ts`,read(`${PROJECT}/src/schemas.ts`)]
  ]);
  for (const [file, bytes] of tools.outputs) outputs.set(file, bytes);
  return {outputs,metadata:{version:'pulse.context-tools.v2',tools:['pulse.start','pulse.search','pulse.read','pulse.example','pulse.diagnostic'],plans}};
}
module.exports={APP,INPUTS,generate};
