# WR-013: Independent concurrent form actions

Package: `@warlock.js/web` 5.29.0; Node 22.13.0; real Chrome over CDP.
This is a feature request with reproduced application impact. No documented
promise of concurrent form submission has been established, so this is not
classified as a broken framework contract.

Expected addition: a supported independent submission path for a second form
whose operation must run while an earlier form is pending, such as cancellation
of a long-running Start. Ordinary duplicate-submission protection can remain.
Actual: the navigation runtime shares one action submitter. Its installed
`esm/client/navigation/action-submitter.mjs:85` returns the existing `inFlight`
promise regardless of the second target or body. An enabled Cancel control
therefore sends no cancellation request while Start is waiting.

Independent primary reproduction calls the installed submitter twice with
separate Start and Cancel URLs while an inert fetch promise remains pending.
Both calls return the identical promise and only the Start URL reaches fetch.
It performs no network access. Run from this project:
`node .tmp/coordinator/framework-concurrent-form/reproduce.mjs`.
The source hash is
`4dd7c4c3c288a25c0338477033cf7538e4069d6b214ee3e88cbffe6251b52d22`;
the captured primary result is in the adjacent `evidence.json`.

Actual browser evidence uses the immutable original API controls and a disposable
copied production application, the real configured owner facade and V5 publisher,
an inert credential resolver and a synthetic slow upstream. Clicking enabled
Cancel during Start yields exactly one Start POST and zero Cancel POSTs; Start
ends at its three-second upstream timeout. No browser exception occurred.
Evidence: the API UI lane's `.tmp/api-form-single-flight/evidence.json`, SHA-256
`e38436d518e7011146b0ac63622efd0993b976f58d2aaa83cf070a46f5ff9ef8`, and
`.tmp/reproduce-api-form-single-flight.mjs`. No paid provider was used.

Application workaround: only hydrated cancellation uses a bounded independent
same-origin native POST to the existing page action. The exact retained command
and UUID are checked before submission; response bytes are discarded and cannot
clear or replace recovery state. No-JavaScript native submission is preserved.
The compatible four-file cancellation overlay passed real overlapping requests:
one model request, cancellation returning while Start is pending, original Start
ending after 748 ms, byte-identical held recovery data and no source publication.
Source has been integrated; the combined application milestone remains pending.

Request: expose documented independent form submission with per-operation
cancellation and completion, without sharing or replacing unrelated navigation
tickets. Cover two distinct forms, duplicate submissions, a pending Start with
Cancel, unmount, native fallback and retained recovery state. This is distinct
from submitter target/value loss (WR-011) and redirect completion (WR-002).

Source: Bureau 0.30 rebuild (`apps/bureau`), recorded 2026-10-14 to 2026-10-15.
