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

- Load a PDB entry or a supported structure URL.
- Select, add, remove, or intersect common molecular targets.
- Focus or highlight a target.
- Clear selection/highlights and reset the camera.
- Apply a curated representation preset.
- Apply a curated color theme or default/illustrative appearance.
- Report exactly which tool calls succeeded or failed.
- Run a curated small instruction model locally through `@browser-ai/web-llm`, with no API endpoint or token required.
- Check WebGPU support before offering model setup, require an explicit model download, show progress, and reuse the browser's cached model assets.
- Persist only lightweight local preferences such as the selected supported model ID; do not place model weights or conversation content in Mol* snapshots.

Deferred until the command boundary is stable:

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
- The loader currently appends structures. A destructive "replace current structure" operation should be a separate explicit command requiring confirmation rather than an implicit property of load.

### Selections And Camera Interaction

- `applyStructureInteractivity` in `src/extensions/plugin/interactivity.ts` already supports `select`, `highlight`, and `focus` over all applicable structures, with optional structure filtering.
- `StructureElement.Schema` in `src/mol-model/structure/structure/element/schema.ts` is a suitable safe wire-level selection vocabulary. It supports chain IDs, residue IDs/ranges, residue names, atom names, element symbols, entity IDs, insertion codes, and model instance/operator identifiers.
- `StructureSelectionQueries` in `src/mol-plugin-state/helpers/structure-selection-query.ts` provides curated semantic selections including polymer, protein, nucleic acid, ligand, water, ion, lipid, helix, beta strand, backbone, sidechain, and surroundings.
- `StructureSelectionManager` in `src/mol-plugin-state/manager/structure/selection.ts` provides `fromLoci`, `fromCompiledQuery`, `fromSelectionQuery`, modifiers, selection statistics, and snapshots.
- `compileIdListSelection` in `src/mol-script/util/id-list.ts` can support familiar author/label residue-list syntax if that syntax is exposed directly in a later command version.
- Selection changes are managed separately from the data-state undo stack. The chat response must not claim that data-state Undo will reverse a selection unless selection snapshot/restore is implemented for that command.

Use schema-based selection for explicit chain/residue/atom requests and the built-in query registry for named concepts. Do not accept serialized MolScript expressions from the model in v1.

### Representations And Styles

- `StructureComponentManager.applyPreset` in `src/mol-plugin-state/manager/structure/component.ts` applies a preset to the current structure hierarchy and wraps it in an undoable transaction.
- `PresetStructureRepresentations` in `src/mol-plugin-state/builder/structure/representation-preset.ts` includes automatic, polymer-and-ligand, polymer-cartoon, atomic-detail, illustrative, molecular-surface, and other presets.
- `StructureComponentManager.addRepresentation`, `updateRepresentations`, `updateRepresentationsTheme`, and `applyTheme` cover lower-level representation and theme changes.
- `src/mol-plugin-ui/structure/quick-styles.tsx` is the canonical implementation for the current Default, Cartoon, Spacefill, Surface, and Illustrative buttons. Extract or mirror its non-UI operations instead of simulating button clicks.
- Registered representation and color-theme names are available from plugin registries. Initial chat commands should still use allowlists so model output remains stable across Mol* versions.
- State-changing representation operations already use `canUndo` labels such as `Preset`, `Update Representation`, and `Update Theme`. Group a multi-command visual change into one transaction where practical and give it a clear `Chat: ...` undo label.

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
AI SDK Core streamText (bounded multi-step tool loop)
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
- `MolstarChatTransport` converts bounded UI message history to model messages and runs `streamText` locally with the system instructions, registered tools, an abort signal, and a hard step limit.
- `createMolstarTools` defines the V1 tool names, descriptions, input schemas, and `execute` functions. Tool schemas are the wire protocol and are shared with UI-message validation and tests.
- Each `execute` function normalizes its already schema-validated input, applies semantic and deployment-policy checks, calls a public/high-level Mol* API, and returns a bounded structured result based on observed state.
- A small mutation gate prevents overlapping chat submissions and serializes mutating tool calls. Read-only tools use the same gate as a barrier when they must observe all preceding mutations.
- `@ai-sdk/react` owns chat messages, tool-call/tool-result parts, submission, approval responses, cancellation, retries, and request status. The UI does not infer success from assistant prose.

