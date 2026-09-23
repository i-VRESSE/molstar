/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 */

import { CollapsableControls, CollapsableState } from '../../mol-plugin-ui/base';
import { Button } from '../../mol-plugin-ui/controls/common';

interface ChatControlsState extends CollapsableState {
    draft: string
}

export class ChatControls extends CollapsableControls<{}, ChatControlsState> {
    protected defaultState(): ChatControlsState {
        return {
            header: 'Chat',
            isCollapsed: true,
            draft: ''
        };
    }

    protected renderControls(): JSX.Element {
        return <>
            <div className='msp-help-text' role='log' aria-label='Chat transcript'>
                <div>
                    <strong>Assistant</strong>
                    <br />
                    This is a UI preview. Chat requests and molecular actions are not available yet.
                </div>
            </div>
            <div className='msp-text-area-wrapper'>
                <textarea
                    className='msp-form-control'
                    aria-label='Chat message'
                    placeholder='Ask Mol* to load, select, or style a structure...'
                    value={this.state.draft}
                    onChange={e => this.setState({ draft: e.currentTarget.value })}
                />
            </div>
            <Button disabled title='Sending will be enabled in a later milestone'>Send</Button>
        </>;
    }
}
