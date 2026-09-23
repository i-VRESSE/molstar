/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 */

import { DefaultChatModel, isSupportedChatModel, SupportedChatModel } from './model';

export const DefaultChatSettingsKey = 'molstar.chat.preferences.v1';

export interface ChatSettingsStorage {
    getItem(key: string): string | null
    setItem(key: string, value: string): void
    removeItem(key: string): void
}

export interface ChatPreferences {
    version: 1
    modelId: SupportedChatModel
}

export class ChatSettings {
    constructor(
        private readonly storage: ChatSettingsStorage | undefined = browserStorage(),
        private readonly key = DefaultChatSettingsKey,
    ) { }

    load(): ChatPreferences {
        if (!this.storage) return { version: 1, modelId: DefaultChatModel };

        try {
            const raw = this.storage.getItem(this.key);
            if (!raw) return { version: 1, modelId: DefaultChatModel };
            const value = JSON.parse(raw) as Partial<ChatPreferences>;
            if (value.version === 1 && isSupportedChatModel(value.modelId)) {
                return { version: 1, modelId: value.modelId };
            }
        } catch {
            // Preferences are optional; unavailable or malformed storage must not disable chat.
        }
        return { version: 1, modelId: DefaultChatModel };
    }

    saveModel(modelId: SupportedChatModel): void {
        try {
            this.storage?.setItem(this.key, JSON.stringify({ version: 1, modelId } satisfies ChatPreferences));
        } catch {
            // Continue with the in-memory selection when storage is unavailable or full.
        }
    }

    clear(): void {
        try {
            this.storage?.removeItem(this.key);
        } catch {
            // Clearing a preference is best effort.
        }
    }
}

function browserStorage(): ChatSettingsStorage | undefined {
    if (typeof window === 'undefined') return void 0;
    try {
        return window.localStorage;
    } catch {
        return void 0;
    }
}