Use the Vercel AI SDK with `@browser-ai/web-llm` as the primary language-model provider, `@ai-sdk/react` for chat state, and the core `ai` package for `tool`, `jsonSchema`, `streamText`, model/UI message conversion, loop control, and transport primitives. Pin mutually compatible major versions; `@browser-ai/web-llm` major versions track Vercel AI SDK major versions. The selected WebLLM model must be tested for tool calling, not merely text or JSON generation.

The transport should use a bounded AI SDK tool loop rather than a custom loop. In the pinned SDK version, configure the equivalent of:

```ts
const tools = createMolstarTools({ plugin, policy, mutationGate })

const result = streamText({
    model,
    instructions: buildSystemPrompt(),
    messages: await convertToModelMessages(messages),
    tools,
    toolChoice: 'auto',
    stopWhen: isStepCount(MAX_TOOL_STEPS),
    abortSignal,
})
```

`MAX_TOOL_STEPS` should be small (for example, 8). The system instructions tell the model to inspect state with `state_tree` when a request depends on current Viewer state, call at most one mutating tool per step, use the returned result before choosing the next action, and finish with a concise summary. The runtime still enforces serialization and limits because prompting is not a safety boundary.

### In-Browser Model Configuration

Implement the model factory in `src/extensions/chat/model.ts` with `webLLM` from `@browser-ai/web-llm`. Keep a narrow boundary around the AI SDK language model:

```ts
interface ChatModelFactory {
    create(modelId: SupportedChatModel): LanguageModel
}
```

Select a small allowlisted instruction model only after testing it for Protocol V1 accuracy and memory use. Do not expose arbitrary model URLs or IDs. Before model creation, call `doesBrowserSupportWebLLM()`. After creation, use `availability()` to distinguish `unavailable`, `downloadable`, and `available` states. If downloading is required, show the model's expected download and memory requirements, require explicit user confirmation, and call `createSessionWithProgress` to report progress. Never begin a large download merely because the user expanded the panel or because another provider failed.

Run WebLLM in a module Web Worker created with `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })` so model initialization and inference do not block Mol* rendering. `src/extensions/chat/worker.ts` hosts `WebWorkerMLCEngineHandler`. Confirm that the existing Viewer build emits and resolves the worker chunk correctly.

The custom AI SDK chat transport exposes the V1 Mol* tools to `streamText` and merges the resulting text, tool calls, tool results, and model-download progress into an AI SDK UI message stream. Tool inputs are validated by their AI SDK `inputSchema` before `execute`; the tool then performs semantic checks that JSON Schema cannot express, such as current-state preconditions, URL-origin policy, residue-range limits, and registered format availability. Do not use `Output.object` for molecular actions and do not parse tool calls out of assistant text.

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
- Validate every model response in the browser even when the provider uses structured output.
- Reject unknown command kinds, properties, presets, themes, formats, and selection keys.
- Validate PDB IDs and normalize them to uppercase. Use the existing loader for provider URL construction.
- For `load-url`, allow only `https:` by default. Applications should configure an origin allowlist or require a visible confirmation for an untrusted origin to limit SSRF-like proxying, credential leakage, and unexpectedly large downloads.
- Put limits on schema item count and residue ranges. Reject non-finite numbers and pathological ranges before constructing a selection.
- Do not render raw model HTML. Reuse `Markdown`, which sets `skipHtml`.
- Abort generation on Cancel or component disposal. Do not start a second generation or execution while commands are mutating state; either disable submit or queue requests explicitly.
- Use Mol* tasks and busy state for long operations. Convert thrown values to safe user-facing errors while retaining detail in `plugin.log.error`.
- Ask for confirmation before destructive commands such as clearing the entire plugin or replacing existing structures. Those commands are intentionally absent from v1.
- Treat an assistant message as proposed intent, not proof of execution. Append execution results after commands finish and phrase the final UI status from actual results.

