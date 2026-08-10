// The defect this whole channel exists for: a bundle that emits a bare
// specifier the app cannot resolve. Node fails with ERR_MODULE_NOT_FOUND before
// a single line runs, so nothing ever reports readiness.
import "@this-package-does-not-exist/nowhere";

process.send({ type: "warlock:ready" });
