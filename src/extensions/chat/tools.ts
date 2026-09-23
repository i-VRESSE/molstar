/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 */

import { jsonSchema, tool } from 'ai';
import { PLUGIN_VERSION } from '../../mol-plugin/version';
import { PluginUIContext } from '../../mol-plugin-ui/context';
import { loadPdb } from '../plugin/loaders';

// Developer prototype for the later tool milestone. The Milestone 1 transport
// intentionally does not import or register these tools.
export function createMolstarTools(plugin: PluginUIContext) {
    const tools = {
        version: tool({
            description: 'returns current molstar version',
            inputSchema: jsonSchema<{}>({
                type: 'object'
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
                    pdbId: { type: 'string' }
                },
                required: ['pdbId']
            }),
            execute: async ({ pdbId }: { pdbId: string }) => {
                return loadPdb(plugin, pdbId);
            }
        }),
    };
    return tools;
}