## Implementation Steps

### 0. Render A Dummy Chat Control In The Viewer

Start with a UI-only vertical slice before adding the protocol, command executor, model setup, or Vercel AI SDK dependencies.

Create the initial `src/extensions/chat/behavior.ts`, `ui.tsx`, `style.scss`, and `index.ts`. Export `ChatExtension`, register `ChatControls` in `ctx.customImportControls`, add `'chat': PluginSpec.Behavior(ChatExtension)` to `src/apps/viewer/extensions.ts`, and include the stylesheet from `src/apps/viewer/index.ts`.

The dummy `ChatControls` should:

- Extend `CollapsableControls`, use the header `Chat`, and start collapsed.
- Expand in the left-side Home panel alongside the existing download/import controls.
- Render a small static transcript area, a multiline text input, and a visibly disabled or explicitly non-functional Send button.
- State inside the panel that this is a UI preview so users do not expect requests or molecular actions to work.
- Use only existing Mol* React controls and styles plus a small extension stylesheet.
- Register and unregister cleanly with the behavior lifecycle.

Do not install `ai`, `@ai-sdk/react`, or `@browser-ai/web-llm` in this step. Do not add model settings, model downloads, workers, `localStorage`, network calls, command parsing, or mutations of Viewer state. The purpose is to validate placement, collapse behavior, scrolling, responsive layout, extension enable/disable behavior, and the existing Viewer build before introducing the functional layers.

### 1. Add Protocol And Validation

Create `src/extensions/chat/protocol.ts` containing the V1 request, response, command, selection, context, and result types. Create `src/extensions/chat/validation.ts` with strict, dependency-free runtime validation and normalization.

Validation should return actionable errors with a JSON path, for example `commands[1].target.schema.auth_seq_id must be an integer`. Unit-test valid commands, each union member, unknown fields, invalid enum values, overlong arrays/strings, URL schemes, and numeric/range limits.

Do this before any model integration. Fixture JSON can drive the executor and UI during development.

### 2. Implement The Mol* Command Executor

Create `src/extensions/chat/executor.ts` with one public entry point:

```ts
executeChatCommands(plugin: PluginContext, commands: ChatCommandV1[], signal?: AbortSignal): Promise<ChatCommandResult[]>
```

Map commands as follows:

- `load-pdb` to `loadPdb` from `src/extensions/plugin/loaders.ts`.
- `load-url` to `loadStructureFromUrl`, after local URL/format policy checks.
- Built-in selections to `StructureSelectionQueries` and `StructureSelectionManager.fromSelectionQuery`.
- Element selections to `StructureElement.Schema.toLoci` or `applyStructureInteractivity`.
- Focus/highlight to `applyStructureInteractivity` or the camera/interactivity managers.
- Presets to `plugin.managers.structure.component.applyPreset` and `PresetStructureRepresentations`.
- Color themes to `updateRepresentationsTheme`, with a special path for `default`.
- Default/illustrative appearance to extracted reusable functions based on `quick-styles.tsx`.
- Camera reset to `PluginCommands.Camera.Reset`.
- Undo to `plugin.runTask(plugin.state.data.undo())`, only when `state.data.canUndo` is true.

Before each command, check required preconditions such as at least one loaded structure. After selection, use manager statistics to report zero matches rather than claiming success. Check `signal.aborted` between commands. Avoid one transaction around network loads; use existing loader transactions, then group adjacent representation/theme mutations when practical.

Extract the non-UI quick-style functions from `src/mol-plugin-ui/structure/quick-styles.tsx` into a reusable plugin-state/helper module rather than importing UI code into the executor. Keep the current buttons calling the same extracted functions so chat and buttons cannot drift.

### 3. Add The In-Browser Model, Transport, And Controller

Add compatible pinned versions of `ai`, `@ai-sdk/react`, and `@browser-ai/web-llm`. Keep these versions aligned because the provider major version tracks the Vercel AI SDK major version and the `ChatTransport`/`UIMessage` APIs evolve together. Verify React peer requirements against this repository's React 18 build.

