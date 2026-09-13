# Node17 — bounded account-probe diagnosis

Assignment: `node17:account-probe-diagnosis:1:95a8105c`.
The previous timeout remains FAIL, with its UI substep unknown.

## Transport check before the one diagnostic session

Source evidence: `bridge.mjs` awaits `browserGate(prepareWorkspaceSession)` before
returning the preparation reply. `createSerialGate` in `clipboard.mjs` waits only
for the supplied operation, not the outer public callback. MCP SDK Protocol
handles response messages independently of pending request handlers. The pinned
Playwright backend runs a code callback before its bounded post-action settling;
its request context is separate from the caller's public server.

A focused test with actual SDK Client/Server, InMemoryTransport and the actual
source serial gate confirmed that a second browser response can arrive after
preparation releases the gate while the outer public prepare still awaits its
post-handler probe. This is a transport/lock unit check, not live-browser proof.
It gives no evidence that the historical timeout was a deadlock.

The probe now records bounded started/completed read/open/close steps and their
small observations, with no whole menu text. The browser budget is at most 20 s,
with at least 10 s left before the 30 s host boundary. At most 32 observations /
96 steps are retained. Unconfirmed closure returns a partial failure; all awaited
UI operations have settled when the function returns. Browser errors are reduced
to a fixed code and error class to avoid logging incidental menu contents.
Transport failure closes the sole owned browser client before propagating the
failure; the outer diagnostic runner closes the source MCP and checks processes.

A diagnosis-only entry purpose admits only the assigned dock_prepare; other
public tool calls are refused. The one-shot diagnostic runner has no input
artifact, stdin continuation, upload, node call, observer, replace or Hermes path.
No product/runtime/config changes were made. Six focused Node tests and twenty
Text export Python tests passed. The frozen candidate has runtime155/harness275.

One fresh diagnostic session and one probe are authorized after this checkpoint.
The minimal user-v1 component run remains a separate future assignment.
