/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 */

import { DefaultChatModel } from '../model';
import { ChatSettings, ChatSettingsStorage } from '../settings';

class MemoryStorage implements ChatSettingsStorage {
    readonly values = new Map<string, string>();
    getItem(key: string) { return this.values.get(key) ?? null; }
    setItem(key: string, value: string) { this.values.set(key, value); }
    removeItem(key: string) { this.values.delete(key); }
}

describe('ChatSettings', () => {
    it('persists only a versioned allowlisted model preference', () => {
        const storage = new MemoryStorage();
        const settings = new ChatSettings(storage, 'test-chat');

        settings.saveModel(DefaultChatModel);

        expect(JSON.parse(storage.getItem('test-chat')!)).toEqual({ version: 1, modelId: DefaultChatModel });
        expect(settings.load()).toEqual({ version: 1, modelId: DefaultChatModel });
    });

    it('ignores malformed and unknown preferences', () => {
        const storage = new MemoryStorage();
        storage.setItem('test-chat', JSON.stringify({ version: 1, modelId: 'arbitrary-model', conversation: ['private'] }));

        expect(new ChatSettings(storage, 'test-chat').load()).toEqual({ version: 1, modelId: DefaultChatModel });

        storage.setItem('test-chat', 'not-json');
        expect(new ChatSettings(storage, 'test-chat').load()).toEqual({ version: 1, modelId: DefaultChatModel });
    });

    it('continues when storage is unavailable', () => {
        const storage: ChatSettingsStorage = {
            getItem: () => { throw new Error('blocked'); },
            setItem: () => { throw new Error('quota'); },
            removeItem: () => { throw new Error('blocked'); },
        };
        const settings = new ChatSettings(storage, 'test-chat');

        expect(settings.load().modelId).toBe(DefaultChatModel);
        expect(() => settings.saveModel(DefaultChatModel)).not.toThrow();
        expect(() => settings.clear()).not.toThrow();
    });
});
