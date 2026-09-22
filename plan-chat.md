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
- Keep all model-provider credentials outside the browser.

Deferred until the command boundary is stable:

- Measurements, superposition, density maps, animations, and structure editing.
- Arbitrary MolScript supplied by a model.
- Voice input, image input, and retrieval-augmented scientific answers.
- Autonomous multi-step loops that inspect a result and decide on more mutations.

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

Use schema-based selection for explicit chain/residue/atom requests and the built-in query registry for named concepts. Do not accept serialized MolScript expressions from the server in v1.

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
ChatController (conversation, cancellation, status)
    |
    +--> ChatClient --> application backend --> model provider
    |                        ^
    |                        | system prompt + JSON schema + context summary
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

- The backend owns provider credentials, model selection, rate limiting, request limits, and provider-specific tool/structured-output syntax.
- `ChatClient` only sends conversation plus a compact Viewer context and receives provider-neutral JSON.
- The validator treats every response as untrusted input, rejects unknown fields/commands, enforces lengths and numeric bounds, and normalizes identifiers.
- The executor contains all Mol*-specific mutation logic and never performs a command not represented by the local TypeScript union.
- The UI renders conversation/status and has no molecular-operation logic.

Keep the backend contract vendor-neutral. The repository can include an interface and documented HTTP contract without embedding an OpenAI, Anthropic, or other provider SDK in the Mol* bundle.

### Backend And Model Adapter Decision

Implement the reference backend in TypeScript on Node.js 22 using Express, matching the existing server stack in this repository. Put it under `src/servers/chat` and use the built-in `fetch` implementation rather than adding a provider SDK.

Use one `OpenAICompatibleChatProvider` adapter that calls the non-streaming `/chat/completions` API. The adapter takes its base URL, model, and optional API key only from server startup configuration. The browser request must never select a provider, base URL, or model.

Support these initial configurations:

- **OpenRouter (recommended hosted default):** base URL `https://openrouter.ai/api/v1`, API key required, and a server-configured model identifier. Request strict JSON Schema structured output and require a route that supports the requested parameters.
- **Ollama (recommended local development option):** base URL `http://127.0.0.1:11434/v1`, no API key, and an explicitly configured installed model. Use Ollama's OpenAI-compatible `response_format` support with the same JSON Schema.
- **Generic OpenAI-compatible endpoint:** an explicitly configured base URL, optional API key, and model. This covers other self-hosted runtimes without adding provider-specific code, provided they support chat completions and JSON Schema structured output.

Suggested server environment variables:

```text
MOLSTAR_CHAT_PROVIDER=openrouter|ollama|openai-compatible
MOLSTAR_CHAT_BASE_URL=https://openrouter.ai/api/v1
MOLSTAR_CHAT_MODEL=<provider model identifier>
MOLSTAR_CHAT_API_KEY=<server-side secret; omitted for Ollama>
MOLSTAR_CHAT_PORT=1340
```

For the convenience CLI, command-line options override corresponding non-secret environment values; secrets remain environment-only. A host-integrated server may use environment variables or its own typed configuration mechanism.

`MOLSTAR_CHAT_PROVIDER` selects a checked configuration preset; it is not supplied by the browser. For `openrouter`, ignore or reject a custom base URL so the API key cannot be sent to another host. For `ollama`, default to loopback and require an explicit server-side opt-in before connecting to a non-loopback address. For the generic preset, treat the configured endpoint as trusted deployment configuration and never derive it from a request.

Define a narrow internal interface so provider transport remains replaceable:

```ts
interface ChatModelProvider {
    complete(request: ChatModelRequest, signal: AbortSignal): Promise<unknown>
}
```

The route builds the system prompt and provider request itself, passes the `ChatResponseV1` JSON Schema as a strict structured-output constraint, parses the returned message content as JSON, and validates it with the same logical V1 validator used by the browser. Structured output is an additional reliability layer, not a substitute for validation.

Start without streaming, tool-calling loops, automatic provider fallback, or an LLM framework. The operation is a single constrained translation from conversation plus Viewer context to `ChatResponseV1`; direct HTTP keeps that boundary visible and testable. Add a second provider implementation only if a provider cannot conform to the OpenAI-compatible structured-output contract.

### Local CLI And Distribution Decision

Publish a separate npm package named `molstar-chat` with a `molstar-chat` executable. This is required for the intended zero-install command to resolve by package name:

```bash
pnpx molstar-chat
```

Also document the equivalent `pnpm dlx molstar-chat` and `npx molstar-chat` commands. Adding only a `molstar-chat` bin entry to the existing `molstar` package would instead require users to name or install the `molstar` package, so it does not satisfy this entry-point requirement.

The package is a thin local application distribution containing:

