# WR-055: `@warlock.js/fs` has no confined, no-follow reader

- **Package:** `@warlock.js/fs` 5.30.0
- **Classification:** feature request
- **Found:** 2026-10-17, while building Bureau's 0.29 data import (the owner points Bureau at an old data folder that it must read without being tricked into reading elsewhere).

## What is missing

Apps that read a folder the user chose need three guarantees:

- every path stays inside a chosen root;
- symbolic links (and Windows junctions) are never followed, at any component, not only the leaf;
- reads are bounded in size and count.

`@warlock.js/fs` has no API for this, so Bureau wrote its own on `node:fs`: an `lstat` per component, `O_NOFOLLOW` opens, canonical-root checks and byte caps. `@warlock.js/ai-workspace` has `resolveInJail` for its own tools, but it is not exposed as a general file-system helper.

## Request

A small confined reader, for example:

```ts
const jail = fs.confined(root, { followLinks: false, maxFileBytes: 8 * 1024 * 1024 });
await jail.readText("rooms/main/room.json");   // throws FsPathEscapeError / FsLinkRefusedError
for await (const entry of jail.walk("rooms", { maxEntries: 20_000 })) { … }
```

It should:

- reject `..` escapes;
- check every component with `lstat` (and refuse a symlink or junction anywhere in the path);
- open with `O_NOFOLLOW` where the OS supports it;
- re-check the opened file's device and inode against the `lstat` result to close the check-then-open race;
- throw typed errors.

Sharing one implementation with `ai-workspace`'s `resolveInJail` would keep the two consistent.
