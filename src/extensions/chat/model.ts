/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 */

import type { LanguageModel } from 'ai';
import { ObjectKeys } from '../../mol-util/type-helpers';

// Keep WebLLM behind a local runtime boundary so its WebGPU declarations do not
// add another set of browser globals to Mol*'s TypeScript compilation.
type BrowserAIModule = {
    doesBrowserSupportWebLLM(): boolean
    webLLM(modelId: string, settings: { worker: Worker, appConfig: WebLLMAppConfig }): WebLLMModel
}
type WebLLMAppConfig = {
    model_list: ReadonlyArray<{ model_id: string, vram_required_MB?: number }>
}
type WebLLMConfigModule = {
    prebuiltAppConfig: WebLLMAppConfig
}


type WebLLMModel = LanguageModel & {
    availability(): Promise<ChatModelAvailability>
    createSessionWithProgress(onProgress: (progress: number) => void): Promise<WebLLMModel>
}

// See https://github.com/mlc-ai/web-llm/blob/main/src/config.ts#L358 for prebuilt model configuration details.
const SupportedChatModelInfo = {
    'Qwen3-0.6B-q4f16_1-MLC': { name: 'Qwen3 0.6B', fallbackVramRequiredMB: 1403.34, no_thinking: true },
    'Ministral-3-3B-Instruct-2512-BF16-q4f16_1-MLC': { name: 'Ministral 3 3B Instruct', fallbackVramRequiredMB: 2863.69 },
} as const;
export type SupportedChatModel = keyof typeof SupportedChatModelInfo

export const SupportedChatModels = ObjectKeys(SupportedChatModelInfo).map((id, index) => {
    const record = prebuiltModelRecord(id);
    const info = SupportedChatModelInfo[id];
    const vramRequiredMB = record?.vram_required_MB ?? info.fallbackVramRequiredMB;
    return {
        id,
        label: `${info.name} (${Math.round(vramRequiredMB)} MB VRAM${index === 0 ? ', recommended' : ''})`,
    };
});

export const DefaultChatModel: SupportedChatModel = SupportedChatModels[0].id;

export function isSupportedChatModel(value: unknown): value is SupportedChatModel {
    return typeof value === 'string' && SupportedChatModels.some(model => model.id === value);
}

export function shouldDisableThinkingForModel(modelId: string): boolean {
    if (!isSupportedChatModel(modelId)) return false;
    const info = SupportedChatModelInfo[modelId];
    return 'no_thinking' in info ? info.no_thinking : false;
}

export type ChatModelAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available'

export interface ChatModelHandle {
    readonly model: LanguageModel
    availability(): Promise<ChatModelAvailability>
    initialize(onProgress: (progress: number) => void): Promise<LanguageModel>
    dispose(): void
}

export interface ChatModelFactory {
    supportsWebLLM(): boolean
    create(modelId: SupportedChatModel): ChatModelHandle
}

export interface BrowserChatModelFactoryOptions {
    createWorker?: () => Worker
}

export class BrowserChatModelFactory implements ChatModelFactory {
    constructor(private readonly options: BrowserChatModelFactoryOptions = {}) { }

    supportsWebLLM(): boolean {
        return browserAI().doesBrowserSupportWebLLM();
    }

    create(modelId: SupportedChatModel): ChatModelHandle {
        const worker = (this.options.createWorker ?? createChatWorker)();
        const appConfig = webLLMConfig().prebuiltAppConfig;
        if (!appConfig.model_list.some(model => model.model_id === modelId)) {
            worker.terminate();
            throw new ChatModelError('initialization-failed', `The supported model '${modelId}' is missing from the WebLLM app configuration.`);
        }
        const model = browserAI().webLLM(modelId, { worker, appConfig });
        return new BrowserChatModelHandle(model, worker);
    }
}

function browserAI(): BrowserAIModule {
    return require('@browser-ai/web-llm') as BrowserAIModule;
}
function webLLMConfig(): WebLLMConfigModule {
    return require('@mlc-ai/web-llm') as WebLLMConfigModule;
}
function prebuiltModelRecord(modelId: SupportedChatModel) {
    try {
        return webLLMConfig().prebuiltAppConfig.model_list.find(model => model.model_id === modelId);
    } catch {
        return void 0;
    }
}

class BrowserChatModelHandle implements ChatModelHandle {
    constructor(readonly model: WebLLMModel, private readonly worker: Worker) { }

    availability(): Promise<ChatModelAvailability> {
        return this.model.availability();
    }

    async initialize(onProgress: (progress: number) => void): Promise<LanguageModel> {
        return this.model.createSessionWithProgress(onProgress);
    }

    dispose(): void {
        this.worker.terminate();
    }
}

function createChatWorker(): Worker {
    if (typeof Worker === 'undefined' || typeof document === 'undefined') {
        throw new ChatModelError('worker-startup', 'Web Workers are not available in this environment.');
    }
    // The Viewer build emits this explicit module-worker entry next to molstar.js.
    return new Worker(new URL('./molstar-chat-worker.js', document.baseURI), { type: 'module' });
}

export type ChatModelErrorCode =
    | 'unsupported-webgpu'
    | 'insufficient-memory'
    | 'download-failed'
    | 'storage-quota'
    | 'worker-startup'
    | 'initialization-failed'
    | 'generation-failed'
    | 'cancelled'

export class ChatModelError extends Error {
    constructor(readonly code: ChatModelErrorCode, message: string, readonly cause?: unknown) {
        super(message);
        this.name = 'ChatModelError';
    }
}

export function toChatModelError(error: unknown, fallback: ChatModelErrorCode = 'initialization-failed'): ChatModelError {
    if (error instanceof ChatModelError) return error;
    if (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError') {
        return new ChatModelError('cancelled', 'The local model operation was cancelled.', error);
    }
    if (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'QuotaExceededError') {
        return new ChatModelError('storage-quota', 'Browser storage is full. Free storage for this site and try again.', error);
    }

    const detail = error instanceof Error ? error.message : String(error);
    const normalized = detail.toLowerCase();
    if (normalized.includes('out of memory') || normalized.includes('memory allocation') || normalized.includes('vram')) {
        return new ChatModelError('insufficient-memory', 'The GPU does not have enough available memory for this model.', error);
    }
    if (normalized.includes('worker') || normalized.includes('failed to fetch dynamically imported module')) {
        return new ChatModelError('worker-startup', 'The local-model worker could not start. Check the deployment path and worker CSP.', error);
    }
    if (normalized.includes('fetch') || normalized.includes('cors') || normalized.includes('network')) {
        return new ChatModelError('download-failed', 'The model download failed. Check the connection, CORS policy, and available storage.', error);
    }
    return new ChatModelError(fallback, detail || 'The local model could not be initialized.', error);
}
