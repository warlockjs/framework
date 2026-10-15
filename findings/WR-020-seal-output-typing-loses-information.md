# WR-020: Seal output typing loses information

Package: `@warlock.js/seal` 5.29.0 (and the Core upload validator).
Classification: confirmed typing bug. Each case below was a `tsc` error fixed in
the 2026-10-15 validation pass.

- `validate(schema, value)` returns `data: any`, so callers need an explicitly
  typed const to avoid implicit `any` downstream.
- `schema["~standard"].validate(...)` on a `v.discriminatedUnion` yields
  `unknown` instead of the inferred union.
- `v.file().maxSize(...)` returns a bare `FileValidator`, losing the
  `UploadedFile` output type.
- `.refine()` callbacks receive `any`.
- `Infer<>` vs `Infer.Output<>` with `.default()` is easy to misuse: the
  input shape makes defaulted fields optional. A docs clarification would
  prevent this.

Related evidence for WR-008: `v.string().max(n).default("")` fails with
"is required" because the empty default is itself treated as missing, unless
`.present()` is added. `.present()` on a bare multi-value literal still rejects
`""`. Bureau uses `v.union([v.literal(""), v.literal(...)]).present()`.

Source: Bureau 0.30 rebuild (`apps/bureau`), recorded 2026-10-14 to 2026-10-15.
