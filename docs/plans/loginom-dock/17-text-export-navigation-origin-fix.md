# Node17 — navigation/origin harness correction

Assignment: `node17:observer-navigation-origin-fix:1:e74d14d2`.
Scope: acceptance harness only; handler source remains `2524921058b29db0e79e9a188ec7bb8fa9ef9d8c` and runtime remains `347615cbae29323d80b57488b794ecce607b5b9e0d2fbe86aa88b7460241311c`.

## Checkpoint before the authorized new smoke

The previous run `20260913-142510-94897ed4` remains historical INCOMPLETE:
zero observer downloads, zero actual replace dispatches; the original auditor
KeyError remains in its immutable raw/audit evidence. A separate read-only
reanalysis of its original 124-byte baseline now passes the corrected auditor;
this does not promote the old smoke to PASS.

After one navigation gesture, the observer resamples fresh roots/root observations
with a 250 ms pause between incomplete samples. It retains the original absolute
observer/overall deadline (at most 60 seconds), checks cancellation on both sides
of awaited operations, and never retries the gesture. Observations must retain
origin/build, UI document epoch and exact tab/prefix owner. A folder transition
allows only the observed old `/` and requested `/test-2`; unknown paths/owners,
dialogs and document changes fail closed. Workflow return waits for the original
owner before the single final graph read. The finite ledger cap is 512 read/action
entries; the time limit remains the controlling bound. Rows also retain the
observed Files owner. No configure/execute/save actions enter the observer.

The byte auditor and outer binder derive origin from browser observations linked
through `prepared_node_context` to the same prepared graph document/workflow/node.
They bind session, runtime and the actual profile/build/platform/browser from the
journal. They distinguish the browser epoch from the prepared graph document ID,
reject conflicting origins and missing native origin, and never substitute a
requested URL or mutate raw evidence. Current actual result profile is diagnostic;
a successful operator smoke cannot establish native user-v1 acceptance.

Focused checks: 19 Node tests and 16 Python tests passed, including delayed folder
settling with one gesture, deadline/cancellation, foreign owner/document/path,
13 origin-evidence mutations and the existing 24 proof mutations. An independent
native audit entry is prepared to check original/replacement bytes, failed reject
without execution, actual dispatch/outer binding, 24 mutations of a native proof,
12 native-origin mutations and 9 existing native event mutations.

One fresh own test-2 smoke is authorized after this checkpoint commit. Its baseline
setup is outside the single <=60-second observer interval. No Hermes execution,
user-v1 claim, admission switch, production/client/runtime change, review or merge
is authorized by this checkpoint.
