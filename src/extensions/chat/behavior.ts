/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 */

import { PluginBehavior } from '../../mol-plugin/behavior/behavior';
import { PluginUIContext } from '../../mol-plugin-ui/context';
import { ChatController, deleteChatController, setChatController } from './controller';
import { ChatControls } from './ui';

const ChatControlsKey = 'molstar-chat';

export const ChatExtension = PluginBehavior.create<{}>({
    name: 'extension-chat',
    category: 'misc',
    display: {
        name: 'Chat'
    },
    ctor: class extends PluginBehavior.Handler<{}> {
        private controller: ChatController | undefined;

        register(): void {
            this.controller = new ChatController({ plugin: this.ctx as PluginUIContext });
            setChatController(this.ctx, this.controller);
            this.ctx.customImportControls.set(ChatControlsKey, ChatControls as any);
        }

        update() {
            return false;
        }

        unregister(): void {
            this.ctx.customImportControls.delete(ChatControlsKey);
            deleteChatController(this.ctx);
            this.controller?.dispose();
            this.controller = void 0;
        }
    },
    params: () => ({})
});
