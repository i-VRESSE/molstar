/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 */

import { LanguageModel, simulateReadableStream, UIMessage } from 'ai';
import { boundMessages, buildToollessSystemPrompt, MolstarChatTransport } from '../transport';

const EmptyUsage = {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
};

async function readStream<T>(stream: ReadableStream<T>): Promise<T[]> {
    const values: T[] = [];
    const reader = stream.getReader();
    while (true) {
        const result = await reader.read();
        if (result.done) return values;
        values.push(result.value);
    }
}

describe('MolstarChatTransport', () => {
    it('streams a tool-free response from an injected mock model', async () => {
        const doStreamCalls: Parameters<LanguageModel['doStream']>[0][] = [];
        const model: LanguageModel = {
            specificationVersion: 'v4',
            provider: 'mock-provider',
            modelId: 'mock-model',
            supportedUrls: {},
            doGenerate: async () => { throw new Error('Not used by this test.'); },
            doStream: async options => {
                doStreamCalls.push(options);
                return {
                stream: simulateReadableStream({ chunks: [
                    { type: 'stream-start', warnings: [] },
                    { type: 'text-start', id: 'text-1' },
                    { type: 'text-delta', id: 'text-1', delta: 'Hello locally.' },
                    { type: 'text-end', id: 'text-1' },
                    { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: EmptyUsage },
                ] }),
                };
            },
        };
        const transport = new MolstarChatTransport(() => model);
        const messages: UIMessage[] = [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Hello' }] }];

        const stream = await transport.sendMessages({
            trigger: 'submit-message',
            chatId: 'chat-1',
            messageId: 'user-1',
            messages,
            abortSignal: void 0,
        });
        const chunks = await readStream(stream);

        expect(chunks.some(chunk => chunk.type === 'text-delta' && chunk.delta === 'Hello locally.')).toBe(true);
        expect(doStreamCalls).toHaveLength(1);
        expect(doStreamCalls[0].prompt[0]).toMatchObject({ role: 'system', content: buildToollessSystemPrompt() });
        expect(doStreamCalls[0].tools).toBeUndefined();
    });

    it('rejects submission before model initialization', async () => {
        const transport = new MolstarChatTransport(() => void 0);
        await expect(transport.sendMessages({
            trigger: 'submit-message',
            chatId: 'chat-1',
            messageId: 'user-1',
            messages: [],
            abortSignal: void 0,
        })).rejects.toMatchObject({ code: 'initialization-failed' });
    });

    it('bounds history to text-only messages and configured character limits', () => {
        const messages: UIMessage[] = [
            { id: 'old', role: 'user', parts: [{ type: 'text', text: 'discard me' }] },
            { id: 'new', role: 'assistant', parts: [{ type: 'text', text: '123456' }] },
        ];

        expect(boundMessages(messages, 1, 4, 10)).toEqual([
            { id: 'new', role: 'assistant', parts: [{ type: 'text', text: '1234' }] },
        ]);
    });
});
