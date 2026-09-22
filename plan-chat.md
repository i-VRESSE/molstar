# Mol* Chat Assistant Plan

## Goal

Add an optional chat panel to the Mol* Viewer where a user can ask for operations such as:

- "Load PDB 1TQN."
- "Select chain A, residues 25 through 40, and focus on it."
- "Show the protein as cartoon and the ligand as ball-and-stick."
- "Color the structure by chain."
- "Use the illustrative style."

The language model should interpret a request, but it must not directly manipulate the plugin, emit executable JavaScript, or provide arbitrary MolScript to evaluate. It should return a small, versioned set of typed commands. Mol* validates those commands and executes them through its existing public/high-level APIs.

## Scope And Assumptions

The first version is a dedicated application under `src/apps/molstar-chat`. Its reusable browser-side protocol, controller, executor, plugin behavior, and React UI live under `src/extensions/chat`; in particular, the chat panel component is not owned by the application entry point. It is not a general scientific question-answering system and does not initially inspect external literature.

In scope for the first version:

- Load a PDB entry or a supported structure URL.
- Select, add, remove, or intersect common molecular targets.
- Focus or highlight a target.
- Clear selection/highlights and reset the camera.
- Apply a curated representation preset.
- Apply a curated color theme or default/illustrative appearance.
- Report exactly which commands succeeded or failed.
- Let each user configure an OpenAI-compatible endpoint, model, and optional API token in the chat UI.
- Persist provider settings in browser `localStorage` so the application can be hosted as static files, including on GitHub Pages.

Deferred until the command boundary is stable:

- Measurements, superposition, density maps, animations, and structure editing.
- Arbitrary MolScript supplied by a model.
- Voice input, image input, and retrieval-augmented scientific answers.
- Autonomous multi-step loops that inspect a result and decide on more mutations.
- Running a small language model entirely in the browser as an alternative provider.

## Repository Findings

### UI And Extension Points

- `src/mol-plugin-ui/spec.ts` defines `PluginUISpec`. Whole layout regions can be replaced through `components.controls`, and the right-side structure tool component can be replaced through `components.structureTools`.
- `src/mol-plugin-ui/plugin.tsx` renders the standard regions and `DefaultStructureTools` in the right panel.
- `src/mol-plugin-ui/controls.tsx` renders `CustomStructureControls` at the end of `DefaultStructureTools`. It obtains controls from `plugin.customStructureControls`.
- `src/mol-plugin/context.ts` owns `customStructureControls`, `customState`, logging, tasks, state transactions, and plugin lifecycle.
- Existing extensions register and unregister UI in behavior lifecycle methods. `src/extensions/assembly-symmetry/behavior.ts`, `src/extensions/geo-export/index.ts`, and `src/extensions/mp4-export/index.ts` are the patterns to follow.
- `src/apps/viewer` provides the application structure and Viewer configuration patterns to reuse, but the existing standalone Viewer does not need to register or expose chat. `src/apps/molstar-chat` owns the chat-enabled plugin spec and application entry point.
- `PluginUIComponent` and `PurePluginUIComponent` in `src/mol-plugin-ui/base.tsx` expose the `PluginUIContext` and automatically dispose registered RxJS subscriptions.
- Existing `Button`, `IconButton`, text controls, collapsible sections, task overlays, toasts, and Markdown rendering should be reused. `src/mol-plugin-ui/controls/markdown.tsx` already sanitizes model text with `skipHtml` and supports GFM.

The least invasive first implementation is a `PluginBehavior` in `src/extensions/chat` that registers a collapsible React chat control with `customStructureControls`. The dedicated `src/apps/molstar-chat` app enables that behavior. This requires no new generic layout API and leaves `src/apps/viewer` unchanged. If chat later needs to be permanently visible, the app can supply a `components.structureTools` wrapper that places the same component above `DefaultStructureTools` without changing the chat controller or executor.

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
useChat (@ai-sdk/react: conversation, cancellation, request status)
    |
    +--> MolstarChatTransport --> AI SDK Core --> @ai-sdk/openai --> OpenAI-compatible endpoint
    |                                                   ^
    |                                                   | system prompt + JSON schema + context summary
    v
