import {defineSchemaRegistry,schema} from '@pulse-compute/pulse/schema';
import type {IndexPack} from './types';
export default defineSchemaRegistry({schemas:{'history.IndexPack':schema<IndexPack>()}});