Create `src/extensions/chat/model.ts` to own the supported model allowlist, capability checks, model construction, availability, download progress, and lifecycle. Create `src/extensions/chat/worker.ts` with `WebWorkerMLCEngineHandler`, and construct the selected model through `webLLM(modelId, { worker })`. Do not initialize or download the model until the user explicitly chooses to do so.

Create `src/extensions/chat/transport.ts` as a custom AI SDK `ChatTransport`. Its `sendMessages` implementation converts bounded `UIMessage` history into model messages, adds the system prompt and Viewer context, and invokes AI SDK Core:

```ts
const result = await generateText({
    model,
    system: buildSystemPrompt(context),
    messages,
    output: Output.object({
        name: 'molstar_chat_response_v1',
        schema: chatResponseV1Schema,
    }),
    abortSignal,
})
```

Use an AI SDK-compatible JSON Schema adapter backed by the same V1 schema used by local validation; do not maintain an unrelated hand-written schema. The transport can emit typed model-download progress data parts, then emits the validated `message` and command envelope only after generation completes. Commands execute only after the complete envelope passes the local strict validator. Treat unsupported WebGPU, download/storage failure, worker failure, model initialization failure, cancellation, missing output, invalid objects, and timeouts as typed transport errors. Do not execute partial structured output.

In `src/extensions/chat/ui.tsx`, use `useChat` from `@ai-sdk/react` with this transport for messages, `sendMessage`, `regenerate`, `stop`, error state, and request status. Keep text input state local because current `useChat` does not own it. Use the hook's data/finish callbacks to hand a validated command envelope to `ChatController` exactly once. Give each completed envelope a stable response ID and have the controller deduplicate it so React rerenders, retries, or repeated callbacks cannot execute commands twice.

Create `src/extensions/chat/controller.ts` to own Viewer context construction, sequential command execution, execution results, and disposal. It no longer duplicates conversation or transport state already owned by `useChat`; its RxJS state is limited to Mol* execution status/results needed outside the hook. Keep a bounded in-memory AI SDK message list and do not place it in Mol* snapshots by default because it may contain private user text.

Keep the model factory and transport injectable so tests can use AI SDK mock models without downloading weights and an optional remote provider can be added later without changing the validator or executor.

### 4. Expand The Reusable Chat Behavior

Expand the `ChatExtension` behavior scaffold from Step 0 to create and dispose the functional controller. Its parameters should include application policy rather than user credentials:

- The versioned model-preference `localStorage` key, with a collision-resistant default.
- The allowlisted model IDs and default model suggestion.
- Allowed model-asset origins and optional deployment-specific WebLLM configuration.
- Maximum context/history and generation sizes.
- Whether confirmation is required for external structure URLs.

Keep the Step 0 `customImportControls` registration under a unique key such as `molstar-chat`. On `unregister`, unmounting the control must now stop the AI SDK transport request; also abort pending command execution, dispose subjects/subscriptions, delete the `customImportControls` entry, and remove stored state.

Export the reusable browser feature from `src/extensions/chat/index.ts`. Keep it independent of `src/apps/viewer` so other plugin specs can register it without importing the Viewer application.

The Step 0 Viewer registration remains:

```ts
'chat': PluginSpec.Behavior(ChatExtension),
```

This makes chat available through the existing `ViewerOptions.extensions` and `disabledExtensions` mechanism. Because the default extension list includes every `ExtensionMap` key, chat is enabled in the standard Viewer unless an embedder disables `'chat'`. On first use, the panel checks compatibility and asks the user to choose and download a supported model; registering the behavior or expanding the panel must not initiate a download.

### 5. Replace The Dummy Panel With The Functional Chat UI

Evolve the Step 0 `ChatControls` shell without changing its Home-panel placement, header, or collapsed-by-default behavior. Keep it reusable: chat state comes from Vercel AI SDK's `useChat`, Mol* execution state comes from the controller/plugin context, and the component contains no application bootstrap or provider-specific request logic. The expanded panel should contain:

