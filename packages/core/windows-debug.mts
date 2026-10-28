import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CompilerSession } from "./src/tooling/typescript/compiler";

const root = mkdtempSync(path.join(os.tmpdir(), "dbg-"));
mkdirSync(path.join(root, "src"));
writeFileSync(path.join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, target: "ES2022", module: "ESNext", moduleResolution: "Bundler", types: [] }, include: ["src"] }));
writeFileSync(path.join(root, "src/math.ts"), "export function double(v: number): number { return v * 2; }\n");
writeFileSync(path.join(root, "src/use.ts"), 'import { double } from "./math";\nexport const r = double(2);\n');
const session = new CompilerSession(root, path.join(root, "tsconfig.json"));
console.log("root", root);
console.log("fileNames", session.fileNames);
for (const f of session.fileNames.filter((f) => f.includes("use.ts"))) {
  console.log("importFiles", f, session.importFiles(f));
  console.log("importFiles(posix)", session.importFiles(f.replaceAll("\\", "/")));
}
session.close();
