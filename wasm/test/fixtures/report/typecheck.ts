import { collectArtifactReport, collectProjectReport } from '../../../packages/cli/src/internal/report/retained';
import { parseCapsule, createCapsule, htmlPayload } from '../../../packages/cli/src/internal/report/capsule';
import { admitCompletedBuild, validateAttribution } from '../../../packages/cli/src/internal/report/completion';
import { projectSchema } from '../../../packages/cli/src/internal/report/schema-projection';
import type { ReportCapsule, ReportCompletion, ReportAttribution } from '../../../packages/cli/src/internal/report/model';

const capsule: ReportCapsule = parseCapsule('{}');
const roundTrip: ReportCapsule = createCapsule(capsule);
const html: string = htmlPayload(roundTrip);
const descriptorBytes: number | null = projectSchema({}).descriptorBytes;
const result: ReportCompletion = admitCompletedBuild({}, new Uint8Array(), { files: new Map() }).completion;
const attribution: ReportAttribution = validateAttribution({});
// @ts-expect-error capsule records are immutable
capsule.routes.push({});
// @ts-expect-error Javascript is not a Report representation
const target: ReportCapsule['context']['target'] = 'javascript';
void [html, descriptorBytes, result, attribution, target];

const retained: ReportCapsule = collectArtifactReport('pulse-build.json').capsule;
const matched: boolean = collectProjectReport({ cwd: '.', profile: 'native' }).currentSnapshotMatched;
void [retained, matched];