validateChatResponse (untrusted JSON -> typed commands)
    |
    v
ChatCommandExecutor (sequential, deterministic)
    |
    +--> loaders
    +--> interactivity/selection managers
    +--> component/representation managers
    +--> camera/state APIs
```

Responsibilities must remain separated:

- The settings UI owns endpoint, model, and optional token configuration and persists them in browser `localStorage`.
- `MolstarChatTransport` translates AI SDK UI messages plus compact Viewer context into a structured AI SDK generation request and receives provider-neutral JSON.
- The validator treats every response as untrusted input, rejects unknown fields/commands, enforces lengths and numeric bounds, and normalizes identifiers.
- The executor contains all Mol*-specific mutation logic and never performs a command not represented by the local TypeScript union.
- `@ai-sdk/react` owns chat messages, submission, cancellation, retries, and request status; the UI renders that state and contains no molecular-operation logic.

Use `@ai-sdk/openai` as the provider adapter and `@ai-sdk/react` for chat state. The AI SDK core `ai` package is also required by those integrations for structured generation, UI message types, and transport primitives. The configured provider must expose an OpenAI-compatible `/chat/completions` API and permit browser requests with CORS.

### Browser Provider Configuration

Implement the provider factory in `src/extensions/chat/client.ts` with `createOpenAI` from `@ai-sdk/openai`. Pass the user settings as `baseURL` and `apiKey`, inject a guarded browser `fetch`, and always select `provider.chat(model)` because generic compatible endpoints commonly implement Chat Completions but not OpenAI's Responses API. The dedicated application remains static and has no required Mol* chat server.

The user-configurable settings are:

- **Endpoint:** an HTTPS OpenAI-compatible API base URL, for example `https://openrouter.ai/api/v1`; allow loopback HTTP endpoints such as `http://127.0.0.1:11434/v1` for local development.
- **Model:** the provider model identifier sent in the request. Do not ship a default hosted model because availability changes independently of Mol*.
- **API token:** optional bearer token for hosted endpoints or authenticated local gateways.

Normalize the endpoint by removing trailing slashes and append `/chat/completions`. Validate the final URL before saving. Do not accept endpoint or token through query parameters because URLs leak through history, logs, and referrers.

Store the settings under one versioned `localStorage` key, for example:

```json
{
  "version": 1,
  "endpoint": "https://openrouter.ai/api/v1",
  "model": "provider/model",
  "apiToken": "optional-token"
}
```

Read and validate this value defensively. Invalid or obsolete settings should open the configuration UI instead of breaking application startup. Provide Save, Test Connection, and Clear Settings actions. Clearing settings must remove the token from storage and in-memory client state.

The token is necessarily visible to JavaScript running on the page and to anyone with access to that browser profile. The settings UI must state this clearly. `localStorage` is chosen for user convenience, not secret storage. The static deployment must avoid third-party scripts, use a restrictive Content Security Policy where the host supports it, and treat XSS prevention as credential protection. Recommend scoped, revocable, low-limit tokens and local endpoints. Never log, render, include in Mol* snapshots, or attach the token to requests sent anywhere except the configured endpoint.

Keep a narrow model boundary around the AI SDK language model so an in-browser implementation can be added later:

```ts
interface ChatModelFactory {
    create(settings: ChatProviderSettings): LanguageModel
}
```

The custom AI SDK chat transport builds the system prompt and generation request and uses AI SDK Core structured output (`generateText` with `Output.object`) with the `ChatResponseV1` JSON Schema. It then validates the returned object again with the local strict validator before exposing it to the executor. Structured output is an additional reliability layer, not a substitute for validation. To support smaller OpenAI-compatible runtimes, capability negotiation may fall back from strict schema mode to JSON mode, then to prompt-constrained JSON if the endpoint explicitly rejects the stronger mode. Cache the working mode per endpoint/model and show it in settings; never weaken local validation.

Start without streaming, tool-calling loops, automatic provider fallback, or an LLM framework. The operation is a single constrained translation from conversation plus Viewer context to `ChatResponseV1`; direct HTTP keeps that boundary visible and testable.

### Static Hosting And CORS