- Scrollable transcript with user, assistant, execution-result, and error messages.
- Sanitized Markdown for assistant text.
- Multi-line input with Submit and Cancel.
- Enter to submit and Shift+Enter for a newline.
- Busy state tied to request/execution state and compatible with plugin task overlays.
- Per-command status summaries, including partial failure and zero-match selection.
- Retry for transport failures without automatically replaying already executed commands.
- Clear conversation, which does not clear molecular state.
- A compatibility state that explains when WebGPU/WebLLM is unavailable before offering model setup.
- A supported-model selector showing expected download size, storage use, and approximate GPU-memory requirements.
- Explicit Download/Initialize, Cancel, Retry, and Clear Preference actions, with progress and readiness state. If the pinned WebLLM version has no supported cache-removal API, link users to browser storage controls rather than manipulating undocumented cache internals.
- A concise privacy note that prompts run locally, while the initial model download still fetches assets from the allowlisted model host.
- Actionable errors for unsupported WebGPU, insufficient GPU memory, download/CORS failure, storage quota, worker startup, initialization, timeout, cancellation, and malformed model output.
- A few first-use examples such as load, select/focus, and style.
- Accessible labels, keyboard focus, live status announcements, and disabled-state feedback.

Create `src/extensions/chat/style.scss` and include it from the existing Viewer entry point in `src/apps/viewer/index.ts`. Rely on Mol* CSS variables instead of fixed light-theme colors. Constrain transcript height within the scrollable Home panel and verify left-panel sizing in landscape, portrait, collapsed controls, and embedded mode. Keep the input reachable when the transcript grows and avoid nested scrolling that traps keyboard or wheel input.

### 6. Add Model Preference Persistence And Static Deployment

Create `src/extensions/chat/settings.ts` for strict parsing and persistence of versioned model preferences. Keep storage access behind a small interface so tests can use an in-memory implementation and embedders can replace `localStorage` if needed. Model weights remain owned by WebLLM/browser caches, not this settings record.

Settings behavior should:

- Accept only an allowlisted model ID and ignore removed or obsolete IDs safely.
- Persist the selected model ID and small UI preferences only; never persist conversation text or Viewer context by default.
- Treat cached/downloaded status as runtime state queried from the model rather than a trusted `localStorage` flag.
- Leave AI SDK telemetry disabled and do not pass prompts, generated output, or Viewer context to logging or analytics.
- Remove persisted preferences when the user selects Clear Preference; manage cached model assets only through a documented API in the pinned WebLLM version, otherwise leave them to browser storage controls.
- Handle unavailable or quota-exceeded storage without preventing temporary, in-memory use.

Do not add a chat-specific deployment workflow. Reuse the existing Viewer build and deployment path. Extend its smoke coverage to verify that the chat CSS, Web Worker chunk, and WebLLM runtime assets resolve under the supported deployment path.

The system prompt is bundled with the extension. It should describe only Protocol V1 and the distinction between author and label residue numbering, mark Viewer context as untrusted, require clarification when identifiers are ambiguous, and prohibit claims that an operation succeeded. Success is determined only by the browser executor.

### 7. Test And Roll Out

Add pure Jest tests under `src/extensions/chat/_spec` for protocol validation, context truncation, result aggregation, cancellation boundaries, component/controller behavior, and command dependency behavior. Use a small executor adapter interface or injected operation functions so most command routing can be tested without WebGL.

Add model, transport, hook integration, and settings tests under `src/extensions/chat/_spec` using an injected capability check, mocked model factory, AI SDK mock models, and in-memory storage. Cover unsupported WebGPU, `unavailable`/`downloadable`/`available` states, explicit download consent, progress, cancellation, worker and quota failures, invalid preferences, AI SDK message conversion, typed data parts, exactly-once command execution, `useChat` status behavior, response validation, clearing model preferences, documented cache behavior, and stable error mapping. Normal unit tests must not download a real model.

Add a Viewer smoke test that serves `build/viewer`, confirms the chat extension and worker chunk are present, injects a mock in-browser language model, and completes one validated command response. Reuse any existing non-root-path deployment fixture rather than downloading model weights in the normal smoke test.

