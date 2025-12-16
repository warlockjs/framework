import type { FileManager } from "./file-manager";

/**
 * Dependency Graph
 * Tracks bidirectional relationships between files:
 * - dependencies: files that this file imports
 * - dependents: files that import this file
 */
export class DependencyGraph {
  /**
   * Map of file -> files it depends on (imports)
   * Key: relative file path
   * Value: Set of relative file paths this file imports
   */
  private dependencies = new Map<string, Set<string>>();

  /**
   * Map of file -> files that depend on it (importers)
   * Key: relative file path
   * Value: Set of relative file paths that import this file
   */
  private dependents = new Map<string, Set<string>>();

  /**
   * Build dependency graph from FileManager map
   */
  public build(files: Map<string, FileManager>) {
    // Clear existing graph
    this.dependencies.clear();
    this.dependents.clear();

    // Build graph from all files
    for (const [relativePath, fileManager] of files) {
      // Initialize empty sets ONLY if not already present
      // (addDependency may have already created entries for this file)
      if (!this.dependencies.has(relativePath)) {
        this.dependencies.set(relativePath, new Set());
      }
      if (!this.dependents.has(relativePath)) {
        this.dependents.set(relativePath, new Set());
      }

      // Add dependencies
      for (const dependency of fileManager.dependencies) {
        this.addDependency(relativePath, dependency);
      }
    }

    // Detect circular dependencies
    const cycles = this.detectCircularDependencies();
    if (cycles.length > 0) {
      console.warn(`⚠️  Found ${cycles.length} circular dependency chain(s)`);
      for (const cycle of cycles) {
        console.warn(`   ${cycle.join(" → ")}`);
      }
    }
  }

  /**
   * Add a dependency relationship
   * @param file The file that has the dependency
   * @param dependency The file being depended upon
   */
  public addDependency(file: string, dependency: string) {
    // Ensure both files exist in the graph
    if (!this.dependencies.has(file)) {
      this.dependencies.set(file, new Set());
    }
    if (!this.dependents.has(dependency)) {
      this.dependents.set(dependency, new Set());
    }

    // Add bidirectional relationship
    this.dependencies.get(file)!.add(dependency);
    this.dependents.get(dependency)!.add(file);
  }

  /**
   * Remove a dependency relationship
   * @param file The file that has the dependency
   * @param dependency The file being depended upon
   */
  public removeDependency(file: string, dependency: string) {
    this.dependencies.get(file)?.delete(dependency);
    this.dependents.get(dependency)?.delete(file);
  }

  /**
   * Remove all relationships for a file
   * @param file The file to remove
   */
  public removeFile(file: string) {
    // Remove as dependent from all its dependencies
    const deps = this.dependencies.get(file);
    if (deps) {
      for (const dependency of deps) {
        this.dependents.get(dependency)?.delete(file);
      }
    }

    // Remove as dependency from all its dependents
    const dependents = this.dependents.get(file);
    if (dependents) {
      for (const dependent of dependents) {
        this.dependencies.get(dependent)?.delete(file);
      }
    }

    // Remove from maps
    this.dependencies.delete(file);
    this.dependents.delete(file);
  }

  /**
   * Update dependencies for a file
   * @param file The file to update
   * @param newDependencies New set of dependencies
   */
  public updateFile(file: string, newDependencies: Set<string>) {
    // Get old dependencies
    const oldDependencies = this.dependencies.get(file) || new Set();

    // Find removed dependencies
    for (const oldDep of oldDependencies) {
      if (!newDependencies.has(oldDep)) {
        this.removeDependency(file, oldDep);
      }
    }

    // Find added dependencies
    for (const newDep of newDependencies) {
      if (!oldDependencies.has(newDep)) {
        this.addDependency(file, newDep);
      }
    }
  }

  /**
   * Get files that this file depends on (imports)
   * @param file The file to check
   * @returns Set of files this file imports
   */
  public getDependencies(file: string): Set<string> {
    return this.dependencies.get(file) || new Set();
  }

  /**
   * Get files that depend on this file (importers)
   * @param file The file to check
   * @returns Set of files that import this file
   */
  public getDependents(file: string): Set<string> {
    return this.dependents.get(file) || new Set();
  }

  /**
   * Get invalidation chain for a file
   * Returns all files that need to be reloaded when this file changes
   * Includes the file itself and all transitive dependents
   * @param file The file that changed
   * @returns Array of files to invalidate (in order)
   */
  public getInvalidationChain(file: string): string[] {
    const chain: string[] = [file];
    const visited = new Set([file]);

    const traverse = (current: string) => {
      const deps = this.getDependents(current);
      for (const dep of deps) {
        if (!visited.has(dep)) {
          visited.add(dep);
          chain.push(dep);
          traverse(dep); // Recursive traversal
        }
      }
    };

    traverse(file);
    return chain;
  }

  /**
   * Detect circular dependencies
   * @returns Array of circular dependency chains
   */
  public detectCircularDependencies(): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const dfs = (file: string, path: string[]): void => {
      visited.add(file);
      recursionStack.add(file);
      path.push(file);

      const deps = this.getDependencies(file);
      for (const dep of deps) {
        if (!visited.has(dep)) {
          dfs(dep, [...path]);
        } else if (recursionStack.has(dep)) {
          // Found a cycle
          const cycleStart = path.indexOf(dep);
          const cycle = [...path.slice(cycleStart), dep];
          cycles.push(cycle);
        }
      }

      recursionStack.delete(file);
    };

    for (const file of this.dependencies.keys()) {
      if (!visited.has(file)) {
        dfs(file, []);
      }
    }

    return cycles;
  }

  /**
   * Get statistics about the dependency graph
   */
  public getStats() {
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

    for (const [file, deps] of this.dependents) {
      if (deps.size > maxDependents) {
        maxDependents = deps.size;
        mostDependedFile = file;
      }
    }

    return {
      totalFiles: this.dependencies.size,
      totalDependencies,
      avgDependenciesPerFile: totalDependencies / this.dependencies.size || 0,
      maxDependencies,
      maxDependents,
      mostDependingFile,
      mostDependedFile,
    };
  }
}
