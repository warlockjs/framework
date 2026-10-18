# WR-002: file snapshot store writes conversations with default public-readable modes

Date: 2026-10-18
Package: @warlock.js/ai 5.31.0
Observed in: esm/snapshot/file.mjs, FileSnapshotStore.save

save uses mkdir({recursive:true}) and writeFile(...,"utf8") without private modes. Under the usual 0022 umask this creates a 0755 directory and 0644 conversation files. Agent conversations contain private source and tool output. Bureau's previous transcript writer used 0600.

Requested: default directory mode 0700 and new snapshot file mode 0600, or configurable modes with private defaults. Bureau creates its owned store directory with mode 0700 before constructing ai.snapshot.file, so another local user cannot traverse into it. No framework code changed here.

## Executed probe

2026-10-18, Node 22.23.3. Saved a dummy `{runId:"fixture",fixture:true}` record through the published `ai.snapshot.file`, then measured `stat.mode & 0777`: directory `0755`, JSON file `0644`. The fixture was under Bureau's owned `.runtime/` and was deleted afterwards. No real conversation or secret was written. Evidence: Bureau worktree `apps/bureau/.runtime/b8-evidence/framework-findings-proof.json`.
