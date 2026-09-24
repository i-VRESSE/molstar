/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 */

import type { PluginUIContext } from '../../../mol-plugin-ui/context';

jest.mock('../../plugin/loaders', () => ({ loadPdb: jest.fn() }));
const { loadPdb } = require('../../plugin/loaders') as typeof import('../../plugin/loaders');
const { createMolstarTools } = require('../tools') as typeof import('../tools');

describe('createMolstarTools', () => {
    beforeEach(() => jest.clearAllMocks());

    it('passes the supplied Viewer context to the existing PDB loader', async () => {
        const plugin = {} as PluginUIContext;
        const execute = createMolstarTools(plugin).loadPDB.execute as (input: { pdbId: string }) => Promise<unknown>;
        const result = await execute({ pdbId: '1tqn' });

        expect(loadPdb).toHaveBeenCalledWith(plugin, '1TQN');
        expect(result).toEqual({ status: 'succeeded', pdbId: '1TQN' });
    });

    it('accepts an extended PDB ID', async () => {
        const plugin = {} as PluginUIContext;
        const execute = createMolstarTools(plugin).loadPDB.execute as (input: { pdbId: string }) => Promise<unknown>;
        const result = await execute({ pdbId: 'pdb_00009b8v' });

        expect(loadPdb).toHaveBeenCalledWith(plugin, 'PDB_00009B8V');
        expect(result).toEqual({ status: 'succeeded', pdbId: 'PDB_00009B8V' });
    });

    it('rejects an invalid PDB ID before calling the loader', async () => {
        const plugin = {} as PluginUIContext;
        const execute = createMolstarTools(plugin).loadPDB.execute as (input: { pdbId: string }) => Promise<unknown>;

        await expect(execute({ pdbId: 'not-an-id' })).rejects.toThrow('Invalid PDB ID.');
        await expect(execute({ pdbId: 'pdb_00000b8v' })).rejects.toThrow('Invalid PDB ID.');
        expect(loadPdb).not.toHaveBeenCalled();
    });
});
