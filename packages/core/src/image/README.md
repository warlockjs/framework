# Image

Image processing utilities. Provides an `Image` class for resizing, converting, and manipulating images.

## Key Files

| File       | Purpose                                                               |
| ---------- | --------------------------------------------------------------------- |
| `image.ts` | `Image` class — resize, crop, convert, compress, watermark operations |
| `index.ts` | Barrel export                                                         |

## Key Exports

- `Image` — image processing class

## Dependencies

### Internal (within `core/src`)

- None directly

### External

- `sharp` — underlying image processing library. Optional, and resolved lazily: the
  first `Image` construction that needs it requires it synchronously via
  `createRequire`, and throws the install hint if it is absent. Importing this
  module — or `@warlock.js/core` — never loads sharp's native binary on its own,
  and constructing an `Image` from an existing sharp instance skips resolution
  entirely

## Used By

- `http/uploaded-file.ts` — may process uploaded images
- `storage/` — image files stored via storage drivers
- Application-level code for image manipulation
