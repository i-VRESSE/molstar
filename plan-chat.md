# Mol* Chat Assistant Plan

## Goal

Add an optional chat panel to the Mol* Viewer where a user can ask for operations such as:

- "Load PDB 1TQN."
- "Select chain A, residues 25 through 40, and focus on it."
- "Show the protein as cartoon and the ligand as ball-and-stick."
- "Color the structure by chain."
- "Use the illustrative style."

The language model should interpret a request, but it must not directly manipulate the plugin, emit executable JavaScript, or provide arbitrary MolScript to evaluate. It may call only a small, versioned set of Vercel AI SDK tools. Each tool validates its input and executes one bounded operation through Mol*'s existing public/high-level APIs.

## Scope And Assumptions

The first version is a reusable Viewer extension under `src/extensions/chat`. Its browser-side tool protocol, tool registry, controller, plugin behavior, and collapsible React UI are registered in the existing Viewer through `src/apps/viewer/extensions.ts`; no separate application or chat backend is needed. The chat uses the Vercel AI SDK and appears in the left-side Home panel alongside controls such as Download Tunnels and Zenodo Import. It is not a general scientific question-answering system and does not initially inspect external literature.

In scope for the first version:

- Load an allowlisted PDB, AlphaFold DB, or ModelArchive entry, or a supported structure URL.
- Select, add, remove, or intersect common molecular targets.
- Focus or highlight a target.
- Clear selection/highlights and reset the camera.
- Apply a curated representation preset.
- Apply a curated color theme or default/illustrative appearance.
- Report exactly which tool calls succeeded or failed.
- Run a curated small instruction model locally through `@browser-ai/web-llm`, with no API endpoint or token required.
- Check WebGPU support before offering model setup, require an explicit model download, show progress, and reuse the browser's cached model assets.
- Persist only lightweight local preferences such as the selected supported model ID; do not place model weights or conversation content in Mol* snapshots.

Deferred until the tool boundary is stable:

- Measurements, superposition, density maps, animations, and structure editing.
- Arbitrary MolScript supplied by a model.
- Voice input, image input, and retrieval-augmented scientific answers.
- Open-ended autonomous loops. V1 permits only a bounded tool loop needed to complete the current user request and summarize its actual results.
- OpenAI-compatible hosted or local endpoints as an alternative provider for devices that cannot run WebLLM.

## Repository Findings

### UI And Extension Points

- `src/mol-plugin-ui/left-panel.tsx` renders the Home tab. It places `StateObjectActions` first, followed by `CustomImportControls` and remote snapshots.
- Download Tunnels appears in that panel because `SbNcbrTunnels` registers the `DownloadTunnels` state action. Chat is persistent UI rather than a one-shot state action, so it should use the adjacent `CustomImportControls` extension point instead of registering a fake action.
- `CustomImportControls` renders components from `plugin.customImportControls`; `src/extensions/zenodo/index.ts` is the direct registration/unregistration pattern to follow.
- `src/mol-plugin/context.ts` owns `customImportControls`, `customState`, logging, tasks, state transactions, and plugin lifecycle.
- Existing extensions register and unregister UI in behavior lifecycle methods. `src/extensions/assembly-symmetry/behavior.ts`, `src/extensions/geo-export/index.ts`, and `src/extensions/mp4-export/index.ts` are the patterns to follow.
- `src/apps/viewer/extensions.ts` is the existing registry for optional Viewer behaviors. Adding `ChatExtension` there gives the chat feature the same configuration path as other Viewer extensions and avoids a second application bootstrap.
- `DefaultViewerOptions.extensions` is derived from `ObjectKeys(ExtensionMap)`, so a `'chat'` map entry is enabled by default in the Viewer and can be omitted through `extensions` or disabled through `disabledExtensions: ['chat']` by embedders.
- `PluginUIComponent` and `PurePluginUIComponent` in `src/mol-plugin-ui/base.tsx` expose the `PluginUIContext` and automatically dispose registered RxJS subscriptions.
- Existing `Button`, `IconButton`, text controls, collapsible sections, task overlays, toasts, and Markdown rendering should be reused. `src/mol-plugin-ui/controls/markdown.tsx` already sanitizes model text with `skipHtml` and supports GFM.

The least invasive first implementation is a `PluginBehavior` exported as `ChatExtension` from `src/extensions/chat`. It registers a `CollapsableControls` React component with `customImportControls`, and `src/apps/viewer/extensions.ts` exposes it as `'chat': PluginSpec.Behavior(ChatExtension)`. This puts chat in the left-side Home panel without adding a new tab, changing `PluginUISpec`, or creating a separate app.

### Loading Structures

- `loadPdb(plugin, id, options)` in `src/extensions/plugin/loaders.ts` is the preferred high-level entry point. It respects `PluginConfig.Download.DefaultPdbProvider` and delegates to the existing `DownloadStructure` action.
- `loadStructureFromUrl(plugin, url, format, isBinary, options)` in the same file handles an explicit URL and supported trajectory format.
- `DownloadStructure` in `src/mol-plugin-state/actions/structure.ts` performs download, parsing, hierarchy creation, and representation preset application within the normal state/task machinery.
- The loader currently appends structures. A destructive "replace current structure" operation should be a separate explicit tool requiring confirmation rather than an implicit property of load.

### Selections And Camera Interaction

- `applyStructureInteractivity` in `src/extensions/plugin/interactivity.ts` already supports `select`, `highlight`, and `focus` over all applicable structures, with optional structure filtering.
- `StructureElement.Schema` in `src/mol-model/structure/structure/element/schema.ts` is a suitable safe wire-level selection vocabulary. It supports chain IDs, residue IDs/ranges, residue names, atom names, element symbols, entity IDs, insertion codes, and model instance/operator identifiers.
- `StructureSelectionQueries` in `src/mol-plugin-state/helpers/structure-selection-query.ts` provides curated semantic selections including polymer, protein, nucleic acid, ligand, water, ion, lipid, helix, beta strand, backbone, sidechain, and surroundings.
- `StructureSelectionManager` in `src/mol-plugin-state/manager/structure/selection.ts` provides `fromLoci`, `fromCompiledQuery`, `fromSelectionQuery`, modifiers, selection statistics, and snapshots.
- `compileIdListSelection` in `src/mol-script/util/id-list.ts` can support familiar author/label residue-list syntax if that syntax is exposed directly in a later tool version.
- Selection changes are managed separately from the data-state undo stack. Tool results and assistant text must not claim that data-state Undo will reverse a selection unless selection snapshot/restore is implemented for that tool.

