import ts from "typescript";

export type TypeScriptResult = {
  tool: "TypeScript";
  filePath: string;
  diagnostics: ts.Diagnostic[];
  sourceFile: ts.SourceFile;
};

/**
 * Check a single file for TypeScript errors
 */
export async function checkSingleFile(
  filePath: string,
): Promise<TypeScriptResult | null> {
  try {
    const configPath = ts.findConfigFile(
      process.cwd(),
      ts.sys.fileExists,
      "tsconfig.json",
    );

    if (!configPath) {
      return null;
    }

    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    const parsedConfig = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      process.cwd(),
    );

    const program = ts.createProgram([filePath], parsedConfig.options);
    const sourceFile = program.getSourceFile(filePath);

    if (!sourceFile) {
      return null;
    }

    const diagnostics = [
      ...program.getSyntacticDiagnostics(sourceFile),
      ...program.getSemanticDiagnostics(sourceFile),
    ];

    return {
      tool: "TypeScript",
      filePath: filePath.replace(/\\/g, "/"),
      diagnostics,
      sourceFile,
    };
  } catch (error) {
    return null;
  }
}

/**
 * Check entire project for TypeScript errors
 */
export async function checkProject(
  projectPath: string,
): Promise<TypeScriptResult[]> {
  try {
    const configPath = ts.findConfigFile(
      projectPath,
      ts.sys.fileExists,
      "tsconfig.json",
    );

    if (!configPath) {
      return [];
    }

    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    const parsedConfig = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      projectPath,
    );

    // Create program with entire project
    const program = ts.createProgram(
      parsedConfig.fileNames,
      parsedConfig.options,
    );

    // Get all diagnostics for all files
    const allDiagnostics = ts.getPreEmitDiagnostics(program);

    // Group diagnostics by file
    const diagnosticsByFile = new Map<string, ts.Diagnostic[]>();

    for (const diagnostic of allDiagnostics) {
      if (diagnostic.file) {
        const fileName = diagnostic.file.fileName;
        if (!diagnosticsByFile.has(fileName)) {
          diagnosticsByFile.set(fileName, []);
        }
        diagnosticsByFile.get(fileName)!.push(diagnostic);
      }
    }

    // Convert to results array
    const results: TypeScriptResult[] = [];

    for (const [fileName, diagnostics] of diagnosticsByFile) {
      const sourceFile = program.getSourceFile(fileName);
      if (sourceFile) {
        results.push({
          tool: "TypeScript",
          filePath: fileName,
          diagnostics,
          sourceFile,
        });
      }
    }

    return results;
  } catch (error) {
    return [];
  }
}
