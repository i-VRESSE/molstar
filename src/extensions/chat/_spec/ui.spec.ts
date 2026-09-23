/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 */

import type { LanguageModel } from 'ai';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatController } from '../controller';
import { ChatModelFactory } from '../model';
import { ChatSettings } from '../settings';

jest.mock('../../../mol-plugin-ui/controls/markdown', () => {
    const ReactModule = require('react');
    return { Markdown: ({ children }: { children?: string }) => ReactModule.createElement('div', null, children) };
});

const { ChatPanel } = require('../ui') as typeof import('../ui');

describe('ChatPanel', () => {
    it('renders a ready tool-free chat backed by an injected model', async () => {
        const languageModel = { specificationVersion: 'v3' } as unknown as LanguageModel;
        const factory: ChatModelFactory = {
            supportsWebLLM: () => true,
            create: () => ({
                model: languageModel,
                availability: async () => 'available',
                initialize: async () => languageModel,
                dispose: () => void 0,
            }),
        };
        const controller = new ChatController({ modelFactory: factory, settings: new ChatSettings(undefined) });
        controller.checkCompatibility();
        await controller.initialize();

        const html = renderToStaticMarkup(React.createElement(ChatPanel, { controller }));

        expect(html).toContain('● Ready');
        expect(html).toContain('Ministral 3 3B Instruct (2864 MB VRAM)');
        expect(html).not.toContain('Model requirements');
        expect(html).toContain('text-only conversational preview');
        expect(html).toContain('conversations are not saved');
        expect(html).toContain('Viewer access is disabled in this milestone.');
        controller.dispose();
    });
});
