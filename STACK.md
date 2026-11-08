# Stack (verify every pin with `npm view <pkg> version` before locking; versions below were checked on 2026-11-08)

| Layer | Choice | Notes |
|---|---|---|
| Desktop shell | **Electron 45.x** (45.2.3 stable at check; Node 24.22.2, Chromium 156) | Electron supports the 3 newest majors; majors ship about every 8 weeks. Stay on newest stable; upgrade within two weeks of each release. Use `utilityProcess` for the kernel host |
| Runtime | **Node 24 LTS** (matches Electron 45). Plan Node 26 when Electron adopts it | Dev and CI on the same major as Electron's bundled Node |
| Language | **TypeScript 7.0.x** native compiler (`tsc` = Go port) for typecheck | `typescript-eslint` type-aware rules lag until 7.1, so lint with **Biome**; keep `typescript@6` installed only if a tool needs the JS API |
| Tests | **Vitest 5.1**, **fast-check 4.10**, Playwright (Electron) for end to end | Property tests for invariants; fuzz for parsers |
| Lint/format | **Biome 2.6** (`biome lint`), custom `scripts/slop-scan.mjs` | Add dependency-cruiser, knip, Semgrep, gitleaks, OSV, CycloneDX |
| Validation | **Zod 4.6** | Every boundary |
| Crypto | `node:crypto` (Ed25519, SHA-256, AES-256-GCM or XChaCha20 via audited lib if needed) | No custom primitives; keys wrapped by OS keychain |
| Storage | `node:sqlite` behind a `Storage` interface; FTS5 verified working (SQLite 3.53.4 in Node 22 test env) | `node:sqlite` is release-candidate in Node 24.15+. Pin to a Node/Electron build that carries the SQLite WAL-reset fix and check `sqlite_version()` at startup. **Encryption at rest is a release gate**: swap in a SQLCipher-class adapter |
| Sandbox | `@anthropic-ai/sandbox-runtime` behind `IsolationBackend` | Seatbelt (macOS), bubblewrap (Linux), Windows is alpha and needs one-time elevation. Reads default to allowed-with-deny list, so configure explicit `denyRead`. Fallback: container backend. Never fall back to the host |
| MCP | `@modelcontextprotocol/client` v2 (spec 2026-07-28) | Per-Space allow-list, manifest digest pinning |
| Models | OpenAI-compatible endpoint adapter (Ollama, llama.cpp server, cloud) | Verify each install's base URL and tool-call behavior |
| UI | React 19, electron-vite (Vite), Tailwind v4, shadcn/ui primitives on Base UI or Radix, cmdk, Motion, Phosphor Icons (Regular), Shiki, Monaco diff editor, xterm.js + node-pty, TanStack Virtual and Router, Zustand | Pin exact versions at install. `node-pty` needs rebuild per Electron version |
| Fonts | IBM Plex Sans 5.3.0, JetBrains Mono 5.3.0, Source Serif 4 5.3.1, Newsreader 5.3.0, Instrument Serif 5.3.0 (all OFL-1.1), vendored as woff2 under `apps/desktop/src/renderer/fonts` | No Inter, no CDN. Digests pinned in `fonts/MANIFEST.json`, re-fetch with `npm run fonts:vendor` |
| Web pipeline | `@mozilla/readability`, `turndown`, `linkedom` or `jsdom`, DOMPurify | Verify package names and versions at install |
| Camofox | `camofox-browser` REST server over Camoufox | Pin commit and binary digest; localhost + API key; telemetry off; about 300MB first-run download, so bundle and verify |
| Documents | Firecrawl AnyDoc | Verify repo, license, and CLI/Node API at a pinned commit before use |
| Packaging | electron-builder, `@electron/fuses`, code signing and notarization | Signed auto-update with rollback |

Not used: Rust, Python, Hermes or any agent framework in V1 (see ADR 1 and 2 in AGENTS.md); Rive (cut from V1); paid search APIs by default.
