/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 */

const { WebWorkerMLCEngineHandler } = require('@browser-ai/web-llm') as {
    WebWorkerMLCEngineHandler: new () => { onmessage(message: MessageEvent): void }
};

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (message: MessageEvent) => handler.onmessage(message);