Build `src/apps/molstar-chat` as static assets under `build/molstar-chat`. Configure asset URLs and routing so the application works from a GitHub Pages project subpath such as `/molstar/`, not only from the origin root. No server route or runtime environment variables are required.

Direct provider access depends on provider CORS policy. The configured endpoint must allow the application's origin, the `POST` method, `Content-Type`, and `Authorization` when a token is used. The UI should recognize likely CORS/network failures and explain that the endpoint must enable browser access; it must not suggest disabling browser security. A local Ollama or compatible server may require explicit allowed-origin configuration.

GitHub Pages serves over HTTPS. Browsers will block an insecure remote HTTP endpoint as mixed content; only loopback HTTP should be presented as a development option, and browser behavior may still vary. Hosted endpoints should use HTTPS.

Document two example configurations:

- OpenRouter or another browser-enabled hosted OpenAI-compatible endpoint with a user-supplied, scoped token and model.
- Local Ollama or another local runtime with its OpenAI-compatible API and allowed origins configured, normally without a token.

### In-Browser Model Stretch Goal

Add a second `ChatModelFactory` implementation only after the remote-client path is stable. Prefer a browser inference runtime that exposes an AI SDK `LanguageModel` adapter, with WebGPU acceleration and WebAssembly fallback. Keep model download, caching, and inference behind the same AI SDK model boundary so the transport, validator, executor, and UI do not change.

The browser-model UI must disclose model size, expected download, storage use, hardware requirements, and likely performance before downloading. Require an explicit user action to download a model, show progress, allow cancellation, and use browser cache/storage where the runtime supports it. Never make a large model part of the normal application bundle.

Candidate small instruction models must be tested specifically for reliable Protocol V1 JSON generation. Browser inference is an optional privacy/offline mode, not a fallback that is downloaded automatically after a remote-provider error.

## Command Protocol V1

Define a discriminated TypeScript union and matching strict runtime validator. A response has a user-facing message and zero or more commands:

```ts
interface ChatResponseV1 {
    version: 1
    message: string
    commands: ChatCommandV1[]
}

type ChatCommandV1 =
    | { kind: 'load-pdb', id: string }
    | { kind: 'load-url', url: string, format: AllowedStructureFormat, isBinary?: boolean }
    | { kind: 'select', target: SelectionTargetV1, modifier?: 'set' | 'add' | 'remove' | 'intersect', focus?: boolean, highlight?: boolean }
    | { kind: 'clear-selection' }
    | { kind: 'clear-highlights' }
    | { kind: 'apply-preset', preset: AllowedPreset }
    | { kind: 'apply-color-theme', theme: AllowedColorTheme }
    | { kind: 'apply-appearance', appearance: 'default' | 'illustrative' }
    | { kind: 'reset-camera' }
    | { kind: 'undo' }

type SelectionTargetV1 =
    | { type: 'builtin', name: AllowedBuiltinSelection }
    | { type: 'elements', schema: StructureElementSchemaJson }
```

Initial allowlists should be deliberately small:

- Presets: `auto`, `polymer-and-ligand`, `polymer-cartoon`, `atomic-detail`, `illustrative`, `molecular-surface`.
- Color themes: `default`, `chain-id`, `entity-id`, `element-symbol`, `residue-name`, `secondary-structure`, `hydrophobicity`, `sequence-id`, `uniform`.
- Built-in selections: the stable concepts in `StructureSelectionQueries`, starting with `all`, `polymer`, `protein`, `nucleic`, `ligand`, `water`, `ion`, `helix`, `beta`, `backbone`, and `sidechain`.
- URL formats: formats explicitly supported by the Viewer loader, beginning with `mmcif`, `pdb`, `mol`, `sdf`, and `mol2`; verify names against the active `dataFormats` registry before execution.

Example model response:

```json
{
  "version": 1,
  "message": "Loaded 1TQN and highlighted residues 25-40 in chain A.",
  "commands": [
    { "kind": "load-pdb", "id": "1TQN" },
    {
      "kind": "select",
      "target": {
        "type": "elements",
        "schema": {
          "auth_asym_id": "A",
          "beg_auth_seq_id": 25,
          "end_auth_seq_id": 40
        }
      },
      "modifier": "set",
      "focus": true,
      "highlight": true
    }
  ]
}
```

