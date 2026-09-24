/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 */

import { jsonSchema, tool } from 'ai';
import { PLUGIN_VERSION } from '../../mol-plugin/version';
import { PluginUIContext } from '../../mol-plugin-ui/context';
import { loadPdb } from '../plugin/loaders';

// Initial closed tool catalog. Additional Viewer operations will be added later.
const PdbIdPattern = '^(?:[1-9][A-Za-z0-9]{3}|[Pp][Dd][Bb]_[0-9]{4}[1-9][A-Za-z0-9]{3})$';
const PdbIdRegex = new RegExp(PdbIdPattern);
export function createMolstarTools(plugin: PluginUIContext) {
    const tools = {
        version: tool({
            description: 'returns current molstar version',
            inputSchema: jsonSchema<{}>({
                type: 'object',
                additionalProperties: false,
                properties: {}
            }),
            execute: async (_: {}) => {
                return PLUGIN_VERSION;
            }
        }),
        loadPDB: tool({
            description: 'loads a PDB structure',
            inputExamples: [{
                input: {
                    pdbId: '1tqn'
                }
            }],
            inputSchema: jsonSchema<{
                pdbId: string
            }>({
                type: 'object',
                properties: {
                    pdbId: { type: 'string', pattern: PdbIdPattern, minLength: 4, maxLength: 12 }
                },
                required: ['pdbId'],
                additionalProperties: false
            }),
            execute: async ({ pdbId }: { pdbId: string }) => {
                const id = pdbId.trim().toUpperCase();
                if (!PdbIdRegex.test(id)) throw new Error('Invalid PDB ID.');
                await loadPdb(plugin, id);
                return { status: 'succeeded' as const, pdbId: id };
            }
        }),
    };
    return tools;
}