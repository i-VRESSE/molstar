/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 */

import type { LanguageModel } from 'ai';
import { BehaviorSubject } from 'rxjs';
import { PluginContext } from '../../mol-plugin/context';
import { PluginUIContext } from '../../mol-plugin-ui/context';
import { BrowserChatModelFactory, ChatModelError, ChatModelErrorCode, ChatModelFactory, ChatModelHandle, SupportedChatModel, toChatModelError } from './model';
import { ChatSettings } from './settings';
import { MolstarChatTransport } from './transport';
import { createMolstarTools } from './tools';

export type ChatModelStatus = 'unchecked' | 'idle' | 'initializing' | 'ready' | 'unsupported' | 'error'

export interface ChatControllerState {
    status: ChatModelStatus
    modelId: SupportedChatModel
    progress: number
    error?: { code: ChatModelErrorCode, message: string }
}

export interface ChatControllerOptions {
    plugin?: PluginUIContext
    modelFactory?: ChatModelFactory
    settings?: ChatSettings
}

const Controllers = new WeakMap<PluginContext, ChatController>();

export function setChatController(plugin: PluginContext, controller: ChatController): void {
    Controllers.set(plugin, controller);
}

export function getChatController(plugin: PluginContext): ChatController | undefined {
    return Controllers.get(plugin);
}

export function deleteChatController(plugin: PluginContext): void {
    Controllers.delete(plugin);
}

export class ChatController {
    readonly state: BehaviorSubject<ChatControllerState>;
    readonly transport: MolstarChatTransport;
    readonly hasTools: boolean;

    private readonly modelFactory: ChatModelFactory;
    private readonly settings: ChatSettings;
    private modelHandle: ChatModelHandle | undefined;
    private model: LanguageModel | undefined;
    private setupId = 0;
    private disposed = false;

    constructor(options: ChatControllerOptions = {}) {
        this.modelFactory = options.modelFactory ?? new BrowserChatModelFactory();
        this.settings = options.settings ?? new ChatSettings();
        this.state = new BehaviorSubject<ChatControllerState>({
            status: 'unchecked',
            modelId: this.settings.load().modelId,
            progress: 0,
        });
        this.hasTools = !!options.plugin;
        this.transport = new MolstarChatTransport(() => this.model, {}, options.plugin ? createMolstarTools(options.plugin) : undefined);
    }

    checkCompatibility(): void {
        if (this.disposed || this.state.value.status !== 'unchecked') return;
        if (!this.modelFactory.supportsWebLLM()) {
            this.state.next({
                ...this.state.value,
                status: 'unsupported',
                error: { code: 'unsupported-webgpu', message: 'This browser or device does not expose WebGPU, which local chat requires.' },
            });
            return;
        }
        this.state.next({ ...this.state.value, status: 'idle', error: void 0 });
    }

    selectModel(modelId: SupportedChatModel): void {
        if (this.disposed || modelId === this.state.value.modelId) return;
        this.cancelSetup();
        this.releaseModel();
        this.settings.saveModel(modelId);
        this.state.next({ status: this.modelFactory.supportsWebLLM() ? 'idle' : 'unsupported', modelId, progress: 0 });
    }

    async initialize(): Promise<void> {
        if (this.disposed || this.state.value.status === 'initializing' || this.state.value.status === 'ready') return;
        if (!this.modelFactory.supportsWebLLM()) {
            this.checkCompatibility();
            return;
        }

        const id = ++this.setupId;
        this.releaseModel();
        this.state.next({ ...this.state.value, status: 'initializing', progress: 0, error: void 0 });

        try {
            const handle = this.modelFactory.create(this.state.value.modelId);
            this.modelHandle = handle;
            const availability = await handle.availability();
            if (id !== this.setupId || this.disposed) return;
            if (availability === 'unavailable') {
                throw new ChatModelError('unsupported-webgpu', 'This model cannot run on the current WebGPU device.');
            }
            this.model = await handle.initialize(progress => {
                if (id !== this.setupId || this.disposed) return;
                this.state.next({ ...this.state.value, progress: Math.max(0, Math.min(1, progress)) });
            });
            if (id !== this.setupId || this.disposed) return;
            this.state.next({ ...this.state.value, status: 'ready', progress: 1, error: void 0 });
        } catch (error) {
            if (id !== this.setupId || this.disposed) return;
            this.releaseModel();
            const mapped = toChatModelError(error);
            this.state.next({ ...this.state.value, status: mapped.code === 'cancelled' ? 'idle' : 'error', progress: 0, error: { code: mapped.code, message: mapped.message } });
        }
    }

    cancelSetup(): void {
        if (this.state.value.status !== 'initializing') return;
        ++this.setupId;
        this.releaseModel();
        this.state.next({ ...this.state.value, status: 'idle', progress: 0, error: void 0 });
    }

    clearPreference(): void {
        this.settings.clear();
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        ++this.setupId;
        this.transport.dispose();
        this.releaseModel();
        this.state.complete();
    }

    private releaseModel(): void {
        this.transport.abortAll();
        this.model = void 0;
        this.modelHandle?.dispose();
        this.modelHandle = void 0;
    }
}