Use schema-based selection for explicit chain/residue/atom requests and the built-in query registry for named concepts. Do not accept serialized MolScript expressions from the model in v1.

### Representations And Styles

- `StructureComponentManager.applyPreset` in `src/mol-plugin-state/manager/structure/component.ts` applies a preset to the current structure hierarchy and wraps it in an undoable transaction.
- `PresetStructureRepresentations` in `src/mol-plugin-state/builder/structure/representation-preset.ts` includes automatic, polymer-and-ligand, polymer-cartoon, atomic-detail, illustrative, molecular-surface, and other presets.
- `StructureComponentManager.addRepresentation`, `updateRepresentations`, `updateRepresentationsTheme`, and `applyTheme` cover lower-level representation and theme changes.
- `src/mol-plugin-ui/structure/quick-styles.tsx` is the canonical implementation for the current Default, Cartoon, Spacefill, Surface, and Illustrative buttons. Extract or mirror its non-UI operations instead of simulating button clicks.
- Registered representation and color-theme names are available from plugin registries. Initial chat tools should still use allowlists so the model-facing schemas remain stable across Mol* versions.
- State-changing representation operations already use `canUndo` labels such as `Preset`, `Update Representation`, and `Update Theme`. Each mutating tool should use the existing transaction behavior and a clear `Chat: ...` undo label where practical.

## Recommended Architecture

```text
ChatControls (React)
    |
    v
useChat (@ai-sdk/react: messages, tool parts, cancellation, request status)
    |
    v
MolstarChatTransport
    v
AI SDK Core ToolLoopAgent (agent.stream; bounded multi-step tool loop)
    |
    +--> @browser-ai/web-llm --> Web Worker/WebGPU
    |
    +--> createMolstarTools(plugin, policy, mutationGate)
             |
             +--> state_tree                         (read-only)
             +--> download_structure                (mutation)
             +--> download_structure_from_url       (mutation)
             +--> select_structure / clear_*        (mutation)
             +--> apply_* / reset_camera / undo     (mutation)
                         |
                         v
                 Mol* public/high-level APIs
    |
    v
AI SDK tool-result parts --> model's final summary --> transcript
```

There is no model-produced command envelope and no `ChatCommandExecutor`. The AI SDK tool registry is the capability boundary: a model can invoke only registered tools, each tool performs exactly one operation, and the tool's `execute` function is the only path from model output to Mol* state.

Responsibilities remain separated:

- The model UI owns capability detection, supported-model selection, explicit download consent, progress, readiness, and lightweight preference persistence.
- `MolstarChatTransport` converts bounded UI message history to model messages and runs a local `ToolLoopAgent` with system instructions, registered tools, an abort signal, a timeout, and a hard step limit.
- `createMolstarTools` defines the V1 tool names, descriptions, input schemas, and `execute` functions. Tool schemas are the wire protocol and are shared with UI-message validation and tests.
- Each `execute` function normalizes its already schema-validated input, applies semantic and deployment-policy checks, calls a public/high-level Mol* API, and returns a bounded structured result based on observed state.
- A small mutation gate prevents overlapping chat submissions and serializes mutating tool calls. Read-only tools use the same gate as a barrier when they must observe all preceding mutations.
- `@ai-sdk/react` owns chat messages, tool-call/tool-result parts, submission, approval responses, cancellation, retries, and request status. The UI does not infer success from assistant prose.

Use the Vercel AI SDK with `@browser-ai/web-llm` as the primary language-model provider, `@ai-sdk/react` for chat state, and the core `ai` package for `ToolLoopAgent`, `tool`, `jsonSchema`, model/UI message conversion, loop control, and transport primitives. The implemented compatible releases are pinned exactly to `ai@7.0.112`, `@ai-sdk/react@4.0.115`, and `@browser-ai/web-llm@3.0.3`; React 18 remains supported. The selected WebLLM model must be tested for tool calling, not merely text or JSON generation.

The transport should use a bounded AI SDK tool loop rather than a custom loop. In the pinned SDK version, configure the equivalent of:

```ts
const tools = createMolstarTools({ plugin, policy, mutationGate })

const agent = new ToolLoopAgent({
    model,
    instructions: buildSystemPrompt(),
    tools,
    toolChoice: 'auto',
    stopWhen: stepCountIs(MAX_TOOL_STEPS),
})

const result = await agent.stream({
    messages: await convertToModelMessages(messages),
    abortSignal,
})
```

`MAX_TOOL_STEPS` should be small (for example, 8). The system instructions tell the model to inspect state with `state_tree` when a request depends on current Viewer state, call at most one mutating tool per step, use the returned result before choosing the next action, and finish with a concise summary. The runtime still enforces serialization and limits because prompting is not a safety boundary.

### In-Browser Model Configuration

Implement the model factory in `src/extensions/chat/model.ts` with `webLLM` from `@browser-ai/web-llm`. Keep a narrow boundary around the AI SDK language model:

```ts
interface ChatModelFactory {
    supportsWebLLM(): boolean
    create(modelId: SupportedChatModel): ChatModelHandle
}
```

The implemented allowlist contains `Qwen3-0.6B-q4f16_1-MLC` and `Ministral-3-3B-Instruct-2512-BF16-q4f16_1-MLC`. Validate both against WebLLM's `prebuiltAppConfig`, use that configuration when constructing the provider, and show each record's `vram_required_MB` in its selector label. Do not expose arbitrary model URLs or IDs or maintain separate download, storage, or memory-requirement display fields. Before model creation, call `doesBrowserSupportWebLLM()`. After creation, use `availability()` to distinguish `unavailable`, `downloadable`, and `available` states. Model initialization requires an explicit user action and `createSessionWithProgress` reports progress. Never begin a large download merely because the user expanded the panel or because another provider failed.