Add focused integration tests with a lightweight `PluginContext` where feasible for:

- Loading fixture structure data, then selecting a known chain/residue range.
- A selection that matches zero elements.
- Applying a preset and color theme and observing the expected state transforms.
- Undo after a visual mutation.
- One failed command followed by dependent-command skipping.
- Controller disposal aborting an in-flight request.

Add browser/manual scenarios for UI behavior and real network loading:

1. Load `1TQN`, select chain A residues 25-40, focus, then apply cartoon.
2. Load two structures and verify an ambiguous request causes clarification instead of silently targeting one.
3. Apply illustrative style and undo it.
4. Submit malformed model JSON and verify no state mutation occurs.
5. Cancel during model download, slow generation, and a multi-command sequence.
6. Exercise the collapsible chat in the left-side Home panel across desktop, narrow/portrait, expanded, and embedded layouts.
7. On a supported browser, explicitly download the selected test model, observe progress, reload, and verify the cached model is reused.
8. Verify prompts and Viewer context never leave the browser during inference and never appear in `localStorage`, logs, analytics, or snapshots.
9. Load the production Viewer build from its supported deployment path and verify the chat panel, worker, runtime, and existing assets resolve.
10. Verify unsupported WebGPU, insufficient memory, interrupted download, quota exhaustion, and worker startup failures produce actionable guidance.

Run at minimum:

```bash
npm run lint
npm run jest -- src/extensions/chat
npm run build:lib
npm run build:apps
```

## Suggested File Changes

Milestone 0 uses only the initial `behavior.ts`, `ui.tsx`, `style.scss`, and `index.ts` files plus the two Viewer registration/style imports. The remaining files and package dependencies are introduced in later milestones.

New files:

- `src/extensions/chat/protocol.ts`
- `src/extensions/chat/validation.ts`
- `src/extensions/chat/context.ts`
- `src/extensions/chat/executor.ts`
- `src/extensions/chat/model.ts`
- `src/extensions/chat/worker.ts`
- `src/extensions/chat/transport.ts`
- `src/extensions/chat/settings.ts`
- `src/extensions/chat/controller.ts`
- `src/extensions/chat/behavior.ts`
- `src/extensions/chat/ui.tsx`
- `src/extensions/chat/style.scss`
- `src/extensions/chat/index.ts`
- `src/extensions/chat/_spec/validation.spec.ts`
- `src/extensions/chat/_spec/executor.spec.ts`
- `src/extensions/chat/_spec/model.spec.ts`
- `src/extensions/chat/_spec/transport.spec.ts`
- `src/extensions/chat/_spec/settings.spec.ts`
- `src/extensions/chat/_spec/controller.spec.ts`
- `src/extensions/chat/_spec/ui.spec.ts`

Likely modified files:

- `src/apps/viewer/extensions.ts` to register `'chat': PluginSpec.Behavior(ChatExtension)`.
- `src/apps/viewer/index.ts` to include the chat stylesheet in the existing Viewer bundle.
- `src/mol-plugin-ui/structure/quick-styles.tsx` plus a new non-UI helper so buttons and chat share style operations.
- `package.json` and `package-lock.json` to add compatible pinned `ai`, `@ai-sdk/react`, and `@browser-ai/web-llm` dependencies.

Avoid changing `PluginUISpec`, the core layout, or `LeftPanelTabName` for the first release. Those changes are unnecessary because `customImportControls` already provides the required location in the Home panel.

## Delivery Milestones

### Milestone 0: Viewer Chat Shell — Completed

- `ChatExtension` is registered in the existing Viewer `ExtensionMap` without adding a separate app.
- The left-side Home panel contains a `Chat` control alongside the existing download/import controls.
- The control starts collapsed and expands to a clearly labeled dummy chat layout with a static transcript, multiline input, and non-functional Send button.
- Disabling `'chat'` through normal Viewer extension options removes the control, and unregistering the behavior cleans up its `customImportControls` entry.
- Desktop, narrow/portrait, and embedded layouts remain usable, including Home-panel scrolling.
- No Vercel AI SDK packages, model configuration, persistence, model downloads, workers, command protocol, or molecular actions are included yet.
- Lint and the existing Viewer build pass.

