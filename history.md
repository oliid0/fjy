# Fcdraw / ????

- Objective: brand the Android whiteboard; add bottom teaching controls, configurable AI/speech, mathematics/plots, recording/transcripts/summaries, LAN upload/PPTX preview, and Actions APK packaging.
- Evidence: React 19 + Vite 5 + Capacitor 8; existing element conversion/export and AI plugin interfaces. Initial source was staged by user; no commits or remote exist yet.
- Completed: inspected staged source, app/native configuration, existing tests, upstream speech/PPTX documentation; switched workspace configuration to requested pnpm.
- Remaining: implement features; run pnpm test/check/lint; push to specified repository and confirm Actions.
- Decisions: keep internal package/file-format identifiers for compatibility; replace visible branding and external promotion. Use existing canvas element API, Android speech service, local math engines, and native LAN receiver. No local build/dev/Cargo commands.
- Files: package.json, excalidraw-app/package.json, pnpm-workspace.yaml.
- Verification: pending dependency install and implementation.
