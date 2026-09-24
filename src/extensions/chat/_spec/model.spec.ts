/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 */

import { DefaultChatModel, isSupportedChatModel, shouldDisableThinkingForModel, SupportedChatModels, toChatModelError } from '../model';

describe('chat model boundary', () => {
    it('accepts only an allowlisted model ID', () => {
        expect(isSupportedChatModel(DefaultChatModel)).toBe(true);
        expect(isSupportedChatModel('Ministral-3-3B-Instruct-2512-BF16-q4f16_1-MLC')).toBe(true);
        expect(isSupportedChatModel('https://example.org/arbitrary-model')).toBe(false);
        expect(isSupportedChatModel(undefined)).toBe(false);
    });

    it('defaults to thinking except for Qwen3 0.6B', () => {
        expect(shouldDisableThinkingForModel('Qwen3-0.6B-q4f16_1-MLC')).toBe(true);
        expect(shouldDisableThinkingForModel('Ministral-3-3B-Instruct-2512-BF16-q4f16_1-MLC')).toBe(false);
        expect(shouldDisableThinkingForModel('unknown-model')).toBe(false);
    });

    it('uses VRAM-labelled options without separate requirement fields', () => {
        expect(SupportedChatModels.map(model => model.label)).toEqual([
            'Qwen3 0.6B (1403 MB VRAM, recommended)',
            'Ministral 3 3B Instruct (2864 MB VRAM)',
        ]);
        for (const model of SupportedChatModels) {
            expect(model).not.toHaveProperty('downloadSize');
            expect(model).not.toHaveProperty('storageSize');
            expect(model).not.toHaveProperty('memoryRequirement');
        }
    });

    it('maps actionable initialization errors without exposing arbitrary objects', () => {
        expect(toChatModelError(new Error('GPU out of memory')).code).toBe('insufficient-memory');
        expect(toChatModelError(new Error('Network fetch failed')).code).toBe('download-failed');
        expect(toChatModelError(new Error('Worker failed to start')).code).toBe('worker-startup');
        expect(toChatModelError(new DOMException('cancelled', 'AbortError')).code).toBe('cancelled');
    });
});