Command results should also be structured internally:

```ts
interface ChatCommandResult {
    index: number
    kind: ChatCommandV1['kind']
    status: 'succeeded' | 'failed' | 'skipped'
    summary: string
    error?: string
}
```

Execute in array order because later commands commonly depend on earlier loads. Stop dependent commands after a load failure, but preserve prior successful operations and report partial completion accurately.

## Viewer Context Sent To The Model

Send only enough state to resolve references and avoid impossible actions:

- Loaded structure labels, entry IDs, and stable state refs.
- For each structure, model count and available author/label chain IDs.
- A bounded list of residue/component names, especially ligands.
- Current selection count and a short selection label.
- Current representation/preset summary where cheaply available.
- Supported command names and current allowlist values.

Cap list sizes and request bytes. Do not serialize coordinates, full state snapshots, asset URLs containing credentials, or arbitrary metadata. Mark Viewer context as untrusted data in the system prompt so structure labels cannot become instructions.

V1 can default commands to all currently selected structures, matching existing manager behavior. Add an optional validated `structureRef` to relevant commands once multi-structure ambiguity is tested; the model should ask a clarification question instead of guessing when multiple structures match a user reference.

## Safety And Reliability Rules

- Store the optional provider token only in the versioned chat settings entry in `localStorage`; never put it in URLs, logs, Mol* snapshots, error messages, analytics, or bundled source.
- Clearly disclose that browser storage is not secret storage and recommend scoped, revocable, low-limit tokens.
- Require HTTPS endpoints except for loopback development. Send `Authorization` only to the exact normalized origin and path configured by the user, with redirects disabled or rejected so credentials cannot cross origins.
- Enforce client-side message length, history length, response size, timeout, and model token limits. Provider-side limits remain the user's responsibility.
- Validate every model response in the browser even when the provider uses structured output.
- Reject unknown command kinds, properties, presets, themes, formats, and selection keys.
- Validate PDB IDs and normalize them to uppercase. Use the existing loader for provider URL construction.
- For `load-url`, allow only `https:` by default. Applications should configure an origin allowlist or require a visible confirmation for an untrusted origin to limit SSRF-like proxying, credential leakage, and unexpectedly large downloads.
- Put limits on schema item count and residue ranges. Reject non-finite numbers and pathological ranges before constructing a selection.
- Do not render raw model HTML. Reuse `Markdown`, which sets `skipHtml`.
- Abort the HTTP request on Cancel or component disposal. Do not start a second execution while commands are mutating state; either disable submit or queue requests explicitly.
- Use Mol* tasks and busy state for long operations. Convert thrown values to safe user-facing errors while retaining detail in `plugin.log.error`.
- Ask for confirmation before destructive commands such as clearing the entire plugin or replacing existing structures. Those commands are intentionally absent from v1.
- Treat an assistant message as proposed intent, not proof of execution. Append execution results after commands finish and phrase the final UI status from actual results.

## Implementation Steps

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

### 3. Add The AI SDK Provider, Transport, And Controller

Add compatible pinned versions of `ai`, `@ai-sdk/openai`, and `@ai-sdk/react`. Keep these versions aligned because the provider, `ChatTransport`, `UIMessage` parts, and React hook APIs evolve together. Verify their React peer requirements against this repository's React 18 build before implementation.

Create `src/extensions/chat/client.ts` around `createOpenAI` from `@ai-sdk/openai`. The factory uses the configured base URL and model's Chat Completions implementation explicitly:

```ts
const provider = createOpenAI({
    baseURL: settings.endpoint,
    apiKey: settings.apiToken || OptionalApiKeyPlaceholder,
    fetch: createGuardedFetch(settings),
})
const model = provider.chat(settings.model)
```

The guarded fetch must set `redirect: 'error'`, enforce the configured origin/path, cap response bytes, map browser/network failures, and remove the placeholder `Authorization` header when no token is configured. This preserves genuinely unauthenticated local endpoints even if the pinned `@ai-sdk/openai` version requires a non-empty `apiKey` at provider construction. Test this behavior against the exact pinned SDK version rather than relying on undocumented internals.

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