- The compiled Node chat server and CLI.
- A production build of the `src/apps/molstar-chat` application with its endpoint fixed to the same-origin `/api/molstar/chat` route.
- The static assets needed to run without cloning this repository or installing a separate web server.

On startup, the executable should:

1. Parse and validate CLI options and environment configuration.
2. Resolve the provider and model as described below.
3. Bind the combined static-file and chat API server to `127.0.0.1` by default.
4. Select the requested port, or an available local port when the default is occupied.
5. Print the local URL and open it in the default browser after the server is listening.
6. Keep running until interrupted, then close the HTTP server and abort outstanding model requests cleanly.

The zero-argument `pnpx molstar-chat` path targets local Ollama. It probes the loopback Ollama service and discovers installed models. If exactly one model is installed, use it; if several are installed and stdin is interactive, ask the user to choose; if none are installed, Ollama is unavailable, or the process is non-interactive with an ambiguous choice, exit with a concise command showing how to resolve the problem. Do not automatically download a model because model downloads are large and hardware-dependent.

Hosted OpenRouter usage is explicit:

```bash
MOLSTAR_CHAT_API_KEY=<key> pnpx molstar-chat \
    --provider openrouter \
    --model <provider/model>
```

Do not accept an API key as a command-line option because command arguments may be retained in shell history or exposed through process inspection. Read it from `MOLSTAR_CHAT_API_KEY` or a host application's secret mechanism. The CLI may accept non-secret options including:

```text
--provider ollama|openrouter|openai-compatible
--model <identifier>
--base-url <url>             # generic provider only
--host <address>             # default: 127.0.0.1
--port <number>              # default: 1340, then choose a free port
--no-open
--allow-network-access       # required with a non-loopback --host
```

Require an explicit acknowledgement option when `--host` is not loopback because that exposes the unauthenticated local application to the network. The general production deployment remains a host-integrated backend with authentication; the convenience CLI is a single-user local application, not a production multi-user server.

Build and publish `molstar-chat` separately from the existing `molstar` npm package, while keeping its sources and tests in this repository. The release artifact must include the compiled `src/apps/molstar-chat` assets; it must not compile Mol* or download frontend code at first launch. Keep the package version aligned with the Mol* version it embeds and test the packed tarball before publication.

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

Example server response:

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

## Viewer Context Sent To The Backend

Send only enough state to resolve references and avoid impossible actions:

- Loaded structure labels, entry IDs, and stable state refs.
- For each structure, model count and available author/label chain IDs.
- A bounded list of residue/component names, especially ligands.
- Current selection count and a short selection label.
- Current representation/preset summary where cheaply available.
- Supported command names and current allowlist values.

Cap list sizes and request bytes. Do not serialize coordinates, full state snapshots, asset URLs containing credentials, or arbitrary metadata. Mark Viewer context as untrusted data in the backend system prompt so structure labels cannot become instructions.

V1 can default commands to all currently selected structures, matching existing manager behavior. Add an optional validated `structureRef` to relevant commands once multi-structure ambiguity is tested; the model should ask a clarification question instead of guessing when multiple structures match a user reference.

## Safety And Reliability Rules

- Never expose model-provider API keys in Viewer options, browser storage, query parameters, or bundled source.
- Require HTTPS outside local development and apply normal server authentication/CSRF policy at the application backend.
- Enforce server-side rate limits, message length, history length, response size, timeout, and model token limits.
- Validate model output again in the browser even if the backend uses structured output.
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

### 3. Add A Vendor-Neutral Client And Controller

Create `src/extensions/chat/client.ts` with a small injectable interface and a default HTTP implementation. Suggested endpoint contract:

```http
POST /api/molstar/chat
Content-Type: application/json

{ "version": 1, "messages": [...], "context": {...} }
```

The response is `ChatResponseV1`. Start with a normal JSON response; add SSE streaming only when needed. Commands should not execute until the complete response validates. If text streaming is later added, stream display text separately from the final structured command envelope.

Create `src/extensions/chat/controller.ts` to own messages, pending state, `AbortController`, context construction, validation, sequential execution, and an RxJS `BehaviorSubject` consumed by the UI. Keep a bounded in-memory conversation. Do not place chat history in Mol* snapshots by default because it may contain private user text; persistence should be an explicit application option.

Make the client injectable so embedders can use their own authenticated transport and tests can use fixtures without network access.

### 4. Add The Reusable Chat Behavior And Dedicated App

Create `src/extensions/chat/behavior.ts` using `PluginBehavior.create`. Its parameters should include only non-secret browser configuration such as:

- `endpoint` with a same-origin default such as `/api/molstar/chat`.
- Optional request headers supplied at runtime by the host application, not static API secrets.
- URL-origin policy and maximum context/history sizes.
- Whether confirmation is required for external structure URLs.