Run WebLLM in a module Web Worker so model initialization and inference do not block Mol* rendering. `src/extensions/chat/worker.ts` hosts `WebWorkerMLCEngineHandler`; `scripts/build.mjs` emits it as `build/viewer/molstar-chat-worker.js`, and the model factory resolves it with `new URL('./molstar-chat-worker.js', document.baseURI)`. Verify the emitted file manually after the Viewer build.

The custom AI SDK chat transport gives the V1 Mol* tools to `ToolLoopAgent` and merges the resulting text, tool calls, tool results, and model-download progress into an AI SDK UI message stream. Tool inputs are validated by their AI SDK `inputSchema` before `execute`; the tool then performs semantic checks that JSON Schema cannot express, such as current-state preconditions, URL-origin policy, residue-range limits, and registered format availability. Do not use `Output.object` for molecular actions and do not parse tool calls out of assistant text.

V1 allows a bounded multi-step loop only for the current request—for example, `state_tree`, then `download_structure`, then `select_structure`. It does not allow background autonomy, open-ended planning, or execution after the request finishes. A tool may execute only after its complete input validates; partial streamed tool input is display-only. Automatic provider fallback remains out of scope.

### Static Viewer Hosting And Model Assets

The chat extension ships in the existing Viewer bundle under `build/viewer`; do not create a `src/apps/molstar-chat` entry point or a second build target. The existing Viewer asset and routing behavior remains authoritative, including deployments from a GitHub Pages project subpath. No chat-specific server route or runtime environment variables are required.

The application bundle contains provider code but not model weights. Model artifacts are fetched only after consent and cached by the browser/WebLLM. The deployment CSP and asset policy must permit the documented WebLLM worker, WASM/runtime, and allowlisted model asset origins. Show separate, actionable errors for missing WebGPU, insufficient GPU memory, model-download/CORS failure, storage quota, worker startup failure, initialization failure, and generation failure.

GitHub Pages supplies the secure context required by WebGPU-capable browsers. Once model assets are cached, chat should work without an inference endpoint or API token; offline behavior still depends on the runtime and model assets being fully cached.

### OpenAI-Compatible Provider Stretch Goal

After the in-browser path is stable, an optional second `ChatModelFactory` may use `@ai-sdk/openai` with a user-configured OpenAI-compatible endpoint, model, and optional token. Keep endpoint normalization, HTTPS/loopback policy, redirect rejection, CORS diagnostics, credential redaction, and versioned settings isolated from the default local-model path. Never make a remote call automatically when WebGPU is unavailable; fallback requires an explicit user choice.

## Command Protocol V1: AI SDK Tools

V1 is a versioned catalog of statically registered AI SDK tools, not a JSON response containing a command array. Tool names and their input/output schemas form the model-facing protocol. Keep the catalog closed and create it with a factory that captures only the current `PluginContext`, application policy, cancellation state, and mutation gate:

```ts
interface MolstarToolResultV1<T = unknown> {
    version: 1
    status: 'succeeded' | 'failed' | 'cancelled' | 'no-match'
    summary: string
    changed?: boolean
    data?: T
    error?: { code: string, message: string }
}

type DownloadStructureInputV1 = {
    source: 'pdb' | 'alphafolddb' | 'modelarchive'
    id: string
}

const downloadStructureInput = jsonSchema<DownloadStructureInputV1>({
    type: 'object',
    additionalProperties: false,
    required: ['source', 'id'],
    properties: {
        source: { enum: ['pdb', 'alphafolddb', 'modelarchive'] },
        id: { type: 'string', minLength: 1, maxLength: 64 },
    },
})

function createMolstarTools(ctx: MolstarToolContext) {
    return {
        state_tree: tool({
            description: 'Read a bounded summary of loaded structures, chains, selections, and representations.',
            inputSchema: jsonSchema({
                type: 'object',
                additionalProperties: false,
                properties: {},
            }),
            execute: async () => readStateTree(ctx),
        }),
        download_structure: tool({
            description: 'Download one structure from an allowlisted structure database.',
            inputSchema: downloadStructureInput,
            execute: async input => downloadStructure(ctx, input),
        }),
        // Remaining V1 tools follow the same pattern.
    }
}
```

`jsonSchema`/`tool` are shown to avoid adding a second schema library solely for tool definitions. If implementation experience shows that a schema-first library materially reduces duplication, it may be used, but there must still be one canonical schema per tool. Set `additionalProperties: false`, bounded strings and arrays, integer/range constraints, and small enums everywhere. `strict: true` may be requested only after verifying that the pinned WebLLM provider/model supports it; local validation remains mandatory when providers ignore strict mode.

The initial tool catalog is deliberately small:

- `state_tree({})`: return a bounded, read-only snapshot with loaded structure labels/entry IDs/state refs, model counts, chain IDs, a capped residue/component summary, current selection statistics, and representation/preset summary. Never return coordinates, full state snapshots, credentials, or unbounded metadata.
- `download_structure({ source, id })`: normalize and validate the identifier, then call `loadPdb`, `loadAlphaFoldDb`, or `loadModelArchive`. The source enum is fixed; it is not a URL or arbitrary provider name.
- `download_structure_from_url({ url, format, is_binary? })`: apply HTTPS/origin/size-confirmation policy and verify the format against the active registry before calling `loadStructureFromUrl`.
- `select_structure({ target, modifier?, focus?, highlight? })`: accept either a curated built-in selection or a bounded `StructureElement.Schema` subset, apply it through selection/interactivity managers, and return the observed match count.
- `clear_selection({})` and `clear_highlights({})`.
- `apply_representation_preset({ preset })`, `apply_color_theme({ theme })`, and `apply_appearance({ appearance })`.
- `reset_camera({})`.
- `undo({})`, only when `plugin.state.data.canUndo` is true; its result must not imply that selection history was undone.

Initial allowlists should remain deliberately small:

- Structure sources: `pdb`, `alphafolddb`, and `modelarchive`.
- Presets: `auto`, `polymer-and-ligand`, `polymer-cartoon`, `atomic-detail`, `illustrative`, `molecular-surface`.
- Color themes: `default`, `chain-id`, `entity-id`, `element-symbol`, `residue-name`, `secondary-structure`, `hydrophobicity`, `sequence-id`, `uniform`.
- Built-in selections: the stable concepts in `StructureSelectionQueries`, starting with `all`, `polymer`, `protein`, `nucleic`, `ligand`, `water`, `ion`, `helix`, `beta`, `backbone`, and `sidechain`.
- URL formats: formats explicitly supported by the Viewer loader, beginning with `mmcif`, `pdb`, `mol`, `sdf`, and `mol2`; verify names against the active `dataFormats` registry at execution time.

For "Load PDB 1TQN, then select chain A residues 25-40," the model should make separate tool calls across loop steps:

```text
download_structure({ source: 'pdb', id: '1TQN' })
  -> { version: 1, status: 'succeeded', changed: true, summary: 'Loaded PDB 1TQN.', ... }

select_structure({
  target: {
    type: 'elements',
    schema: { auth_asym_id: 'A', beg_auth_seq_id: 25, end_auth_seq_id: 40 }
  },
  modifier: 'set',
  focus: true,
  highlight: true
})
  -> { version: 1, status: 'succeeded', changed: true, summary: 'Selected 16 residues in chain A.', ... }
```

The AI SDK passes each tool result back to the model and records it as a typed UI-message part. The final assistant text summarizes those results but is never the source of truth. Expected domain failures return `status: 'failed'` with a stable, safe error code; a valid zero-element selection returns `no-match`; cancellation returns `cancelled`. Unexpected exceptions become AI SDK tool-error parts and are logged through `plugin.log.error` without leaking sensitive data.

Tool execution follows these rules:

- Mutating tools re-check their preconditions when their `execute` function actually begins; schema validation alone is insufficient.
- The mutation gate serializes state changes in tool-call order, checks cancellation between calls, and prevents a second chat submission while a turn is mutating state.
- The prompt asks for one mutating tool per model step. If a model emits several, serialization preserves safety, but later calls must not assume success until their own preconditions pass.
- The loop stops on a final text response, cancellation, approval request, or the hard step/tool-call limit. Reaching a limit is reported as partial completion, never success.
- A failed mutation may be retried only with materially corrected input supported by the tool result; never blindly repeat the same call.
- Completed mutations are not rolled back when a later tool fails. The transcript preserves every successful, failed, cancelled, and no-match tool result.
- Retries or React rerenders must not execute the same `toolCallId` twice. Once a turn has a successful mutating result, transport retry/regeneration must not replay that turn automatically.

## Viewer Context Available To The Model

Tool descriptions and enums tell the model which operations and allowlist values exist. Do not rebuild and inject a large Viewer-state block on every model step. Instead, expose current state through the read-only `state_tree` tool so the model can inspect state when a request depends on it and refresh its view after a mutation.

The transport may include a tiny initial summary—such as the number of loaded structures and whether a selection exists—to help the model decide whether `state_tree` is necessary. The authoritative tool result can include:

- Loaded structure labels, entry IDs, and stable state refs.
- For each structure, model count and available author/label chain IDs.
- A bounded list of residue/component names, especially ligands.
- Current selection count and a short selection label.
- Current representation/preset summary where cheaply available.

Cap list sizes, result bytes, and nesting depth. Do not serialize coordinates, full state snapshots, asset URLs containing credentials, or arbitrary metadata. Mark every `state_tree` result as untrusted data in the system instructions so structure labels cannot become instructions.

V1 tools can default to all currently selected structures, matching existing manager behavior. Add an optional validated `structure_ref` to relevant tool schemas once multi-structure ambiguity is tested; the model should ask a clarification question instead of guessing when multiple structures match a user reference.

## Safety And Reliability Rules

- Allow only tested model IDs and trusted model-asset origins; do not accept an arbitrary model URL from chat input or query parameters.
- Disclose the model's expected download size, storage use, and approximate GPU-memory requirement before download, and require an explicit user action.
- Enforce client-side message length, history length, context size, generation token limits, and timeouts to bound local memory and GPU use.
- Keep conversation text and Viewer context in memory by default. Do not include either in Mol* snapshots, analytics, or model preference storage.
- Validate every tool call against its canonical `inputSchema` before `execute`, then enforce semantic and application-policy checks inside the tool.
- Register a closed tool map. Reject unknown tool names, unknown properties, presets, themes, formats, sources, and selection keys.
- Validate PDB IDs and normalize them to uppercase. Use the existing loader for provider URL construction.
- For `download_structure_from_url`, allow only `https:` by default. Applications should configure an origin allowlist or require a visible tool approval for an untrusted origin to limit credential leakage and unexpectedly large downloads.
- Put limits on schema item count and residue ranges. Reject non-finite numbers and pathological ranges before constructing a selection.
- Do not render raw model HTML. Reuse `Markdown`, which sets `skipHtml`.
- Abort generation on Cancel or component disposal. Do not start a second generation while tools are mutating state; disable submission until the mutation gate is idle.
- Use Mol* tasks and busy state for long operations. Convert thrown values to safe user-facing errors while retaining detail in `plugin.log.error`.
- Ask for confirmation before destructive tools such as clearing the entire plugin or replacing existing structures. Those tools are intentionally absent from v1. Use the AI SDK approval flow for tools or inputs that require confirmation.
- Treat assistant text as commentary, not proof of execution. Render tool-result parts directly and derive final UI status from them.

## Implementation Steps

### 0. Render A Dummy Chat Control In The Viewer

Start with a UI-only vertical slice before adding the tool protocol, Mol* operation helpers, model setup, or Vercel AI SDK dependencies.

Create the initial `src/extensions/chat/behavior.ts`, `ui.tsx`, `style.scss`, and `index.ts`. Export `ChatExtension`, register `ChatControls` in `ctx.customImportControls`, add `'chat': PluginSpec.Behavior(ChatExtension)` to `src/apps/viewer/extensions.ts`, and include the stylesheet from `src/apps/viewer/index.ts`.

The dummy `ChatControls` should:

- Extend `CollapsableControls`, use the header `Chat`, and start collapsed.
- Expand in the left-side Home panel alongside the existing download/import controls.
- Render a small static transcript area, a multiline text input, and a visibly disabled or explicitly non-functional Send button.
- State inside the panel that this is a UI preview so users do not expect requests or molecular actions to work.
- Use only existing Mol* React controls and styles plus a small extension stylesheet.
- Register and unregister cleanly with the behavior lifecycle.

Do not install `ai`, `@ai-sdk/react`, or `@browser-ai/web-llm` in this step. Do not add model settings, model downloads, workers, `localStorage`, network calls, tool definitions, or mutations of Viewer state. The purpose is to validate placement, collapse behavior, scrolling, responsive layout, extension enable/disable behavior, and the existing Viewer build before introducing the functional layers.

### 1. Add Toolless In-Browser Chat — Implemented

Turn the dummy panel into a real text-only chat before exposing any Mol* capability. Use the implemented exact versions `ai@7.0.112`, `@ai-sdk/react@4.0.115`, and `@browser-ai/web-llm@3.0.3`; the React adapter supports this repository's React 18 build.

Create `src/extensions/chat/model.ts` to own a single ordered model-info allowlist containing `Qwen3-0.6B-q4f16_1-MLC` and `Ministral-3-3B-Instruct-2512-BF16-q4f16_1-MLC`; derive the supported IDs and default order from its keys. It also owns `prebuiltAppConfig` lookup, VRAM-labelled selector options, WebGPU capability checks, model construction, availability, download progress, and lifecycle. Create `src/extensions/chat/worker.ts` with `WebWorkerMLCEngineHandler`, construct the selected model through `webLLM(modelId, { worker, appConfig })`, and emit the worker as `build/viewer/molstar-chat-worker.js`. Model initialization and download must remain explicit user actions.

Create a first `src/extensions/chat/transport.ts` as a custom AI SDK `ChatTransport`. It converts bounded `UIMessage` history to model messages and calls `ToolLoopAgent.stream` with the local model, an abort signal, a timeout, and a tool-free system prompt:

```ts
const agent = new ToolLoopAgent({
    model,
    instructions: buildToollessSystemPrompt(),
    maxOutputTokens: MaxChatOutputTokens,
    maxRetries: 0,
    experimental_telemetry: { isEnabled: false },
})

const result = await agent.stream({
    messages: await convertToModelMessages(messages),
    abortSignal,
    timeout: { totalMs: ChatGenerationTimeoutMs },
})
```

Do not pass `tools`, Viewer context, molecular state, or operation instructions in this milestone. The system prompt must state that this is a conversational preview and that it cannot inspect or modify the Viewer. Assistant text must not imply that molecular actions were performed.

The implemented bounds are 24 messages, 2,000 characters per message, 16,000 history characters, 512 output tokens, a 120-second timeout, zero retries, and disabled AI SDK telemetry.

Use `useChat` for the transcript, submission, streaming status, cancellation, and errors. Add the supported-model selector, explicit Download/Initialize action, progress, basic compatibility/error states, clear conversation, and the local-inference privacy note. Create the initial controller for model setup, transport lifecycle, and disposal, and persist only the allowlisted model preference through the storage abstraction.

Test the transport and UI with a mock language model; normal tests must not download weights. Add one manual supported-browser check that downloads an allowlisted model, sends a plain conversational prompt, streams a response, cancels a response, reloads, and reuses the cached model. Verify that no Mol* state can change from chat in this milestone.

### 2. Implement Bounded Mol* Operations

Create `src/extensions/chat/protocol.ts` for shared V1 input/output types, allowlists, error codes, and `MolstarToolResultV1`. Create `src/extensions/chat/operations.ts` with one function per future tool, plus `state-tree.ts` for the bounded read-only state summary. These functions are ordinary typed application functions; they neither parse model text nor dispatch a command union.

Map operations as follows:

- Structure sources to `loadPdb`, `loadAlphaFoldDb`, and `loadModelArchive` from `src/extensions/plugin/loaders.ts`.
- Explicit URLs to `loadStructureFromUrl`, after local URL/format policy checks.
- Built-in selections to `StructureSelectionQueries` and `StructureSelectionManager.fromSelectionQuery`.
- Element selections to `StructureElement.Schema.toLoci` or `applyStructureInteractivity`.
- Focus/highlight to `applyStructureInteractivity` or the camera/interactivity managers.
- Presets to `plugin.managers.structure.component.applyPreset` and `PresetStructureRepresentations`.
- Color themes to `updateRepresentationsTheme`, with a special path for `default`.
- Default/illustrative appearance to extracted reusable functions based on `quick-styles.tsx`.
- Camera reset to `PluginCommands.Camera.Reset`.
- Undo to `plugin.runTask(plugin.state.data.undo())`, only when `state.data.canUndo` is true.

Every operation checks current-state preconditions, cancellation, and policy immediately before mutation and returns an observed structured result. After selection, use manager statistics to distinguish `succeeded` from `no-match`. Avoid one transaction around network loads; use existing loader transactions. Extract the non-UI quick-style functions from `src/mol-plugin-ui/structure/quick-styles.tsx` into a reusable plugin-state/helper module so chat tools and buttons cannot drift.

### 3. Add The AI SDK Tool Catalog

A developer-only `src/extensions/chat/tools.ts` prototype containing version and PDB-loading tools already exists, but Milestone 1 does not import or register it. In Milestone 2, replace or expand that prototype into the complete V1 catalog with `tool({ description, inputSchema, execute })`, AI SDK `jsonSchema`, and the shared protocol types. Create `src/extensions/chat/mutation-gate.ts` for serialization, cancellation barriers, per-turn limits, and exactly-once `toolCallId` handling.

Schema and tool tests should cover:

- Valid input and result fixtures for every tool.
- Unknown properties and tool names, invalid enums, overlong strings/arrays, non-finite numbers, URL schemes, and residue-range limits.
- Normalization of PDB/source identifiers and current-registry checks for URL formats.
- State preconditions, no-match selections, stable error codes, cancellation boundaries, serialization, step/tool-call budgets, and duplicate `toolCallId`s.
- A direct fixture that invokes tool `execute` functions without a real model, proving that the tool boundary works before WebLLM integration.

