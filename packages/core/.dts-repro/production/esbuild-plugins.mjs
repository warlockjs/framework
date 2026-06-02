import { __require } from "../_virtual/_rolldown/runtime.mjs";
//#region ../../@warlock.js/core/src/production/esbuild-plugins.ts
const nativeNodeModulesPlugin = {
	name: "native-node-modules",
	setup(build) {
		build.onResolve({
			filter: /\.node$/,
			namespace: "file"
		}, (args) => ({
			path: __require.resolve(args.path, { paths: [args.resolveDir] }),
			namespace: "node-file"
		}));
		build.onLoad({
			filter: /.*/,
			namespace: "node-file"
		}, (args) => ({ contents: `
          import path from ${JSON.stringify(args.path)}
          try { module.exports = require(path) }
          catch {}
        ` }));
		build.onResolve({
			filter: /\.node$/,
			namespace: "node-file"
		}, (args) => ({
			path: args.path,
			namespace: "file"
		}));
		const opts = build.initialOptions;
		opts.loader = opts.loader || {};
		opts.loader[".node"] = "file";
	}
};
//#endregion
export { nativeNodeModulesPlugin };

//# sourceMappingURL=esbuild-plugins.mjs.map