On `register`, create/store the controller and add the React `ChatControls` component from `src/extensions/chat/ui.tsx` to `ctx.customStructureControls` under a unique key. On `unregister`, abort pending work, dispose subjects/subscriptions, delete the control, and remove stored state.

Export the reusable browser feature from `src/extensions/chat/index.ts`. `src/extensions/chat` may depend on Mol* plugin and UI APIs, but it must not import from `src/apps/molstar-chat`, `src/servers/chat`, or the CLI.

Create `src/apps/molstar-chat` as a separate app following the build conventions of `src/apps/viewer`, with its own `index.ts`, `index.html`, `app.ts`, and `plugin-spec.ts`. Its plugin spec registers `PluginSpec.Behavior(ChatBehavior)` directly and enables the panel with the same-origin `/api/molstar/chat` endpoint. The app may reuse Viewer presets, themes, and setup helpers, but it owns its defaults and must not require chat-specific changes in `src/apps/viewer`.

Add `molstar-chat` to the app list in `scripts/build.mjs`, producing `build/molstar-chat`. Do not put provider selection, model selection, base URLs, or API keys in browser options; those remain server startup configuration.

### 5. Build The Chat UI

Create the React panel in `src/extensions/chat/ui.tsx` as a `CollapsableControls` or `PluginUIComponent` using existing controls and theme variables. Keep it reusable: it receives state through the controller/plugin context and contains no application bootstrap or provider-specific logic. The panel should contain:

- Scrollable transcript with user, assistant, execution-result, and error messages.
- Sanitized Markdown for assistant text.
- Multi-line input with Submit and Cancel.
- Enter to submit and Shift+Enter for a newline.
- Busy state tied to request/execution state and compatible with plugin task overlays.
- Per-command status summaries, including partial failure and zero-match selection.
- Retry for transport failures without automatically replaying already executed commands.
- Clear conversation, which does not clear molecular state.
- A few first-use examples such as load, select/focus, and style.
- Accessible labels, keyboard focus, live status announcements, and disabled-state feedback.

Create `src/extensions/chat/style.scss` and import it from `src/apps/molstar-chat/index.ts`. Rely on Mol* CSS variables instead of fixed light-theme colors. Verify right-panel sizing in landscape, portrait, collapsed controls, and embedded mode. Keep the input reachable when the transcript grows.

### 6. Add The Node Backend And OpenAI-Compatible Adapter

The production host needs a backend route because Mol* cannot safely own a model-provider secret. Add the reference Express server under `src/servers/chat`; keep it independent from the Viewer bundle so production hosts can mount the route in an existing authenticated application instead.

The route should:

- Authenticate the user according to the host application.
- Validate the inbound request and discard unsupported context fields.
- Apply rate, size, timeout, and concurrency limits.
- Supply a system prompt describing only Protocol V1 and the distinction between author and label residue numbering.
- Use the provider's structured-output/tool API when available.
- Validate the provider response against the same logical schema before returning it.
- Return provider-neutral error codes and never return secrets or raw provider diagnostics.

The reference implementation should additionally:

- Construct the `OpenAICompatibleChatProvider` from resolved startup configuration and fail fast on missing or inconsistent values.
- Fix the provider, base URL, and model for the process; do not accept any of them from the browser request.
- Send one non-streaming chat-completions request with the strict `ChatResponseV1` JSON Schema and a low temperature where supported.
- For OpenRouter, send the bearer API key and require provider routing that supports the structured-output parameters. Optional attribution headers may be configured server-side.
- For Ollama, use the loopback OpenAI-compatible endpoint and document that Ollama must be running on the same machine as this backend, not merely on the machine running a remote user's browser.
- Propagate cancellation and enforce a server-side timeout with `AbortSignal`.
- Map authentication, rate-limit, timeout, malformed-output, and upstream failures to stable application error codes.
- Expose a readiness check that reports configuration and upstream availability without revealing the model API key or raw diagnostics.

Add a `chat-server` package script for the compiled server and document one OpenRouter and one Ollama launch example. Do not ship a default model identifier: models available through hosted and local providers change independently of Mol*, so deployment must choose and test one that supports the schema.

The prompt should require clarification when identifiers are ambiguous and prohibit claims that an operation succeeded. Success is determined only by the browser executor.

### 7. Test And Roll Out

Add pure Jest tests under `src/extensions/chat/_spec` for protocol validation, context truncation, result aggregation, cancellation boundaries, component/controller behavior, and command dependency behavior. Use a small executor adapter interface or injected operation functions so most command routing can be tested without WebGL.

Add server tests under `src/servers/chat/_spec` using mocked `fetch` for configuration validation, OpenRouter and Ollama request mapping, structured response parsing, timeout/cancellation, secret redaction, and stable error mapping. No normal test should require a live model or API key.