Use an AI SDK-compatible JSON Schema adapter backed by the same V1 schema used by local validation; do not maintain an unrelated hand-written schema. The transport emits the validated `message` as the assistant text part and the command envelope as a typed `data-molstar-command-response` part. Commands execute only after that complete data part passes the local strict validator. Treat provider errors, refusals, missing output, invalid objects, redirects, oversized responses, and timeouts as typed transport errors. Start without partial command streaming.

In `src/extensions/chat/ui.tsx`, use `useChat` from `@ai-sdk/react` with this transport for messages, `sendMessage`, `regenerate`, `stop`, error state, and request status. Keep text input state local because current `useChat` does not own it. Use the hook's data/finish callbacks to hand a validated command envelope to `ChatController` exactly once. Give each completed envelope a stable response ID and have the controller deduplicate it so React rerenders, retries, or repeated callbacks cannot execute commands twice.

Create `src/extensions/chat/controller.ts` to own Viewer context construction, sequential command execution, execution results, and disposal. It no longer duplicates conversation or transport state already owned by `useChat`; its RxJS state is limited to Mol* execution status/results needed outside the hook. Keep a bounded in-memory AI SDK message list and do not place it in Mol* snapshots by default because it may contain private user text.

Keep the model factory and transport injectable so embedders can supply another AI SDK model, tests can use AI SDK mock models without network access, and a browser-inference model can be added later.

### 4. Add The Reusable Chat Behavior And Dedicated App

Create `src/extensions/chat/behavior.ts` using `PluginBehavior.create`. Its parameters should include application policy rather than user credentials:

- The versioned `localStorage` key, with a collision-resistant default.
- Optional initial endpoint and model suggestions for first use; never an embedded token.
- An optional allowed-endpoint predicate for embedders that want to restrict provider origins.
- URL-origin policy and maximum context/history sizes.
- Whether confirmation is required for external structure URLs.

On `register`, create/store the controller and add the React `ChatControls` component from `src/extensions/chat/ui.tsx` to `ctx.customStructureControls` under a unique key. On `unregister`, unmounting the control must stop the AI SDK transport request; also abort pending command execution, dispose subjects/subscriptions, delete the control, and remove stored state.

Export the reusable browser feature from `src/extensions/chat/index.ts`. `src/extensions/chat` may depend on Mol* plugin and UI APIs, but it must not import from `src/apps/molstar-chat`.

Create `src/apps/molstar-chat` as a separate app following the build conventions of `src/apps/viewer`, with its own `index.ts`, `index.html`, `app.ts`, and `plugin-spec.ts`. Its plugin spec registers `PluginSpec.Behavior(ChatBehavior)` directly. On first use, the panel asks the user for endpoint, model, and optional token. The app may reuse Viewer presets, themes, and setup helpers, but it owns its defaults and must not require chat-specific changes in `src/apps/viewer`.

Add `molstar-chat` to the app list in `scripts/build.mjs`, producing `build/molstar-chat`. Ensure public asset paths are relative or accept a build-time base path so the output works from a GitHub Pages project subpath.

### 5. Build The Chat UI

Create the React panel in `src/extensions/chat/ui.tsx` as a `CollapsableControls` or `PluginUIComponent` using existing controls and theme variables. Keep it reusable: chat state comes from `useChat`, Mol* execution state comes from the controller/plugin context, and the component contains no application bootstrap or provider-specific request logic. The panel should contain:

- Scrollable transcript with user, assistant, execution-result, and error messages.
- Sanitized Markdown for assistant text.
- Multi-line input with Submit and Cancel.
- Enter to submit and Shift+Enter for a newline.
- Busy state tied to request/execution state and compatible with plugin task overlays.
- Per-command status summaries, including partial failure and zero-match selection.
- Retry for transport failures without automatically replaying already executed commands.
- Clear conversation, which does not clear molecular state.
- Provider settings for endpoint, model, and optional token, with masked token input and explicit Save, Test Connection, and Clear actions.
- A concise warning that the token is stored in this browser and can be read by scripts running on the same origin.
- Actionable compatibility errors for CORS, mixed content, authentication, unsupported chat-completions behavior, timeout, and malformed model output.
- A few first-use examples such as load, select/focus, and style.
- Accessible labels, keyboard focus, live status announcements, and disabled-state feedback.

