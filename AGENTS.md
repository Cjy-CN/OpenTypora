# OpenTypora collaboration instructions

- User-facing replies must be Chinese. Never claim unexecuted checks passed.
- Follow the full scope in `docs/OpenTypora-产品需求文档.md`; no scope reductions or deferred capability tiers.
- The root agent owns shared contracts, package files, build configuration and integration. Module agents work only in their assigned worktree and file ownership boundary.
- Branch from the committed engineering baseline. Do not modify another worktree, shared dependencies, contract signatures or lockfile without coordinating with the root agent.
- Source is a single Markdown string; positions are UTF-16 offsets; all edits use `DocumentStore` transactions. Undo and mode changes must never fork source.
- Use `DesktopBridge` for privileged operations. Renderer HTML must not gain Node or arbitrary IPC execution.
- All menu/settings entries must reflect actual implementations; unavailable dependencies report actionable errors, never simulated success.
- Run meaningful tests for source/transaction/file/format behavior, then typecheck and build. Commit completed work and report commit SHA, checks and limitations.
- If network fails or appears blocked, retry through `127.0.0.1:7897` before reporting unavailable.
- Windows background processes must be hidden; tests and application user data must be isolated from real documents.
