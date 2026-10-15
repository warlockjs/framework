# WR-015: Atomic no-replace directory moves

Package: `@warlock.js/fs` 5.29.0; observed runtime Node 22.13.0 on Linux.
Classification: a request for a stronger filesystem primitive. Ordinary rename
behavior is expected; this is not a confirmed Warlock or Node defect.

Installed `esm/rename.mjs` delegates to Node's path-based rename.
`esm/facade/dirs.mjs` implements `overwrite: false` with a prior existence check,
then ordinary rename, with a copy/remove fallback for cross-device moves.
The public runtime/type exports and installed directory/facade skills expose no
descriptor-relative atomic no-replace directory operation.

Both author and coordinator independently executed an owned deterministic
interleaving: confirm the destination is absent, create another empty directory
there, then call ordinary rename. Node and the actual exported
`renameFileAsync` replace that directory. The installed destination becomes the
source inode, while an open handle to the previous destination reports zero
links. This demonstrates the underlying operation; it does not claim an observed
concurrent exploit inside the facade's own existence check.

Request: a distinct server-side directory move API with pinned parent-directory
capabilities and closed child names, atomic occupied-destination refusal and
explicit identity checks. Preserve whole-tree bytes and identity. Never silently
fall back to recursive copy/delete. Distinguish known-not-moved from an uncertain
move or durability result; document two-parent flush responsibilities. Unsupported
platforms, filesystems and cross-device combinations must refuse explicitly.
Document which identity checks are sequential: an atomic destination guarantee
must not imply an atomic source-inode comparison that the underlying platform
does not provide. Existing path-based move semantics need not change.

Bureau impact: real feature archive moves a complete directory and preserves
old operation receipts. It needs a closed durable move journal and collision-safe
destination custody. The separately reviewed Linux no-replace helper now has
owned native collision and two-parent durability evidence. The archive journal
and retained-command UI also have copied-production and browser evidence from
their frozen source handoff. That source is integrated. Explicit owner inspection
and repair UI have a separate source handoff and owned browser evidence; the
coordinator is reviewing a further request-context capture correction before
integration. Consolidated validation of the later
combined application is deferred by the owner's validation pause. This request
does not currently block implementation, and it does not establish Windows
qualification. Domain authorization and root custody remain application
responsibilities.

Run the coordinator's independent reproducer from this project:
`node .tmp/coordinator/framework-fs-noreplace/independent-directory-collision.mjs`.
Its result is `independent-evidence.json` beside the script. All roots and bytes
are disposable and owned; no package modifications or live workspace data are
involved. The frozen author source, public-export inventory and reproduction
evidence are recorded in
`/tmp/bureau-2-feature-lifecycle-ciud1xzz/.tmp/fs-no-replace-evidence/manifest.json`,
SHA-256 `c2bc6698edccbfe8eda88dc9042e9e3a87802fe01f1e7f1ea8866ee7c69df7ec`.

Source: Bureau 0.30 rebuild (`apps/bureau`), recorded 2026-10-14 to 2026-10-15.