### Milestone 1: Deterministic Local Prototype

- Protocol, validator, context builder, and executor exist.
- The dummy panel can be wired to a developer fixture that submits JSON commands without an LLM.
- Load, selection/focus, preset, color, appearance, camera reset, and undo work.
- Core validation and executor tests pass.

### Milestone 2: End-To-End In-Browser Chat

- `@browser-ai/web-llm`, the custom AI SDK transport, `useChat` integration, controller, and responsive chat UI exist.
- `ChatExtension` is registered in the existing Viewer `ExtensionMap` and can be enabled or disabled through normal Viewer options.
- The UI checks WebGPU support and offers only allowlisted model IDs tested for Protocol V1 generation.
- Model download is opt-in, cancellable, and reports expected size, progress, storage use, and hardware requirements.
- Inference runs in a Web Worker so model initialization and generation do not block Mol* rendering.
- After assets are cached, chat works without an inference endpoint or API token.
- Lightweight model preferences persist in `localStorage`; prompts, conversation history, Viewer context, and generated commands do not.
- The existing static Viewer build includes chat and continues to work in its supported deployment environments without a chat backend.
- Cancellation, errors, partial results, and zero matches are visible and accurate.
- WebGPU, GPU-memory, download, storage-quota, worker, initialization, generation, and malformed-output failures are distinguishable and actionable.

### Milestone 3: Hardening And Expansion

- Multi-structure targeting and clarification are reliable.
- Confirmation policy covers untrusted URLs and any newly introduced destructive action.
- Telemetry records latency/error/command-kind aggregates only with host consent and without message content by default.
- Add new molecular commands one at a time with protocol, validation, executor, and tests updated together.

### Stretch Milestone: OpenAI-Compatible Provider

- An optional `@ai-sdk/openai` model factory supports a user-configured OpenAI-compatible endpoint, model, and optional token through the same transport/validator/executor boundary.
- Endpoint and credential settings are versioned, validated, redacted from logs and snapshots, and removable from browser storage.
- HTTPS/loopback rules, redirect rejection, CORS diagnostics, authentication errors, and credential-origin restrictions are tested.
- A remote provider is never contacted automatically; users explicitly choose it when local inference is unavailable or undesirable.

## Acceptance Criteria

- A user can perform the three requested categories: load a PDB structure, make/focus a selection, and apply common visual styles from natural-language chat.
- Invalid or hallucinated command output cannot call arbitrary plugin APIs or partially bypass validation.
- Every executed command has an observable success, failure, skipped, or zero-match result.
- Existing manual controls continue to work and share implementation with chat where behavior overlaps.
- Visual state mutations use Mol* transactions and are undoable where the underlying state system supports undo.
- Selection behavior clearly documents its separate undo/history semantics.
- The feature is optional and cleanly registered/unregistered through the plugin behavior lifecycle.
- The Viewer exposes the feature as the `'chat'` extension; embedders can remove or disable it with the existing extension options.
- Chat appears as a collapsed-by-default control in the left-side Home panel alongside the existing download/import controls, not in Structure Tools.
- The UI works in desktop and narrow layouts and uses existing Mol* visual conventions.
- A supported local model can be explicitly downloaded, initialized, and used through `@browser-ai/web-llm`; no API endpoint or token is required.
- Chat lifecycle/state use `useChat` from `@ai-sdk/react`, while inference and structured generation run locally through the Vercel AI SDK provider boundary.
- Model weights are not bundled, downloads show progress, inference runs in a worker, and cached assets are reused where supported.
- Unsupported WebGPU, insufficient resources, model-download, storage, worker, timeout, cancellation, and malformed-response failures are distinguishable and actionable.
- The built Viewer includes the chat extension without introducing another application target or backend.
- Lint, targeted Jest tests, library build, and the Viewer app build pass.
