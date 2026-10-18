# WR-005: Core retains vulnerable esbuild on Windows development-server paths

Date: 2026-10-18
Package: @warlock.js/core 5.31.0
Observed in: Bureau B12 / Windows 0.30.0 build findings F04

Core 5.31.0 declares `esbuild: ^0.27.2`; Bureau's prior lockfile resolves 0.27.7. The Windows build's
pnpm audit identifies low-severity GHSA-g7r4-m6w7-qqqr (>=0.27.3 <0.28.1), a file-containment
problem in esbuild's Windows development server. The published advisory names 0.28.1 as patched:
https://github.com/advisories/GHSA-g7r4-m6w7-qqqr . No exploit or installed-app exposure was reproduced.

Request: have Core depend on esbuild >=0.28.1 (prefer the supported ^0.28.2 line), update its lockfile,
and qualify CLI dev/build and Windows file serving. A ^0.27 dependency cannot select the fixed minor.
Vite 7.3.7 already accepts ^0.27.0 || ^0.28.0, but that range alone does not force a safe resolution.

Bureau temporarily overrides all esbuild resolutions to 0.28.2, retaining Vite 7.3.7, without an advisory
ignore or edits to installed dependency bytes. Bureau's B12 report records build/dev/browser qualification;
those Linux checks do not prove the Windows traversal fix independently. Remove the application override
once the supported upstream dependency floor and resolved graph exclude the affected versions.
