/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 */

import type { LanguageModel } from 'ai';
import { ChatController } from '../controller';
import { ChatModelFactory, ChatModelHandle, DefaultChatModel } from '../model';
import { ChatSettings } from '../settings';

function createFactory(supported = true) {
    const languageModel = { specificationVersion: 'v3' } as unknown as LanguageModel;
    const handle: ChatModelHandle = {
        model: languageModel,
        availability: jest.fn(async () => 'downloadable'),
        initialize: jest.fn(async progress => {
            progress(0.5);
            progress(1);
            return languageModel;
        }),
        dispose: jest.fn(),
    };
    const factory: ChatModelFactory = {
        supportsWebLLM: jest.fn(() => supported),
        create: jest.fn(() => handle),
    };
    return { factory, handle };
}

describe('ChatController', () => {
    it('checks compatibility without constructing or downloading a model', () => {
        const { factory } = createFactory();
        const controller = new ChatController({ modelFactory: factory, settings: new ChatSettings(undefined) });

        controller.checkCompatibility();

        expect(controller.state.value.status).toBe('idle');
        expect(factory.create).not.toHaveBeenCalled();
        controller.dispose();
    });

    it('initializes only after an explicit call and reports progress', async () => {
        const { factory, handle } = createFactory();
        const controller = new ChatController({ modelFactory: factory, settings: new ChatSettings(undefined) });
        controller.checkCompatibility();

        await controller.initialize();

        expect(factory.create).toHaveBeenCalledWith(DefaultChatModel);
        expect(handle.initialize).toHaveBeenCalledTimes(1);
        expect(controller.state.value).toMatchObject({ status: 'ready', progress: 1 });
        controller.dispose();
        expect(handle.dispose).toHaveBeenCalledTimes(1);
    });

    it('reports unsupported WebGPU without constructing a model', async () => {
        const { factory } = createFactory(false);
        const controller = new ChatController({ modelFactory: factory, settings: new ChatSettings(undefined) });

        controller.checkCompatibility();
        await controller.initialize();

        expect(controller.state.value.status).toBe('unsupported');
        expect(controller.state.value.error?.code).toBe('unsupported-webgpu');
        expect(factory.create).not.toHaveBeenCalled();
        controller.dispose();
    });
});