Create `src/extensions/chat/style.scss` and import it from `src/apps/molstar-chat/index.ts`. Rely on Mol* CSS variables instead of fixed light-theme colors. Verify right-panel sizing in landscape, portrait, collapsed controls, and embedded mode. Keep the input reachable when the transcript grows.

### 6. Add Settings Persistence And Static Deployment

Create `src/extensions/chat/settings.ts` for strict parsing, normalization, and persistence of the versioned provider settings. Keep storage access behind a small interface so tests can use an in-memory implementation and embedders can replace `localStorage` if needed.

Settings behavior should:

- Trim and normalize endpoint and model values before saving.
- Require an `https:` endpoint except for `localhost`, `127.0.0.1`, and `[::1]` development endpoints.
- Reject endpoint URLs containing user info, query strings, or fragments.
- Save the endpoint, model, and optional token only after validation.
- Keep the token out of observable controller state exposed to transcript components; expose only whether a token is configured.
- Leave AI SDK telemetry disabled and do not pass provider request/response bodies to logging or analytics.
- Remove both persisted and in-memory values when the user clears settings.
- Handle unavailable or quota-exceeded storage without preventing temporary, in-memory use.

Add a GitHub Actions workflow or extend the existing static-site workflow to build `build/molstar-chat` and publish it to GitHub Pages. The deployment smoke test should load the application from a non-root base path and verify that chunks, CSS, workers, and Mol* assets resolve without a server rewrite.

The system prompt is bundled with the client. It should describe only Protocol V1 and the distinction between author and label residue numbering, mark Viewer context as untrusted, require clarification when identifiers are ambiguous, and prohibit claims that an operation succeeded. Success is determined only by the browser executor.

### 7. Test And Roll Out

Add pure Jest tests under `src/extensions/chat/_spec` for protocol validation, context truncation, result aggregation, cancellation boundaries, component/controller behavior, and command dependency behavior. Use a small executor adapter interface or injected operation functions so most command routing can be tested without WebGL.

Add provider, transport, hook integration, and settings tests under `src/extensions/chat/_spec` using the guarded mocked `fetch`, AI SDK mock models, and in-memory storage. Cover endpoint normalization, invalid storage, optional authorization, redirect rejection, AI SDK message conversion, typed data parts, exactly-once command execution, `useChat` cancellation/status behavior, structured-output capability fallback, response validation, timeout/cancellation, token redaction, CORS-like failures, clearing settings, and stable error mapping. No normal test should require a live model or API token.

Add a static-app smoke test that serves `build/molstar-chat` beneath a project-style subpath, loads it in a browser, configures a fake CORS-enabled OpenAI-compatible endpoint, and completes one validated command response.

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
4. Submit malformed provider JSON and verify no state mutation occurs.
5. Cancel during a slow request and during a multi-command sequence.
6. Exercise desktop, narrow/portrait, expanded, and embedded layouts.
7. Verify the token appears only in the `Authorization` header sent to the configured endpoint and in the expected `localStorage` entry, never in built assets, URLs, logs, transcript state, analytics, or snapshots.
8. Load the production build from a GitHub Pages-style subpath and verify all assets resolve.
9. Verify a CORS-blocked endpoint produces actionable setup guidance.

Run at minimum:

```bash
npm run lint
npm run jest -- src/extensions/chat
npm run build:lib
npm run build:apps
```

## Suggested File Changes

New files:

- `src/extensions/chat/protocol.ts`
- `src/extensions/chat/validation.ts`
- `src/extensions/chat/context.ts`
- `src/extensions/chat/executor.ts`
- `src/extensions/chat/client.ts`
- `src/extensions/chat/transport.ts`
- `src/extensions/chat/settings.ts`
- `src/extensions/chat/controller.ts`
- `src/extensions/chat/behavior.ts`
- `src/extensions/chat/ui.tsx`
- `src/extensions/chat/style.scss`
- `src/extensions/chat/index.ts`
- `src/extensions/chat/_spec/validation.spec.ts`
- `src/extensions/chat/_spec/executor.spec.ts`
- `src/extensions/chat/_spec/client.spec.ts`
- `src/extensions/chat/_spec/transport.spec.ts`
- `src/extensions/chat/_spec/settings.spec.ts`
- `src/extensions/chat/_spec/controller.spec.ts`
- `src/extensions/chat/_spec/ui.spec.ts`
- `src/apps/molstar-chat/index.ts`
- `src/apps/molstar-chat/index.html`
- `src/apps/molstar-chat/app.ts`
- `src/apps/molstar-chat/plugin-spec.ts`
- A GitHub Pages deployment workflow or job for the static `molstar-chat` application.

