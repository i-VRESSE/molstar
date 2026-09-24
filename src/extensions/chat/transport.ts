/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 */

import { ChatRequestOptions, ChatTransport, convertToModelMessages, LanguageModel, stepCountIs, ToolLoopAgent, UIMessage, UIMessageChunk } from 'ai';
import { ChatModelError, shouldDisableThinkingForModel, toChatModelError } from './model';
import { createMolstarTools } from './tools';

export const MaxChatMessages = 24;
export const MaxChatMessageLength = 2000;
export const MaxChatHistoryLength = 16_000;
export const MaxChatOutputTokens = 512;
export const ChatGenerationTimeoutMs = 120_000;

export function buildToolSystemPrompt(): string {
    return [
        'You are the Mol* Viewer assistant. You can use only the registered tools.',
        'Use the version tool to report the current Mol* version and loadPDB to load a four-character or extended PDB ID.',
        'Use at most one state-changing tool per step. Read its result before deciding what to do next.',
        'Never claim an operation succeeded unless its tool result confirms it.',
        'For Viewer actions with no registered tool, explain that the action is unavailable.',
        'Answer concisely.',
    ].join(' ');
}

export function buildToollessSystemPrompt(): string {
    return [
        'You are the text-only conversational preview inside the Mol* molecular Viewer.',
        'You cannot inspect the Viewer, see molecular state, load structures, select atoms, change styles, or perform any other Viewer action.',
        'No molecular tools are available. Never claim that an action in the Viewer succeeded or was performed.',
        'If asked to change the Viewer, explain briefly that this preview is conversational only.',
        'Answer concisely and do not invent observations about the currently loaded structure.',
    ].join(' ');
}

export interface MolstarChatTransportOptions {
    maxMessages?: number
    maxMessageLength?: number
    maxHistoryLength?: number
    maxOutputTokens?: number
    timeoutMs?: number
}

export class MolstarChatTransport implements ChatTransport<UIMessage> {
    private readonly active = new Set<AbortController>();
    private disposed = false;

    constructor(
        private readonly getModel: () => LanguageModel | undefined,
        private readonly options: MolstarChatTransportOptions = {},
        private readonly tools?: ReturnType<typeof createMolstarTools>,
    ) { }

    async sendMessages(options: {
        trigger: 'submit-message' | 'regenerate-message'
        chatId: string
        messageId: string | undefined
        messages: UIMessage[]
        abortSignal: AbortSignal | undefined
    } & ChatRequestOptions): Promise<ReadableStream<UIMessageChunk>> {
        if (this.disposed) throw new ChatModelError('generation-failed', 'The chat session has been disposed.');
        const model = this.getModel();
        if (!model) throw new ChatModelError('initialization-failed', 'Initialize the local model before sending a message.');

        const controller = new AbortController();
        const abort = () => controller.abort();
        options.abortSignal?.addEventListener('abort', abort, { once: true });
        if (options.abortSignal?.aborted) controller.abort();
        this.active.add(controller);

        try {
            const messages = boundMessages(
                options.messages,
                this.options.maxMessages ?? MaxChatMessages,
                this.options.maxMessageLength ?? MaxChatMessageLength,
                this.options.maxHistoryLength ?? MaxChatHistoryLength,
            );
            const prompt = await convertToModelMessages(messages);
            const agent = new ToolLoopAgent({
                model,
                instructions: this.tools ? buildToolSystemPrompt() : buildToollessSystemPrompt(),
                tools: this.tools,
                stopWhen: stepCountIs(8),
                maxOutputTokens: this.options.maxOutputTokens ?? MaxChatOutputTokens,
                maxRetries: 0,
                ...(typeof model !== 'string' && shouldDisableThinkingForModel(model.modelId) ? {
                    providerOptions: { 'web-llm': { extra_body: { enable_thinking: false } } },
                } : {}),
                experimental_telemetry: { isEnabled: false },
            });
            const result = await agent.stream({
                messages: prompt,
                abortSignal: controller.signal,
                timeout: { totalMs: this.options.timeoutMs ?? ChatGenerationTimeoutMs },
            });
            return withCleanup(result.toUIMessageStream({
                onError: error => toChatModelError(error, 'generation-failed').message,
            }), () => {
                options.abortSignal?.removeEventListener('abort', abort);
                this.active.delete(controller);
            });
        } catch (error) {
            options.abortSignal?.removeEventListener('abort', abort);
            this.active.delete(controller);
            throw toChatModelError(error, 'generation-failed');
        }
    }

    async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
        return null;
    }

    abortAll(): void {
        for (const controller of this.active) controller.abort();
        this.active.clear();
    }

    dispose(): void {
        this.disposed = true;
        this.abortAll();
    }
}

export function boundMessages(messages: UIMessage[], maxMessages: number, maxMessageLength: number, maxHistoryLength: number): UIMessage[] {
    const bounded: UIMessage[] = [];
    let remaining = maxHistoryLength;

    for (let i = messages.length - 1; i >= 0 && bounded.length < maxMessages && remaining > 0; i--) {
        const message = messages[i];
        const parts = message.parts.flatMap(part => {
            if (part.type !== 'text' || remaining <= 0) return [];
            const text = part.text.slice(0, Math.min(maxMessageLength, remaining));
            remaining -= text.length;
            return text ? [{ type: 'text' as const, text }] : [];
        });
        if (parts.length) bounded.push({ id: message.id, role: message.role, parts });
    }
    return bounded.reverse();
}

function withCleanup<T>(source: ReadableStream<T>, cleanup: () => void): ReadableStream<T> {
    const reader = source.getReader();
    let cleaned = false;
    const finish = () => {
        if (cleaned) return;
        cleaned = true;
        cleanup();
    };

    return new ReadableStream<T>({
        async pull(target) {
            try {
                const result = await reader.read();
                if (result.done) {
                    finish();
                    target.close();
                } else {
                    target.enqueue(result.value);
                }
            } catch (error) {
                finish();
                target.error(error);
            }
        },
        async cancel(reason) {
            finish();
            await reader.cancel(reason);
        }
    });
}