Add CLI tests for zero-argument Ollama discovery, interactive and non-interactive model selection, occupied-port fallback, `--no-open`, loopback binding, clean shutdown, missing secrets, and rejection of unsafe network exposure. Add a package smoke test that installs the packed `molstar-chat` tarball in a temporary directory, launches it against a fake OpenAI-compatible server, loads the `molstar-chat` app, and verifies that `/api/molstar/chat` is same-origin.

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
4. Submit malformed server JSON and verify no state mutation occurs.
5. Cancel during a slow request and during a multi-command sequence.
6. Exercise desktop, narrow/portrait, expanded, and embedded layouts.
7. Verify no credential appears in built assets, network request bodies, URLs, logs, or snapshots.

Run at minimum:

```bash
npm run lint
npm run jest -- src/extensions/chat src/servers/chat src/cli/molstar-chat
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
- `src/extensions/chat/controller.ts`
- `src/extensions/chat/behavior.ts`
- `src/extensions/chat/ui.tsx`
- `src/extensions/chat/style.scss`
- `src/extensions/chat/index.ts`
- `src/extensions/chat/_spec/validation.spec.ts`
- `src/extensions/chat/_spec/executor.spec.ts`
- `src/extensions/chat/_spec/controller.spec.ts`
- `src/extensions/chat/_spec/ui.spec.ts`
- `src/apps/molstar-chat/index.ts`
- `src/apps/molstar-chat/index.html`
- `src/apps/molstar-chat/app.ts`
- `src/apps/molstar-chat/plugin-spec.ts`
- `src/servers/chat/config.ts`
- `src/servers/chat/provider.ts`
- `src/servers/chat/server.ts`
- `src/servers/chat/_spec/provider.spec.ts`
- `src/servers/chat/_spec/server.spec.ts`
- `src/cli/molstar-chat/index.ts`
- `src/cli/molstar-chat/_spec/index.spec.ts`
- A packaging manifest and README for the separately published `molstar-chat` npm artifact.

Likely modified files:

- `src/mol-plugin-ui/structure/quick-styles.tsx` plus a new non-UI helper so buttons and chat share style operations.
- `package.json` to add the compiled `chat-server` entry point and script.
- `scripts/build.mjs` to register the `molstar-chat` application build.
- Build/release scripts to assemble and smoke-test the npm package with the compiled server and `build/molstar-chat` assets.

Avoid changing `PluginUISpec`, the core layout, or `LeftPanelTabName` for the first release. Those changes are unnecessary for a collapsible right-side control and would broaden compatibility risk.

## Delivery Milestones

### Milestone 1: Deterministic Local Prototype

- Protocol, validator, context builder, and executor exist.
- A developer fixture can submit JSON commands without an LLM.
- Load, selection/focus, preset, color, appearance, camera reset, and undo work.
- Core validation and executor tests pass.

### Milestone 2: End-To-End Chat

- Behavior registration, controller, HTTP client, and responsive chat UI exist.
- A host-provided backend returns valid Protocol V1 responses.
- The reference backend runs against either OpenRouter or a local Ollama instance through the same OpenAI-compatible adapter.
- `pnpx molstar-chat` starts the local server, discovers a usable Ollama model, and opens the built `src/apps/molstar-chat` application without requiring a repository checkout.
- Cancellation, errors, partial results, and zero matches are visible and accurate.
- No provider secret enters the browser.

### Milestone 3: Hardening And Expansion

- Multi-structure targeting and clarification are reliable.
- Confirmation policy covers untrusted URLs and any newly introduced destructive action.
- Telemetry records latency/error/command-kind aggregates only with host consent and without message content by default.
- Add new molecular commands one at a time with protocol, validation, executor, and tests updated together.

## Acceptance Criteria

- A user can perform the three requested categories: load a PDB structure, make/focus a selection, and apply common visual styles from natural-language chat.
- Invalid or hallucinated command output cannot call arbitrary plugin APIs or partially bypass validation.
- Every executed command has an observable success, failure, skipped, or zero-match result.
- Existing manual controls continue to work and share implementation with chat where behavior overlaps.
- Visual state mutations use Mol* transactions and are undoable where the underlying state system supports undo.
- Selection behavior clearly documents its separate undo/history semantics.
- The feature is optional and cleanly registered/unregistered through the plugin behavior lifecycle.
- The UI works in desktop and narrow layouts and uses existing Mol* visual conventions.
- Provider credentials remain server-side, model output is rendered without raw HTML, and external URLs are policy-checked.
- The published `molstar-chat` package supports `pnpx molstar-chat`, `pnpm dlx molstar-chat`, and `npx molstar-chat`; it serves bundled assets and opens the browser from a loopback-only server by default.
- Lint, targeted Jest tests, library build, and the `molstar-chat` app build pass.
