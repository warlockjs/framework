/**
 * Whether this code runs inside the bundle `warlock build` produced.
 *
 * Core's production build defines `globalThis.__WARLOCK_PRODUCTION_BUNDLE__` as
 * `true`, so a branch guarded by `!globalThis.__WARLOCK_PRODUCTION_BUNDLE__` is
 * removed from that bundle together with the modules it alone imports. That is
 * how the development server, Vite and the build toolchain stay out of a
 * production server, whatever shape the published package has.
 *
 * The guard has to be written out at each site: a bundler removes a branch
 * only when it sees the defined expression there, not behind a function call.
 * This type is the one place its spelling is declared.
 */
export type ProductionBundleGlobal = { __WARLOCK_PRODUCTION_BUNDLE__?: boolean };
