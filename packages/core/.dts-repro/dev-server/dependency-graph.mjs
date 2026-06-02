//#region ../../@warlock.js/core/src/dev-server/dependency-graph.ts
/**
* Dependency Graph
* Tracks bidirectional relationships between files:
* - dependencies: files that this file imports
* - dependents: files that import this file
*
* Each forward edge also carries an `isTypeOnly` flag so cycle detection
* can distinguish runtime cycles from ones formed purely by `import type`
* edges — the latter are erased by TypeScript and have no runtime effect.
*/
var DependencyGraph = class {
	constructor() {
		this.dependencies = /* @__PURE__ */ new Map();
		this.dependents = /* @__PURE__ */ new Map();
		this.files = null;
	}
	/**
	* Build dependency graph from FileManager map
	*/
	build(files) {
		this.files = files;
		this.dependencies.clear();
		this.dependents.clear();
		for (const [relativePath, fileManager] of files) {
			if (!this.dependencies.has(relativePath)) this.dependencies.set(relativePath, /* @__PURE__ */ new Map());
			if (!this.dependents.has(relativePath)) this.dependents.set(relativePath, /* @__PURE__ */ new Set());
			for (const dependency of fileManager.dependencies) {
				const isTypeOnly = fileManager.typeOnlyDependencies.has(dependency);
				this.addDependency(relativePath, dependency, isTypeOnly);
			}
		}
		const cycles = this.detectCircularDependencies();
		if (cycles.length > 0) this.displayCircularDependencyWarnings(cycles);
	}
	/**
	* Add a dependency relationship.
	* If the edge already exists, the type-only flag is ANDed: any runtime
	* statement between the two files makes the edge runtime permanently.
	*
	* @param file The file that has the dependency
	* @param dependency The file being depended upon
	* @param isTypeOnly Whether every reference from `file` to `dependency` is type-only
	*/
	addDependency(file, dependency, isTypeOnly = false) {
		if (!this.dependencies.has(file)) this.dependencies.set(file, /* @__PURE__ */ new Map());
		if (!this.dependents.has(dependency)) this.dependents.set(dependency, /* @__PURE__ */ new Set());
		const edges = this.dependencies.get(file);
		const existing = edges.get(dependency);
		if (existing) existing.isTypeOnly = existing.isTypeOnly && isTypeOnly;
		else edges.set(dependency, { isTypeOnly });
		this.dependents.get(dependency).add(file);
	}
	/**
	* Remove a dependency relationship
	* @param file The file that has the dependency
	* @param dependency The file being depended upon
	*/
	removeDependency(file, dependency) {
		this.dependencies.get(file)?.delete(dependency);
		this.dependents.get(dependency)?.delete(file);
	}
	/**
	* Remove all relationships for a file
	* @param file The file to remove
	*/
	removeFile(file) {
		const deps = this.dependencies.get(file);
		if (deps) for (const dependency of deps.keys()) this.dependents.get(dependency)?.delete(file);
		const dependents = this.dependents.get(file);
		if (dependents) for (const dependent of dependents) this.dependencies.get(dependent)?.delete(file);
		this.dependencies.delete(file);
		this.dependents.delete(file);
	}
	/**
	* Update dependencies for a file.
	*
	* Accepts the updated `Set<string>` of dependency paths; when the caller
	* has per-edge type-only info, pass `typeOnlyDependencies` so the new
	* edges get the correct flag. Missing flag defaults to runtime.
	*
	* @param file The file to update
	* @param newDependencies New set of dependency paths
	* @param typeOnlyDependencies Subset of `newDependencies` whose edges are type-only
	*/
	updateFile(file, newDependencies, typeOnlyDependencies = /* @__PURE__ */ new Set()) {
		const oldEdges = this.dependencies.get(file) ?? /* @__PURE__ */ new Map();
		for (const oldDep of oldEdges.keys()) if (!newDependencies.has(oldDep)) this.removeDependency(file, oldDep);
		for (const newDep of newDependencies) {
			const isTypeOnly = typeOnlyDependencies.has(newDep);
			const existing = oldEdges.get(newDep);
			if (!existing) {
				this.addDependency(file, newDep, isTypeOnly);
				continue;
			}
			if (existing.isTypeOnly !== isTypeOnly) existing.isTypeOnly = isTypeOnly;
		}
	}
	/**
	* Get files that this file depends on (imports)
	* @param file The file to check
	* @returns Set of files this file imports
	*/
	getDependencies(file) {
		const edges = this.dependencies.get(file);
		if (!edges) return /* @__PURE__ */ new Set();
		return new Set(edges.keys());
	}
	/**
	* Check whether the edge `file → dependency` is type-only.
	* Returns false if the edge does not exist.
	*/
	isEdgeTypeOnly(file, dependency) {
		return this.dependencies.get(file)?.get(dependency)?.isTypeOnly === true;
	}
	/**
	* Get files that depend on this file (importers)
	* @param file The file to check
	* @returns Set of files that import this file
	*/
	getDependents(file) {
		return this.dependents.get(file) || /* @__PURE__ */ new Set();
	}
	/**
	* Get invalidation chain for a file
	* Returns all files that need to be reloaded when this file changes
	* Includes the file itself and all transitive dependents
	* @param file The file that changed
	* @returns Array of files to invalidate (in order)
	*/
	getInvalidationChain(file) {
		const chain = [file];
		const visited = new Set([file]);
		const traverse = (current) => {
			const deps = this.getDependents(current);
			for (const dep of deps) if (!visited.has(dep)) {
				visited.add(dep);
				chain.push(dep);
				traverse(dep);
			}
		};
		traverse(file);
		return chain;
	}
	/**
	* Detect circular dependencies in the dependency graph.
	* Uses depth-first search to find cycles.
	*
	* Filtering rule (per-edge): a cycle is suppressed when **any** edge in
	* the chain is type-only. TypeScript erases type-only imports entirely,
	* so a single type-only edge breaks the cycle at runtime. Only warn when
	* every edge is a runtime binding — that's the cycle that actually loops
	* at load time.
	*
	* @returns Array of circular dependency chains (each chain is an array of file paths)
	*/
	detectCircularDependencies() {
		const cycles = [];
		const visited = /* @__PURE__ */ new Set();
		const recursionStack = /* @__PURE__ */ new Set();
		const dfs = (file, path) => {
			visited.add(file);
			recursionStack.add(file);
			path.push(file);
			const edges = this.dependencies.get(file);
			if (edges) {
				for (const dep of edges.keys()) if (!visited.has(dep)) dfs(dep, [...path]);
				else if (recursionStack.has(dep)) {
					const cycleStart = path.indexOf(dep);
					const cycle = [...path.slice(cycleStart), dep];
					cycles.push(cycle);
				}
			}
			recursionStack.delete(file);
		};
		for (const file of this.dependencies.keys()) if (!visited.has(file)) dfs(file, []);
		return cycles.filter((cycle) => this.isRuntimeCycle(cycle));
	}
	/**
	* True iff every edge in the cycle is a runtime binding. The cycle array
	* ends with a duplicate of its start (`[A, B, C, A]`) so we walk the
	* consecutive pairs once — any type-only edge means TS erases the loop
	* and there is no runtime cycle to report.
	*/
	isRuntimeCycle(cycle) {
		for (let index = 0; index < cycle.length - 1; index++) {
			const from = cycle[index];
			const to = cycle[index + 1];
			if (this.isEdgeTypeOnly(from, to)) return false;
		}
		return true;
	}
	/**
	* Display circular dependency warnings in a formatted, user-friendly way
	* Shows each cycle with visual tree structure and helpful recommendations
	*/
	displayCircularDependencyWarnings(cycles) {
		const colors = {
			yellow: (text) => `\x1b[33m${text}\x1b[0m`,
			cyan: (text) => `\x1b[36m${text}\x1b[0m`,
			dim: (text) => `\x1b[2m${text}\x1b[0m`,
			bold: (text) => `\x1b[1m${text}\x1b[0m`,
			green: (text) => `\x1b[32m${text}\x1b[0m`
		};
		console.log("");
		console.log(colors.yellow("⚠️  Circular Dependencies Detected"));
		console.log(colors.dim("━".repeat(60)));
		console.log("");
		console.log(colors.dim(`Found ${colors.bold(cycles.length.toString())} circular dependency chain${cycles.length > 1 ? "s" : ""}`));
		console.log("");
		cycles.forEach((cycle, index) => {
			console.log(colors.cyan(`  ${index + 1}. Cycle with ${cycle.length - 1} files:`));
			console.log("");
			cycle.forEach((file, fileIndex) => {
				const isLast = fileIndex === cycle.length - 1;
				const arrow = isLast ? colors.dim("   └─→ ") : colors.dim("   ├─→ ");
				const fileName = file.split("/").pop() || file;
				const filePath = colors.dim(file.replace(fileName, ""));
				if (isLast) console.log(arrow + colors.yellow(`${filePath}${colors.bold(fileName)} (cycle completes)`));
				else console.log(arrow + filePath + colors.bold(fileName));
			});
			console.log("");
		});
		console.log(colors.dim("━".repeat(60)));
		console.log(colors.yellow("💡 How to Fix:"));
		console.log("");
		const exampleCycle = cycles[0];
		const fileA = exampleCycle[0]?.split("/").pop() || "fileA.ts";
		const fileB = exampleCycle[1]?.split("/").pop() || "fileB.ts";
		const stripExt = (file) => file.replace(/\.tsx?$/, "");
		const kind = classifyCycle(exampleCycle);
		if (kind === "resource" || kind === "model") {
			console.log(colors.green(`  ✨ Use lazy() for the back-reference`));
			console.log(colors.dim(`   ${kind === "resource" ? "Resources" : "Models"} that reference each other should declare`));
			console.log(colors.dim(`   one side with lazy() so the import resolves at access time:`));
			console.log("");
			console.log(colors.dim(`     import { lazy } from "@warlock.js/cascade";`));
			console.log(colors.dim(`     // inside ${fileB}:`));
			console.log(colors.dim(`     other: lazy(() => ${kind === "resource" ? "OtherResource" : "OtherModel"})`));
			console.log("");
		} else {
			console.log(colors.green(`  ✨ Convert one edge to a dynamic import`));
			console.log(colors.dim(`   In ${fileB}, change:`));
			console.log(colors.dim(`     import { SomeClass } from "./${stripExt(fileA)}";`));
			console.log(colors.dim(`   To:`));
			console.log(colors.dim(`     const { SomeClass } = await import("./${stripExt(fileA)}");`));
			console.log("");
		}
		console.log(colors.dim("  Other options:"));
		console.log(colors.dim("    • Extract the shared symbols into a third file both can import."));
		console.log(colors.dim("    • Pass the dependency as a constructor/function parameter instead."));
		console.log("");
		console.log(colors.dim("━".repeat(60)));
		console.log(colors.dim("   Circular dependencies can cause HMR issues and hard-to-debug"));
		console.log(colors.dim("   initialization order problems. Consider refactoring."));
		console.log("");
	}
	/**
	* Get statistics about the dependency graph
	*/
	getStats() {
		let totalDependencies = 0;
		let maxDependencies = 0;
		let maxDependents = 0;
		let mostDependedFile = "";
		let mostDependingFile = "";
		for (const [file, deps] of this.dependencies) {
			totalDependencies += deps.size;
			if (deps.size > maxDependencies) {
				maxDependencies = deps.size;
				mostDependingFile = file;
			}
		}
		for (const [file, deps] of this.dependents) if (deps.size > maxDependents) {
			maxDependents = deps.size;
			mostDependedFile = file;
		}
		return {
			totalFiles: this.dependencies.size,
			totalDependencies,
			avgDependenciesPerFile: totalDependencies / this.dependencies.size || 0,
			maxDependencies,
			maxDependents,
			mostDependingFile,
			mostDependedFile
		};
	}
};
/**
* Pick the most useful "fix-it" hint for a cycle by inspecting the file
* extensions involved. Cascade resources/models have a first-class fix
* (`lazy()`); generic cycles just want a dynamic import.
*/
function classifyCycle(cycle) {
	const files = cycle.slice(0, -1);
	if (files.every((file) => file.endsWith(".resource.ts") || file.endsWith(".resource.tsx"))) return "resource";
	if (files.every((file) => file.endsWith(".model.ts") || file.endsWith(".model.tsx"))) return "model";
	return "generic";
}
//#endregion
export { DependencyGraph };

//# sourceMappingURL=dependency-graph.mjs.map