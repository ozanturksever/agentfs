# Fork Features & Merge Guide

Delta between this fork (`ozanturksever/agentfs`) and upstream (`tursodatabase/agentfs`).

Net effect: +2,619 / −374 lines vs upstream. Upstream baseline: `a0bcdf9` (upstream/main, AgentFS 0.6.2, 2026-02-23). Last merged: 2026-02-23.

---

## How to Read This Document

Each section is tagged with a **merge policy**:

- 🔒 **KEEP** — Core to the fork's purpose. Must survive upstream merges. Resolve conflicts in favor of the fork.
- 🔀 **PREFER UPSTREAM** — Adopt upstream's version on next merge. Fork changes here were tactical or temporary.
- ⚖️ **NEGOTIATE** — Fork has meaningful changes but upstream may too. Manually reconcile on merge; pick the better implementation.
- ✅ **RESOLVED** — Previously divergent; now aligned with upstream.

---

## 1. OOSS Integration Module 🔒 KEEP

The entire `sdk/typescript/src/integrations/ooss/` directory is new — ~1,900+ lines. It wires AgentFS into the OOSS (OS-022) sandboxing platform:

| Component | Purpose |
|---|---|
| `types.ts` | Core types: `OOSSMetadata`, `AccessHookContext`, `OverlayConfig`, `ConvexStreamConfig`, `PermissionDeniedError` |
| `permission-hooks.ts` | `PermissionHooks` class with cached metadata, pattern-based access control, deny-takes-precedence logic |
| `protected-fs.ts` | `ProtectedFileSystem` — wraps `FileSystem` interface, enforces permission hooks on every operation including `FileHandle` |
| `metadata.ts` | KV store helpers for OOSS metadata: `setOOSSMetadata`, `getOOSSMetadata`, `updateOOSSMetadata`, individual field accessors |
| `convex-streamer.ts` | Real-time toolcall streaming to Convex via `ConvexToolcallStreamer` (polling) and `ConvexToolcallsWrapper` (intercept) |
| `overlay.ts` | Git overlay: `initializeOverlay`, `getOverlayChanges`, `exportOverlayAsPatch`, `resetOverlay` |
| `index.ts` | Barrel re-exports for the full module |

Test coverage: `sdk/typescript/tests/ooss-integration.test.ts` (315 lines).

**Merge notes**: Entirely additive. No upstream equivalent exists. Conflicts only arise if upstream restructures `sdk/typescript/src/` exports or the `FileSystem` / `KvStore` / `ToolCalls` interfaces.

## 2. SDK Republished Under @fatagnus Scope 🔒 KEEP

- `sdk/typescript/package.json`: name changed from `agentfs-sdk` → `@fatagnus/agentfs-sdk`.
- Version bumped to `0.7.2` (upstream is `0.6.2`).

**Merge notes**: On merge, keep the scoped name and fork version. Do not accept upstream's `agentfs-sdk` name or version — the fork publishes independently to npm.

## 3. Release Infrastructure Overhaul 🔒 KEEP

The upstream release system (cargo-dist based) was replaced with a simpler direct approach:

| Change | Detail |
|---|---|
| `.github/workflows/release.yml` | Rewritten from ~379 lines (cargo-dist auto-generated) to ~109 lines. Supports `workflow_dispatch` with manual tag input. Builds macOS ARM64 + Linux (x86_64, aarch64). |
| `dist-workspace.toml` | Deleted — cargo-dist config no longer needed. |
| `scripts/release-local.sh` | New — local release script: builds binary, creates GitHub release, publishes npm with OTP. |
| `scripts/release.sh` | New — simplified release helper. |

**Merge notes**: Entirely replaces upstream CI. If upstream improves their release workflow, evaluate but likely keep fork's simpler version. The local release script references a machine-specific TOTP path — this is intentional for the fork maintainer's workflow.

## 4. Custom Install Script 🔒 KEEP

- New `install.sh` — `curl | sh` installer that fetches from `ozanturksever/agentfs` releases. Supports `AGENTFS_INSTALL_DIR` override, macOS ARM64, Linux x86_64/aarch64.
- `README.md` and `MANUAL.md` updated to point at the fork's install URL.

**Merge notes**: Additive file. Doc changes will conflict with upstream's install instructions — resolve in favor of the fork.

## 5. ~~Version Pinning (Rust/Python SDKs)~~ ✅ RESOLVED

Resolved in merge `96cd6fc` (2026-02-23). Accepted upstream's 0.6.2 version bumps for all Rust/Python packages (`cli`, `sandbox`, `sdk/rust`, `sdk/python`). Fork and upstream now agree on 0.6.2 for these packages.

---

## Merge Checklist

Before merging upstream:

1. **Identify upstream baseline**: compare against the commit noted above (`a0bcdf9`).
2. **KEEP items**: re-apply or conflict-resolve in favor of the fork.
3. **PREFER UPSTREAM items**: accept upstream's version; drop fork-only changes.
4. **NEGOTIATE items**: diff both versions, pick the better one, document the choice.
5. **Test OOSS integration** end-to-end after merge — it touches SDK types, filesystem interfaces, and KV store.
6. **Verify npm publish**: ensure `@fatagnus/agentfs-sdk` builds and publishes correctly with updated version.
7. **Run full validation**: `cd sdk/typescript && npm test` and verify CLI builds with `cd cli && cargo build`.
