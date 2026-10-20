# Task 9 Report: DataSyncProvider 与自动同步开关

## What I implemented

- Added `DataSyncProvider` and `useDataSync()` in `src/sync/DataSyncContext.tsx`, exposing config, status, summary, errors, pending count, backend warning, and sync/config actions.
- Kept manual `syncNow()` independent of `autoSync`, while gating startup, online, visibility, and dirty-event scheduling through `shouldAutoSync`.
- Added 10-second trailing / 60-second maximum dirty scheduling, 1-second debounced pending-count refresh, online/offline status handling, and per-repository outbox counting with DB cleanup.
- Config saves enable sync and reset cursors only when the backend/endpoint/token fingerprint changes; auto-sync toggles preserve cursors. Clear resets config, state, timers, and provider state.
- Wrapped the router in `DataSyncProvider` and registered the Neon backend from `src/App.tsx`.
- Added `shouldAutoSync` coverage and a provider-level test for manual sync with auto-sync disabled.

## Tests run and results

- `npm run typecheck` — PASS.
- `npx vitest run tests/unit/sync-config-state.test.ts tests/unit/data-sync-context.test.tsx` — PASS, 2 files / 8 tests.
- `npm test` — PASS, 48 files / 372 tests.
- `git diff --check` — PASS.

## TDD RED/GREEN evidence

- Added the explicit disabled-config `shouldAutoSync` assertion and provider manual-sync test. Both passed in focused verification.
- No RED run was recorded before implementation; the assigned behavior and engine APIs were inspected before coding.

## Files changed

- `src/sync/DataSyncContext.tsx` (new)
- `src/App.tsx`
- `tests/unit/sync-config-state.test.ts`
- `tests/unit/data-sync-context.test.tsx` (new)
- `.superpowers/sdd/2026-10-20-md-reader-data-sync-implementation/task-9-report.md` (this report)

## Self-review findings

- Manual sync checks enabled/configured/online state but never checks `autoSync`.
- Automatic scheduling uses `shouldAutoSync` at each trigger; visibility-hidden sync is immediate only in auto mode.
- A potential online-event stale-closure/timer race was found during review and fixed by scheduling on the online state transition.
- Pending-count refresh closes each opened DB in `finally` and continues after an individual DB failure.
- No new dependencies were added; no remaining issues found.

## Concerns

- The initial implementation lacked provider-level auto-trigger timer coverage; this was resolved by the review fixes below.

## Task 9 review fixes

### Changes

- Moved the debounced `schedulePendingRefresh()` call to the start of every `mdreader:sync-dirty` handler. The `shouldAutoSync` gate now controls only sync scheduling; pending-count refresh happens in both auto and manual modes.
- Expanded `tests/unit/data-sync-context.test.tsx` with fake-timer coverage for 10-second trailing and 60-second max-wait dirty sync, 1-second pending refresh, startup/online/visibility gates, cursor-reset fingerprint behavior, auto-sync cursor preservation, and clear-state/timer cleanup.
- Added shared mount/unmount helpers and `afterEach` `try/finally` cleanup for roots, timers, global stubs, online state, and visibility state.

### TDD evidence

- RED: before moving the pending refresh ahead of the gate, the new auto-mode dirty test failed: after 1 second `loadRepoState` had not been called.
- GREEN: after the change, all 12 focused provider tests passed.

### Verification

- `npm run typecheck` — PASS.
- `npx vitest run tests/unit/data-sync-context.test.tsx` — PASS, 1 file / 12 tests.
- `npm test` — PASS, 48 files / 383 tests.
- `git diff --check` — PASS.

### Review

- Both open findings are addressed; no unrelated production behavior changed.
