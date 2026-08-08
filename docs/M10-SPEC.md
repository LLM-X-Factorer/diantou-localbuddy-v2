# M10 · Dogfooding and Productization

## Product objective

Turn the proven local runtime into an internal daily-use product without weakening its source, credential, approval, or evidence boundaries.

## Local product scope

1. Desktop Provider setup
   - select DeepSeek/OpenAI, optional model and HTTPS/loopback base URL;
   - write an API key directly to the OS credential vault through Main, never Renderer storage;
   - never return, echo, log, checkpoint, or prefill an existing secret.
2. Run trust profile
   - `strict`, `balanced`, and `automation` become explicit persisted Run choices;
   - resume/replay reuse the original profile;
   - `automation` still denies external effects rather than silently approving them.
3. Integration review
   - Main reads only the registered, hash-verified combined patch;
   - Renderer receives bounded text only and presents an inline diff before approval;
   - no arbitrary file-read IPC is introduced.
4. Diagnostics export
   - produce a bounded JSON dossier from persisted Request, projected Run state, event counts, checkpoint/integration status, and registered artifact metadata;
   - redact goals, tool arguments, model content, browser form values, tokens, credentials, and raw artifact bodies;
   - user chooses the destination through a native save dialog.

## External gates

- GitHub repository owner must be explicitly selected before creating the private remote.
- Linux/Windows acceptance requires their native CI runners and generated artifacts.
- Production MCP OAuth requires a named real service and account.
- Formal Apple distribution remains deferred item 6.

## Acceptance

- contract, Main IPC, Preload and Renderer tests;
- credential values absent from IPC return values and diagnostics;
- tampered combined patch rejected before inline display;
- persisted trust profile survives history and checkpoint resume;
- `pnpm check`, packaged Desktop smoke, and a bounded internal dogfood matrix.