Likely modified files:

- `src/mol-plugin-ui/structure/quick-styles.tsx` plus a new non-UI helper so buttons and chat share style operations.
- `package.json` and `package-lock.json` to add compatible pinned `ai`, `@ai-sdk/openai`, and `@ai-sdk/react` dependencies.
- `scripts/build.mjs` to register the `molstar-chat` application build.
- Build configuration to support a non-root public base path for GitHub Pages.

Avoid changing `PluginUISpec`, the core layout, or `LeftPanelTabName` for the first release. Those changes are unnecessary for a collapsible right-side control and would broaden compatibility risk.

## Delivery Milestones

### Milestone 1: Deterministic Local Prototype

- Protocol, validator, context builder, and executor exist.
- A developer fixture can submit JSON commands without an LLM.
- Load, selection/focus, preset, color, appearance, camera reset, and undo work.
- Core validation and executor tests pass.

### Milestone 2: End-To-End Chat

- Behavior registration, AI SDK provider/transport, `useChat` integration, controller, and responsive chat UI exist.
- Users can configure an OpenAI-compatible endpoint, model, and optional token, and the validated settings persist in `localStorage`.
- The browser client works with at least one CORS-enabled hosted provider and one CORS-configured local runtime through the same OpenAI-compatible adapter.
- The static application is deployable on GitHub Pages and works from a project subpath without a chat backend.
- Cancellation, errors, partial results, and zero matches are visible and accurate.
- Token storage and browser-exposure risks are clearly disclosed, and tokens are never logged or included in URLs, transcript state, or Mol* snapshots.

### Milestone 3: Hardening And Expansion

- Multi-structure targeting and clarification are reliable.
- Confirmation policy covers untrusted URLs and any newly introduced destructive action.
- Telemetry records latency/error/command-kind aggregates only with host consent and without message content by default.
- Add new molecular commands one at a time with protocol, validation, executor, and tests updated together.

### Stretch Milestone: In-Browser Model

- A small tested instruction model can produce valid Protocol V1 responses through the same AI SDK `LanguageModel`/`ChatModelFactory` boundary.
- Model download is opt-in, cancellable, and reports size, progress, storage use, and hardware compatibility.
- After model assets are cached, chat can operate without a model endpoint or API token.
- Failure or unsupported hardware falls back to provider configuration without automatically downloading another model.

## Acceptance Criteria

- A user can perform the three requested categories: load a PDB structure, make/focus a selection, and apply common visual styles from natural-language chat.
- Invalid or hallucinated command output cannot call arbitrary plugin APIs or partially bypass validation.
- Every executed command has an observable success, failure, skipped, or zero-match result.
- Existing manual controls continue to work and share implementation with chat where behavior overlaps.
- Visual state mutations use Mol* transactions and are undoable where the underlying state system supports undo.
- Selection behavior clearly documents its separate undo/history semantics.
- The feature is optional and cleanly registered/unregistered through the plugin behavior lifecycle.
- The UI works in desktop and narrow layouts and uses existing Mol* visual conventions.
- Endpoint, model, and optional token can be configured and cleared in the browser; settings survive reloads through `localStorage`.
- Provider calls use `@ai-sdk/openai` with the Chat Completions model factory, and chat lifecycle/state use `useChat` from `@ai-sdk/react` without requiring an application backend.
- The UI warns that the token is browser-accessible, sends it only to the configured endpoint, and model output is rendered without raw HTML.
- CORS, HTTPS/mixed-content, authentication, timeout, and malformed-response failures are distinguishable and actionable.
- The built `molstar-chat` application runs as static files on GitHub Pages from a non-root project path.
- Lint, targeted Jest tests, library build, and the `molstar-chat` app build pass.
