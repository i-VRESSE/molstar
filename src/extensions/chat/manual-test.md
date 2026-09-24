# Toolless local chat manual check

Run `npm run dev:viewer`, open the Viewer in a WebGPU-capable browser, and use the Home panel's **Chat** control.

1. Expand Chat and verify that no model download starts.
2. Select the allowlisted model and click **Download / Initialize**. Confirm that progress is visible and the model reaches **ready**.
3. Send “What can you do in this preview?” and verify that the response streams into the transcript.
4. Ask it to load PDB 1TQN. Verify that it says it cannot inspect or modify the Viewer and that Mol* state does not change.
5. Start a longer response, click **Cancel**, and verify that streaming stops while the partial response remains visible.
6. Click **Clear** and verify that only the conversation is removed.
7. Reload, click **Download / Initialize** again, and verify in browser developer tools that cached model assets are reused.
8. Disable WebGPU (or repeat in an unsupported browser) and verify that the compatibility message appears before initialization is offered.

Prompts and responses must not appear in `localStorage`; only the versioned allowlisted model preference may be present.
