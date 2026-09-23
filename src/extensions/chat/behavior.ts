/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 */

import { PluginBehavior } from '../../mol-plugin/behavior/behavior';
import { ChatControls } from './ui';

const ChatControlsKey = 'molstar-chat';

export const ChatExtension = PluginBehavior.create<{}>({
    name: 'extension-chat',
    category: 'misc',
    display: {
        name: 'Chat'
    },
    ctor: class extends PluginBehavior.Handler<{}> {
        register(): void {
            this.ctx.customImportControls.set(ChatControlsKey, ChatControls as any);
        }

        update() {
            return false;
        }

        unregister(): void {
            this.ctx.customImportControls.delete(ChatControlsKey);
        }
    },
    params: () => ({})
});
