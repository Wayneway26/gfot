# Third-party notices

- Electron 44.9.0 — MIT. https://github.com/electron/electron . The packaged Electron framework includes its applicable notices and Chromium licenses.
- OpenCode 1.19.3 (`opencode-ai`, `opencode-darwin-arm64`) — MIT. https://github.com/anomalyco/opencode . The OpenCode npm package's license is included below in desktop/assets/OPENCODE-LICENSE.
- electron-builder 26.15.3 — MIT, build-time only. https://github.com/electron-userland/electron-builder .

CC Switch (MIT, copyright Jason Young) is a design/reference integration; its source modules are not copied into gfot. This h2 branch vendors the unmodified Harness² method core, configuration and substrate schemas (Google LLC, Apache-2.0). The exact commit and per-file hashes are recorded in desktop/vendor/harness2/UPSTREAM.json; its license is included alongside the sources. The Python runner and gfot/OpenCode adapters are gfot code. Benchmark launchers, datasets and third-party benchmark dependencies are not included. Their names do not imply endorsement.

- doubao-cli 0.20.0 — MIT, copyright Fullstop000. https://github.com/Fullstop000/doubao-cli . The desktop automation import closure is vendored at `desktop/vendor/doubao-cli`; its original LICENSE is included. `UPSTREAM.json` records the exact revision, original hashes, shipped hashes and the small receipt-callback patch. Only the desktop CDP transport is used; upstream headless login and credential import are not exposed by gfot. Doubao is a separate application and is not redistributed.

- DeepSeek Harness (`@deepseek-ai/dsh`) 0.2.1-rc.2 — MIT, copyright DeepSeek. https://github.com/deepseek-ai/deepseek-harness . The exact npm dependency closure and integrity hashes are pinned in `desktop/runtime/dsh/package-lock.json`. Its runtime packages and applicable individual LICENSE / THIRD_PARTY_NOTICES files ship in the desktop resources. gfot's stdio adapter and host interaction plugin are gfot code.
- Node.js 26.4.0 macOS arm64 — Node.js license and third-party notices are shipped at `dsh/node/LICENSE`. The official nodejs.org archive checksum is pinned in `scripts/prepare-dsh-runtime.mjs`; runtime provenance includes the archive and binary hashes.