### 4. Enable Tools In The Transport And Controller

Evolve the tool-free `ChatTransport`. Its `sendMessages` implementation still converts bounded `UIMessage` history into model messages, but now adds the V1 system instructions and tiny initial state summary, creates the V1 tool map, and invokes AI SDK Core with a bounded tool loop:

```ts
const agent = new ToolLoopAgent({
    model,
    instructions: buildSystemPrompt(),
    tools: createMolstarTools(toolContext),
    toolChoice: 'auto',
    stopWhen: stepCountIs(MAX_TOOL_STEPS),
})

const result = await agent.stream({
    messages,
    abortSignal,
    timeout: { totalMs: ChatGenerationTimeoutMs },
})
```

Use the exact AI SDK 7 `ToolLoopAgent` API shown above. The transport can emit typed model-download progress data parts, then merges the agent's UI-message stream so tool input, approval, output, error, and final-text parts retain their AI SDK types. Treat unsupported WebGPU, download/storage failure, worker failure, model initialization failure, cancellation, invalid tool input, unknown tool, step-limit exhaustion, and timeouts as distinct typed errors. Never execute partial streamed tool input.

Extend the existing `useChat` UI to render tool calls, results, errors, and approvals from `message.parts`. Do not add a second callback that executes operations after generation, because tool `execute` functions already did so. Disable regeneration after any successful mutating tool result unless a future design can prove replay safety.

Extend the controller to own tool policy and the mutation gate in addition to model setup, transport lifecycle, and disposal. It does not duplicate conversation state or execute a command envelope; its observable state is limited to model readiness, download progress, and Mol* mutation status needed outside `useChat`. Keep a bounded in-memory AI SDK message list and do not place it in Mol* snapshots by default because it may contain private user text.

Keep the model factory, operation functions, and transport injectable so tests can use AI SDK mock models without downloading weights and an optional remote provider can be added later without changing tool contracts.

### 5. Expand The Reusable Chat Behavior

Expand the tool-free `ChatExtension` behavior from Step 1 so the existing controller also receives tool policy and the mutation gate. Its parameters should include application policy rather than user credentials:

- The versioned model-preference `localStorage` key, with a collision-resistant default.
- The allowlisted model IDs and default model suggestion.
- Allowed model-asset origins and optional deployment-specific WebLLM configuration.
- Maximum context/history and generation sizes.
- Whether confirmation is required for external structure URLs.

Keep the Step 0 `customImportControls` registration under a unique key such as `molstar-chat`. On `unregister`, unmounting the control must now stop the AI SDK transport request; also abort pending tool execution where the underlying Mol* task permits it, dispose subjects/subscriptions, delete the `customImportControls` entry, and remove stored state.

Export the reusable browser feature from `src/extensions/chat/index.ts`. Keep it independent of `src/apps/viewer` so other plugin specs can register it without importing the Viewer application.

The Step 0 Viewer registration remains:

```ts
'chat': PluginSpec.Behavior(ChatExtension),
```

This makes chat available through the existing `ViewerOptions.extensions` and `disabledExtensions` mechanism. Because the default extension list includes every `ExtensionMap` key, chat is enabled in the standard Viewer unless an embedder disables `'chat'`. On first use, the panel checks compatibility and asks the user to choose and download a supported model; registering the behavior or expanding the panel must not initiate a download.

### 6. Add The Tool-Enabled Chat UI

Evolve the tool-free `ChatControls` without changing its Home-panel placement, header, or collapsed-by-default behavior. Keep it reusable: chat state comes from Vercel AI SDK's `useChat`, Mol* execution state comes from the controller/plugin context, and the component contains no application bootstrap or provider-specific request logic. The expanded panel should contain:

- Scrollable transcript with user text, assistant text, tool calls/results, approvals, and errors.
- Sanitized Markdown for assistant text.
- Multi-line input with Submit and Cancel.
- Enter to submit and Shift+Enter for a newline.
- Busy state tied to request/execution state and compatible with plugin task overlays.
- Per-tool status summaries, including partial failure and zero-match selection.
- Retry for transport failures only when it cannot replay an already completed mutation.
- Clear conversation, which does not clear molecular state.
- A compatibility state that explains when WebGPU/WebLLM is unavailable before offering model setup.
- A supported-model selector showing expected download size, storage use, and approximate GPU-memory requirements.
- Explicit Download/Initialize, Cancel, Retry, and Clear Preference actions, with progress and readiness state. If the pinned WebLLM version has no supported cache-removal API, link users to browser storage controls rather than manipulating undocumented cache internals.
- A concise privacy note that prompts run locally, while the initial model download still fetches assets from the allowlisted model host.
- Actionable errors for unsupported WebGPU, insufficient GPU memory, download/CORS failure, storage quota, worker startup, initialization, timeout, cancellation, and malformed model output.
- A few first-use examples such as load, select/focus, and style.
- Accessible labels, keyboard focus, live status announcements, and disabled-state feedback.

Create `src/extensions/chat/style.scss` and include it from the existing Viewer entry point in `src/apps/viewer/index.ts`. Rely on Mol* CSS variables instead of fixed light-theme colors. Constrain transcript height within the scrollable Home panel and verify left-panel sizing in landscape, portrait, collapsed controls, and embedded mode. Keep the input reachable when the transcript grows and avoid nested scrolling that traps keyboard or wheel input.

### 7. Harden Model Preference Persistence And Static Deployment

Harden the initial `src/extensions/chat/settings.ts` from Step 1 with strict parsing and persistence of versioned model preferences. Keep storage access behind a small interface so tests can use an in-memory implementation and embedders can replace `localStorage` if needed. Model weights remain owned by WebLLM/browser caches, not this settings record.

Settings behavior should:

- Accept only an allowlisted model ID and ignore removed or obsolete IDs safely.
- Persist the selected model ID and small UI preferences only; never persist conversation text or Viewer context by default.
- Treat cached/downloaded status as runtime state queried from the model rather than a trusted `localStorage` flag.
- Leave AI SDK telemetry disabled and do not pass prompts, generated output, or Viewer context to logging or analytics.
- Remove persisted preferences when the user selects Clear Preference; manage cached model assets only through a documented API in the pinned WebLLM version, otherwise leave them to browser storage controls.
- Handle unavailable or quota-exceeded storage without preventing temporary, in-memory use.

