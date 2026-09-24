/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 */

import { useChat } from '@ai-sdk/react';
import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { CollapsableControls, CollapsableState } from '../../mol-plugin-ui/base';
import { Button } from '../../mol-plugin-ui/controls/common';
import { Markdown } from '../../mol-plugin-ui/controls/markdown';
import { ChatController, ChatControllerState, getChatController } from './controller';
import { isSupportedChatModel, SupportedChatModels } from './model';
import { MaxChatMessageLength } from './transport';

export class ChatControls extends CollapsableControls<{}, CollapsableState> {
    protected defaultState(): CollapsableState {
        return {
            header: 'Chat',
            isCollapsed: true,
        };
    }

    protected renderControls(): JSX.Element {
        const controller = getChatController(this.plugin);
        if (!controller) {
            return <div className='msp-help-text'><div>Chat is not available.</div></div>;
        }
        return <ChatPanel controller={controller} />;
    }
}

export function ChatPanel({ controller }: { controller: ChatController }) {
    const [modelState, setModelState] = useState<ChatControllerState>(controller.state.value);
    const [draft, setDraft] = useState('');
    const transcript = useRef<HTMLDivElement>(null);
    const {
        messages,
        sendMessage,
        stop,
        status,
        error,
        setMessages,
        clearError,
    } = useChat({ transport: controller.transport });

    useEffect(() => {
        controller.checkCompatibility();
        const subscription = controller.state.subscribe(setModelState);
        return () => {
            subscription.unsubscribe();
            stop();
        };
    }, [controller, stop]);

    useEffect(() => {
        const element = transcript.current;
        if (element) element.scrollTop = element.scrollHeight;
    }, [messages]);

    const requestActive = status === 'submitted' || status === 'streaming';
    const canSubmit = modelState.status === 'ready' && !requestActive && draft.trim().length > 0;

    const submit = () => {
        const text = draft.trim();
        if (!text || !canSubmit) return;
        setDraft('');
        clearError();
        void sendMessage({ text });
    };

    const clearConversation = () => {
        if (requestActive) stop();
        clearError();
        setMessages([]);
    };

    return <div className='msp-chat'>
        <div className='msp-chat-model'>
            <ModelSelector controller={controller} state={modelState} disabled={requestActive} />
            <ModelSetup controller={controller} state={modelState} />
        </div>

        {modelState.status === 'ready' && <>
            <div className='msp-chat-transcript' ref={transcript} role='log' aria-label='Chat transcript' aria-live='polite'>
                {messages.length === 0 && <div className='msp-chat-message'>
                    <strong className='msp-chat-message-role'>Assistant</strong>
                    {controller.hasTools ? 'Ask for the Mol* version or load a PDB ID.' : 'This is a text-only conversational preview. It cannot inspect or change the Viewer.'}
                </div>}
                {messages.map(message => <div className={`msp-chat-message msp-chat-message-${message.role}`} key={message.id}>
                    <strong className='msp-chat-message-role'>{message.role === 'user' ? 'You' : 'Assistant'}</strong>
                    {message.parts.map((part, index) => part.type === 'text'
                        ? message.role === 'assistant'
                            ? <Markdown key={index}>{part.text}</Markdown>
                            : <React.Fragment key={index}>{part.text}</React.Fragment>
                        : part.type.startsWith('tool-')
                            ? <ToolStatus key={index} part={part} />
                            : null)}
                </div>)}
                {requestActive && <div className='msp-chat-message msp-chat-thinking' role='status'>
                    <span>Assistant is responding</span><span aria-hidden='true'>…</span>
                </div>}
            </div>

            {error && <div className='msp-chat-status' role='alert'>
                Generation failed: {error.message || 'The local model did not complete the response.'}
            </div>}

            <div className='msp-text-area-wrapper'>
                <textarea
                    className='msp-form-control'
                    aria-label='Chat message'
                    placeholder={controller.hasTools ? 'Ask for a PDB ID or the Mol* version…' : 'Ask a conversational question…'}
                    maxLength={MaxChatMessageLength}
                    value={draft}
                    disabled={requestActive}
                    onChange={event => setDraft(event.currentTarget.value)}
                    onKeyDown={event => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                            event.preventDefault();
                            submit();
                        }
                    }}
                />
            </div>
            <div className='msp-chat-actions'>
                <Button commit disabled={!canSubmit} onClick={submit}>Send</Button>
                <Button disabled={!requestActive} onClick={() => stop()}>Cancel</Button>
                <Button disabled={messages.length === 0 && !error} onClick={clearConversation}>Clear</Button>
            </div>
        </>}

        <div className='msp-chat-notice msp-help-text'>
            <div>Local inference. Setup downloads model assets; conversations are not saved. {controller.hasTools ? 'Available Viewer actions: version and PDB loading.' : 'Viewer access is disabled in this milestone.'}</div>
        </div>
    </div>;
}

function ToolStatus({ part }: { part: { type: string } }) {
    const tool = part as { type: string, state?: string, output?: unknown, errorText?: string };
    const name = tool.type.slice(5);
    const output = tool.output as { status?: string, pdbId?: string } | string | undefined;
    const summary = tool.state === 'output-error'
        ? `${name} failed: ${tool.errorText ?? 'Unknown error'}`
        : tool.state === 'output-available'
            ? name === 'version' && typeof output === 'string'
                ? `Mol* version: ${output}`
                : name === 'loadPDB' && typeof output === 'object' && output?.status === 'succeeded'
                    ? `Loaded PDB ${output.pdbId}.`
                    : `${name} completed.`
            : `${name} is running…`;
    return <div className='msp-chat-status' role='status'>{summary}</div>;
}

function ModelSelector({ controller, state, disabled }: { controller: ChatController, state: ChatControllerState, disabled: boolean }) {
    return <>
        <label htmlFor='msp-chat-model-select'><strong>Local model</strong></label>
        <select id='msp-chat-model-select' className='msp-form-control' value={state.modelId}
            disabled={state.status === 'initializing' || disabled}
            onChange={event => {
                const modelId = event.currentTarget.value;
                if (isSupportedChatModel(modelId)) controller.selectModel(modelId);
            }}
        >
            {SupportedChatModels.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
        </select>
    </>;
}

function ModelSetup({ controller, state }: { controller: ChatController, state: ChatControllerState }) {
    if (state.status === 'unchecked') {
        return <div className='msp-chat-status' aria-live='polite'>Checking WebGPU support…</div>;
    }
    if (state.status === 'unsupported') {
        return <div className='msp-chat-status' role='alert'>
            WebGPU is unavailable. Use a current WebGPU-enabled browser and compatible GPU to run local chat.
        </div>;
    }
    if (state.status === 'ready') {
        return <div className='msp-chat-ready' role='status' title='The local model is initialized'>● Ready</div>;
    }

    return <>
        {(state.status === 'initializing' || state.error) && <div className='msp-chat-status' aria-live='polite'>
            {state.status === 'initializing' && <>
                <progress className='msp-chat-progress' max={1} value={state.progress} aria-label='Model initialization progress' />
                <div>{Math.round(state.progress * 100)}% — downloading or initializing locally</div>
            </>}
            {state.error && <div role='alert'>{state.error.message}</div>}
        </div>}
        <div className='msp-chat-actions'>
            <Button
                commit
                disabled={state.status === 'initializing'}
                onClick={() => void controller.initialize()}
            >Download / Initialize</Button>
            {state.status === 'initializing'
                ? <Button onClick={() => controller.cancelSetup()}>Cancel</Button>
                : <Button onClick={() => controller.clearPreference()}>Clear Preference</Button>}
        </div>
    </>;
}
