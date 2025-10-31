import { fileExistsAsync, getFileAsync, putFileAsync } from "@mongez/fs";
import path from "path";

type FileIssue = {
  file: string;
  errors: number;
  warnings: number;
};

type IssueBaseline = {
  timestamp: number;
  typescript: {
    filesWithIssues: FileIssue[];
    totalErrors: number;
    totalWarnings: number;
  };
  eslint: {
    filesWithIssues: FileIssue[];
    totalErrors: number;
    totalWarnings: number;
  };
};

type ProgressInfo = {
  typescript: {
    fixedFiles: number;
    remainingFiles: number;
    totalFilesInBaseline: number;
    fixedErrors: number;
    fixedWarnings: number;
  };
  eslint: {
    fixedFiles: number;
    remainingFiles: number;
    totalFilesInBaseline: number;
    fixedErrors: number;
    fixedWarnings: number;
  };
  hasBaseline: boolean;
};

const BASELINE_FILE = path.resolve(
  process.cwd(),
  ".warlock/.issues-baseline.json",
);

/**
 * Save current issues as baseline for tracking progress
 */
export async function saveBaseline(
  typescriptIssues: FileIssue[],
  eslintIssues: FileIssue[],
): Promise<void> {
  const baseline: IssueBaseline = {
    timestamp: Date.now(),
    typescript: {
      filesWithIssues: typescriptIssues,
      totalErrors: typescriptIssues.reduce((sum, file) => sum + file.errors, 0),
      totalWarnings: typescriptIssues.reduce(
        (sum, file) => sum + file.warnings,
        0,
      ),
    },
    eslint: {
      filesWithIssues: eslintIssues,
      totalErrors: eslintIssues.reduce((sum, file) => sum + file.errors, 0),
      totalWarnings: eslintIssues.reduce((sum, file) => sum + file.warnings, 0),
    },
  };

  await putFileAsync(BASELINE_FILE, JSON.stringify(baseline, null, 2), "utf8");
}

/**
 * Load baseline issues from file
 */
export async function loadBaseline(): Promise<IssueBaseline | null> {
  try {
    const exists = await fileExistsAsync(BASELINE_FILE);
    if (!exists) {
      return null;
    }

    const content = await getFileAsync(BASELINE_FILE);
    return JSON.parse(content);
  } catch (error) {
    return null;
  }
}

/**
 * Calculate progress by comparing current issues with baseline
 */
export async function calculateProgress(
  currentTypescriptIssues: FileIssue[],
  currentEslintIssues: FileIssue[],
): Promise<ProgressInfo> {
  const baseline = await loadBaseline();

  if (!baseline) {
    return {
      typescript: {
        fixedFiles: 0,
        remainingFiles: currentTypescriptIssues.length,
        totalFilesInBaseline: 0,
        fixedErrors: 0,
        fixedWarnings: 0,
      },
      eslint: {
        fixedFiles: 0,
        remainingFiles: currentEslintIssues.length,
        totalFilesInBaseline: 0,
        fixedErrors: 0,
        fixedWarnings: 0,
      },
      hasBaseline: false,
    };
  }

  // Calculate TypeScript progress
  const tsFixedFiles = baseline.typescript.filesWithIssues.filter(
    baselineFile => {
      return !currentTypescriptIssues.some(
        currentFile => currentFile.file === baselineFile.file,
      );
    },
  );

  const tsFixedErrors = tsFixedFiles.reduce(
    (sum, file) => sum + file.errors,
    0,
  );
  const tsFixedWarnings = tsFixedFiles.reduce(
    (sum, file) => sum + file.warnings,
    0,
  );

  // Calculate ESLint progress
  const eslintFixedFiles = baseline.eslint.filesWithIssues.filter(
    baselineFile => {
      return !currentEslintIssues.some(
        currentFile => currentFile.file === baselineFile.file,
      );
    },
  );

  const eslintFixedErrors = eslintFixedFiles.reduce(
    (sum, file) => sum + file.errors,
    0,
  );
  const eslintFixedWarnings = eslintFixedFiles.reduce(
    (sum, file) => sum + file.warnings,
    0,
  );

  return {
    typescript: {
      fixedFiles: tsFixedFiles.length,
      remainingFiles: currentTypescriptIssues.length,
      totalFilesInBaseline: baseline.typescript.filesWithIssues.length,
      fixedErrors: tsFixedErrors,
      fixedWarnings: tsFixedWarnings,
    },
    eslint: {
      fixedFiles: eslintFixedFiles.length,
      remainingFiles: currentEslintIssues.length,
      totalFilesInBaseline: baseline.eslint.filesWithIssues.length,
      fixedErrors: eslintFixedErrors,
      fixedWarnings: eslintFixedWarnings,
    },
    hasBaseline: true,
  };
}

/**
 * Update baseline by removing a fixed file
 */
export async function updateBaselineOnFileFix(
  filePath: string,
  checker: "typescript" | "eslint",
): Promise<void> {
  const baseline = await loadBaseline();
  if (!baseline) {
    return;
  }

  const normalizedPath = path.resolve(filePath);

  if (checker === "typescript") {
    const fileIndex = baseline.typescript.filesWithIssues.findIndex(
      file => path.resolve(file.file) === normalizedPath,
    );

    if (fileIndex !== -1) {
      const removedFile = baseline.typescript.filesWithIssues[fileIndex];
      baseline.typescript.totalErrors -= removedFile.errors;
      baseline.typescript.totalWarnings -= removedFile.warnings;
      baseline.typescript.filesWithIssues.splice(fileIndex, 1);
    }
  } else {
    const fileIndex = baseline.eslint.filesWithIssues.findIndex(
      file => path.resolve(file.file) === normalizedPath,
    );

    if (fileIndex !== -1) {
      const removedFile = baseline.eslint.filesWithIssues[fileIndex];
      baseline.eslint.totalErrors -= removedFile.errors;
      baseline.eslint.totalWarnings -= removedFile.warnings;
      baseline.eslint.filesWithIssues.splice(fileIndex, 1);
    }
  }

  await putFileAsync(BASELINE_FILE, JSON.stringify(baseline, null, 2), "utf8");
}

/**
 * Check if baseline exists
 */
export async function hasBaseline(): Promise<boolean> {
  return (await fileExistsAsync(BASELINE_FILE)) as boolean;
}

/**
 * Clear baseline (reset tracking)
 */
export async function clearBaseline(): Promise<void> {
  const fs = await import("fs/promises");
  try {
    await fs.unlink(BASELINE_FILE);
  } catch (error) {
    // File doesn't exist, that's fine
  }
}