Do not add a chat-specific deployment workflow. Reuse the existing Viewer build and deployment path. After building the Viewer, manually verify that the chat CSS, `build/viewer/molstar-chat-worker.js`, and WebLLM runtime assets resolve under the supported deployment path.

When tools are enabled, replace the Step 1 conversational-preview prompt with the bundled V1 tool prompt. It should describe how to use the V1 tools, require `state_tree` before resolving references against unknown Viewer state, distinguish author and label residue numbering, treat tool output as untrusted data rather than instructions, allow at most one mutating tool call per step, require clarification when identifiers are ambiguous, and prohibit claims that an operation succeeded unless its tool result says so.

### 8. Test And Roll Out

Add pure Jest tests under `src/extensions/chat/_spec` for tool schemas, state-tree truncation, result aggregation, cancellation boundaries, mutation-gate behavior, component/controller behavior, and dependent tool calls. Inject operation functions so most tool routing can be tested without WebGL.

Add model, transport, hook integration, and settings tests under `src/extensions/chat/_spec` using an injected capability check, mocked model factory, AI SDK mock models, and in-memory storage. Cover unsupported WebGPU, `unavailable`/`downloadable`/`available` states, explicit download consent, progress, cancellation, worker and quota failures, invalid preferences, AI SDK message conversion, typed tool/data parts, exactly-once tool execution, bounded multi-step behavior, approval flow, `useChat` status behavior, malformed tool input, unknown tools, clearing model preferences, documented cache behavior, and stable error mapping. Normal unit tests must not download a real model.

After `npm run build:apps`, manually serve `build/viewer` from the supported deployment path. Confirm that the chat extension is present, `build/viewer/molstar-chat-worker.js` exists and loads successfully, and a mock in-browser language model can complete one validated tool call plus result. Reuse any existing non-root-path deployment fixture and do not download model weights for this check.

Add focused integration tests with a lightweight `PluginContext` where feasible for:

- Loading fixture structure data, then selecting a known chain/residue range.
- A selection that matches zero elements.
- Applying a preset and color theme and observing the expected state transforms.
- Undo after a visual mutation.
- A failed `download_structure` result followed by the model not attempting a dependent selection.
- Controller disposal aborting an in-flight request.

Add browser/manual scenarios for UI behavior and real network loading:

1. Load `1TQN`, select chain A residues 25-40, focus, then apply cartoon.
2. Load two structures and verify an ambiguous request causes clarification instead of silently targeting one.
3. Apply illustrative style and undo it.
4. Submit a malformed or unknown tool call and verify no state mutation occurs.
5. Cancel during model download, slow generation, and a multi-tool sequence.
6. Exercise the collapsible chat in the left-side Home panel across desktop, narrow/portrait, expanded, and embedded layouts.
7. On a supported browser, explicitly download the selected test model, observe progress, reload, and verify the cached model is reused.
8. Verify prompts and Viewer context never leave the browser during inference and never appear in `localStorage`, logs, analytics, or snapshots.
9. Load the production Viewer build from its supported deployment path and manually verify the chat panel and existing assets resolve, including a successful request for `molstar-chat-worker.js` with no unresolved TypeScript imports.
10. Verify unsupported WebGPU, insufficient memory, interrupted download, quota exhaustion, and worker startup failures produce actionable guidance.

Run at minimum:

```bash
npm run lint
npm run jest -- src/extensions/chat
npm run build:lib
npm run build:apps
```

## Suggested File Changes

Milestone 0 uses only the initial `behavior.ts`, `ui.tsx`, `style.scss`, and `index.ts` files plus the two Viewer registration/style imports. Milestone 1 adds the model, worker, tool-free transport/controller, initial settings, functional chat UI, AI SDK dependencies, tests, and manual checklist. A dormant developer `tools.ts` prototype is present but is not part of the active transport; the protocol, operations, state-tree, complete tool registry, and mutation gate arrive only in Milestone 2.

New files:

- `src/extensions/chat/protocol.ts`
- `src/extensions/chat/operations.ts`
- `src/extensions/chat/state-tree.ts`
- `src/extensions/chat/tools.ts` (developer prototype only until Milestone 2)
- `src/extensions/chat/mutation-gate.ts`
- `src/extensions/chat/model.ts`
- `src/extensions/chat/worker.ts`
- `src/extensions/chat/transport.ts`
- `src/extensions/chat/settings.ts`
- `src/extensions/chat/controller.ts`
- `src/extensions/chat/behavior.ts`
- `src/extensions/chat/ui.tsx`
- `src/extensions/chat/style.scss`
- `src/extensions/chat/index.ts`
- `src/extensions/chat/manual-test.md`
- `src/extensions/chat/_spec/operations.spec.ts`
- `src/extensions/chat/_spec/tools.spec.ts`
- `src/extensions/chat/_spec/mutation-gate.spec.ts`
- `src/extensions/chat/_spec/model.spec.ts`
- `src/extensions/chat/_spec/transport.spec.ts`
- `src/extensions/chat/_spec/settings.spec.ts`
- `src/extensions/chat/_spec/controller.spec.ts`
- `src/extensions/chat/_spec/ui.spec.ts`

Likely modified files:

- `src/apps/viewer/extensions.ts` to register `'chat': PluginSpec.Behavior(ChatExtension)`.
- `src/apps/viewer/index.ts` to include the chat stylesheet in the existing Viewer bundle.
- `src/mol-plugin-ui/structure/quick-styles.tsx` plus a new non-UI helper so buttons and chat share style operations.
- `scripts/build.mjs` to emit `build/viewer/molstar-chat-worker.js`.
- `package.json` and `package-lock.json` to pin `ai@7.0.112`, `@ai-sdk/react@4.0.115`, and `@browser-ai/web-llm@3.0.3`, and to let Jest transform TSX and the SDK's ESM dependencies.
- `tsconfig.json` to include the `ES2022.Intl` declarations required by the installed SDK types.

