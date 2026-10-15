# WR-009: AI Workspace ignores the configured read byte ceiling

Package: `@warlock.js/ai-workspace` 5.29.0; Node 22.13.0.

Expected: `read.maxBytes` bounds returned read content. The installed public
`esm/contracts/workspace-policy.type.d.mts` and `use-a-workspace` skill describe
a byte ceiling. Actual: a 4,096-byte single-line file with `maxBytes: 16` returns
4,103 content bytes through both direct `readFile()` and the real `read_file`
tool, with no tool error. The seven extra bytes are line-number formatting.

Minimal owned reproduction, including cleanup:

```sh
node --input-type=module <<'JS'
import { workspace } from '@warlock.js/ai-workspace';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root = await mkdtemp(join(tmpdir(), 'warlock-read-cap-'));
try {
  await writeFile(join(root, 'owned.txt'), 'x'.repeat(4096));
  const scoped = workspace({ cwd: root, read: { maxBytes: 16, defaultLines: 1 } });
  const direct = await scoped.readFile('owned.txt');
  const actualTool = await scoped.tools.readFile().invoke({ path: 'owned.txt' });
  console.log(Buffer.byteLength(direct.content)); // 4103, exceeds 16
  console.log(Buffer.byteLength(actualTool.data.content)); // 4103
} finally {
  await rm(root, { recursive: true, force: true });
}
JS
```

Installed `esm/ops.mjs:138–153` reads the whole file, computes its hash and applies
a line window; it never consults `policy.read.maxBytes`. One long line therefore
bypasses the documented limit. This is a demonstrated returned-content contract
failure, not a measured heap failure or an escape from the filesystem jail.

Request: enforce the byte ceiling for both direct and tool reads with explicit
UTF-8-safe truncation/refusal semantics and reliable hash/window metadata. Cover
single long lines, multibyte text, numbered output and direct/tool equivalence.

Application workaround is being implemented through public `createOps` and
real tool factories over a narrowly bounded per-call backend, retaining policy
checks and a trusted same-run read witness plus fresh content CAS for edits.
It is not yet accepted as an integrated working profile. No package edit was made.

Evidence: primary independently repeated the owned direct/tool probe in
`.tmp/coordinator/stage15/ai-workspace-read-byte-cap-repro.json`; executable copy
`reproduce-ai-workspace-read-cap.mjs` in the same evidence directory. No provider,
owner workspace, shell command or real credential was used.

Source: Bureau 0.30 rebuild (`apps/bureau`), recorded 2026-10-14 to 2026-10-15.