Avoid changing `PluginUISpec`, the core layout, or `LeftPanelTabName` for the first release. Those changes are unnecessary because `customImportControls` already provides the required location in the Home panel.

## Delivery Milestones

### Milestone 0: Viewer Chat Shell — Completed

- `ChatExtension` is registered in the existing Viewer `ExtensionMap` without adding a separate app.
- The left-side Home panel contains a `Chat` control alongside the existing download/import controls.
- The control starts collapsed and expands to a clearly labeled dummy chat layout with a static transcript, multiline input, and non-functional Send button.
- Disabling `'chat'` through normal Viewer extension options removes the control, and unregistering the behavior cleans up its `customImportControls` entry.
- Desktop, narrow/portrait, and embedded layouts remain usable, including Home-panel scrolling.
- No Vercel AI SDK packages, model configuration, persistence, model downloads, workers, tool protocol, or molecular actions are included yet.
- Lint and the existing Viewer build pass.

### Milestone 1: Toolless In-Browser Chat — Completed

- The dummy transcript is a working text-only chat backed by the allowlisted Qwen3 and Ministral models, whose selector labels include `vram_required_MB`, plus `ToolLoopAgent`, the custom client-side transport, and `useChat`, using the exact pinned SDK versions listed above.
- The UI checks WebGPU support and requires an explicit Download/Initialize action with progress before local inference begins.
- Inference runs in the explicitly bundled `molstar-chat-worker.js`, supports streaming and cancellation, and reuses cached model assets after reload.
- The transcript supports user/assistant text, request status, clear conversation, and actionable model/download/worker errors.
- The selected model preference may persist, but conversation content does not.
- No AI SDK tools are registered with `ToolLoopAgent`, no Viewer context or molecular state is sent to the model, and chat cannot inspect or mutate Mol* state. The dormant `tools.ts` prototype is reserved for Milestone 2.
- Five mock-model/controller/settings/UI test suites with 13 tests cover the tool-free implementation without downloading real model weights.
- Lint, TypeScript, library build, and app builds pass; after the Viewer build, manually verify that `build/viewer/molstar-chat-worker.js` exists and loads from the supported deployment path.

### Milestone 2: Deterministic Local Tool Prototype

- Protocol types, operation helpers, `state_tree`, the AI SDK tool catalog, and the mutation gate exist.
- A developer-only fixture can invoke typed tools directly, without asking the language model to call them.
- Load, selection/focus, preset, color, appearance, camera reset, and undo work.
- Tool-schema, operation, result, cancellation, and serialization tests pass.

### Milestone 3: End-To-End Tool-Enabled Chat

- The tool-free chat transport is extended with the V1 tool registry, bounded multi-step execution, structured tool results, and approvals.
- `ChatExtension` is registered in the existing Viewer `ExtensionMap` and can be enabled or disabled through normal Viewer options.
- The UI offers only allowlisted model IDs tested specifically for Protocol V1 tool calling.
- Model download is opt-in, cancellable, and reports expected size, progress, storage use, and hardware requirements.
- Inference runs in a Web Worker so model initialization and generation do not block Mol* rendering.
- After assets are cached, chat works without an inference endpoint or API token.
- Lightweight model preferences persist in `localStorage`; prompts, conversation history, Viewer context, and tool calls/results do not.
- The existing static Viewer build includes chat and continues to work in its supported deployment environments without a chat backend.
- Cancellation, errors, partial results, and zero matches are visible and accurate.
- WebGPU, GPU-memory, download, storage-quota, worker, initialization, generation, and malformed-output failures are distinguishable and actionable.

### Milestone 4: Hardening And Expansion

- Multi-structure targeting and clarification are reliable.
- Confirmation policy covers untrusted URLs and any newly introduced destructive action.
- Telemetry records latency/error/tool-name aggregates only with host consent and without message content by default.
- Add new molecular tools one at a time with schema, operation, result, and tests updated together.

### Stretch Milestone: OpenAI-Compatible Provider

- An optional `@ai-sdk/openai` model factory supports a user-configured OpenAI-compatible endpoint, model, and optional token through the same transport/tool boundary.
- Endpoint and credential settings are versioned, validated, redacted from logs and snapshots, and removable from browser storage.
- HTTPS/loopback rules, redirect rejection, CORS diagnostics, authentication errors, and credential-origin restrictions are tested.
- A remote provider is never contacted automatically; users explicitly choose it when local inference is unavailable or undesirable.

## Acceptance Criteria

- A user can perform the three requested categories: load a PDB structure, make/focus a selection, and apply common visual styles from natural-language chat.
- Invalid or hallucinated tool calls cannot call arbitrary plugin APIs or bypass schema, semantic, or policy validation.
- Every executed tool has an observable succeeded, failed, cancelled, or no-match result; unexpected exceptions appear as tool errors.
- Existing manual controls continue to work and share implementation with chat where behavior overlaps.
- Visual state mutations use Mol* transactions and are undoable where the underlying state system supports undo.
- Selection behavior clearly documents its separate undo/history semantics.
- The feature is optional and cleanly registered/unregistered through the plugin behavior lifecycle.
- The Viewer exposes the feature as the `'chat'` extension; embedders can remove or disable it with the existing extension options.
- Chat appears as a collapsed-by-default control in the left-side Home panel alongside the existing download/import controls, not in Structure Tools.
- The UI works in desktop and narrow layouts and uses existing Mol* visual conventions.
- A supported local model can be explicitly downloaded, initialized, and used through `@browser-ai/web-llm`; no API endpoint or token is required.
- Chat lifecycle/state use `useChat` from `@ai-sdk/react`, while inference and bounded tool calling run locally through the Vercel AI SDK provider boundary.
- Model weights are not bundled, downloads show progress, inference runs in a worker, and cached assets are reused where supported.
- Unsupported WebGPU, insufficient resources, model-download, storage, worker, timeout, cancellation, and malformed-response failures are distinguishable and actionable.
- The built Viewer includes the chat extension without introducing another application target or backend.
- Lint, targeted Jest tests, library build, and the Viewer app build pass.
