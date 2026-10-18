import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolve as resolveModule } from "import-meta-resolve";
import type { Measurement, ModelContract, ToolConfig } from "@warlock.js/ai";
import type { CommandActionData } from "../../../commands/types";
import { withConsoleOnStderr } from "../routes/with-console-on-stderr";

type ModuleExports = Record<string, unknown>;
type MeasureModule = Pick<typeof import("@warlock.js/ai"), "measure" | "skills">;
type ModuleLoader = (specifier: string) => Promise<ModuleExports>;
type SDKConstructor = new (config: { apiKey: string }) => {
  model(config: { name: string; api?: "responses" }): ModelContract;
};

/** Resolve from the caller's project, including optional provider packages. */
export async function loadMeasureModule(
  specifier: string,
  cwd = process.cwd(),
): Promise<ModuleExports> {
  const parent = pathToFileURL(path.join(cwd, "package.json")).href;
  return import(resolveModule(specifier, parent));
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isMeasureModule(value: ModuleExports): value is ModuleExports & MeasureModule {
  return typeof value.measure === "function" && typeof value.skills === "function";
}

function isModel(value: unknown): value is ModelContract {
  return (
    object(value) &&
    typeof value.name === "string" &&
    typeof value.provider === "string" &&
    typeof value.complete === "function" &&
    typeof value.stream === "function" &&
    (value.countTokens === undefined || typeof value.countTokens === "function") &&
    (value.pricing === undefined ||
      (object(value.pricing) &&
        typeof value.pricing.input === "number" &&
        Number.isFinite(value.pricing.input) &&
        value.pricing.input >= 0 &&
        typeof value.pricing.output === "number" &&
        Number.isFinite(value.pricing.output) &&
        value.pricing.output >= 0))
  );
}

function isTool(value: unknown): value is ToolConfig<unknown, unknown> {
  return (
    object(value) &&
    typeof value.name === "string" &&
    typeof value.description === "string" &&
    typeof value.execute === "function" &&
    (value.input === undefined ||
      (object(value.input) &&
        object(value.input["~standard"]) &&
        typeof value.input["~standard"].validate === "function"))
  );
}

/** SDK constructor/model signatures verified against the first-party adapter sources. */
export async function resolveMeasureModel(
  id: string,
  modelModule: string | undefined,
  load: ModuleLoader = loadMeasureModule,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ModelContract> {
  if (modelModule) {
    const exported = await load(modelModule);
    const model: unknown =
      typeof exported.resolveModel === "function"
        ? await exported.resolveModel(id)
        : (exported.model ?? exported.default);
    if (!isModel(model))
      throw new Error("--model-module must export a model or resolveModel(id) returning a model.");
    return model;
  }
  const separator = id.indexOf(":");
  const provider = separator < 0 ? "openai" : id.slice(0, separator);
  const name = separator < 0 ? id : id.slice(separator + 1);
  const adapters: Record<string, { package: string; sdk: string; key: string }> = {
    openai: { package: "@warlock.js/ai-openai", sdk: "OpenAISDK", key: "OPENAI_API_KEY" },
    anthropic: {
      package: "@warlock.js/ai-anthropic",
      sdk: "AnthropicSDK",
      key: "ANTHROPIC_API_KEY",
    },
    google: { package: "@warlock.js/ai-google", sdk: "GoogleSDK", key: "GEMINI_API_KEY" },
  };
  const adapter = Object.hasOwn(adapters, provider) ? adapters[provider] : undefined;
  if (!adapter || !name)
    throw new Error(
      "Use a model ID, openai:<id>, anthropic:<id>, google:<id>, or --model-module for a custom provider.",
    );
  const apiKey = env[adapter.key];
  if (!apiKey)
    throw new Error(`Set ${adapter.key}, or supply a configured model with --model-module.`);
  let exported: ModuleExports;
  try {
    exported = await load(adapter.package);
  } catch (cause) {
    throw new Error(
      `Cannot load ${adapter.package}. Install it in this project or use --model-module.`,
      { cause },
    );
  }
  const Constructor = exported[adapter.sdk];
  if (typeof Constructor !== "function")
    throw new Error(`${adapter.package} does not export ${adapter.sdk}.`);
  const sdk = new (Constructor as SDKConstructor)({ apiKey });
  // The Responses adapter exposes countTokens; the Chat adapter does not.
  const model = sdk.model({
    name,
    ...(provider === "openai" ? { api: "responses" as const } : {}),
  });
  if (!isModel(model)) throw new Error(`${adapter.package} returned an invalid model.`);
  return model;
}

export function formatMeasurement(report: Measurement): string {
  const lines = [
    `${report.provider}:${report.model} — input per call`,
    "Part\tTokens\tSource\tUSD",
  ];
  const row = (name: string, part: Measurement["total"]) =>
    `${name}\t${part.tokens}\t${part.source}\t${part.costUSD === undefined ? "unknown" : part.costUSD.toFixed(8)}`;
  for (const [name, part] of Object.entries(report.parts)) lines.push(row(name, part));
  lines.push(row("total", report.total));
  if (report.probe) lines.push('Messages include a user probe: "."');
  lines.push(
    "USD uses uncached input pricing; output, cache adjustments and hosted-tool fees are excluded.",
  );
  return lines.join("\n");
}

export async function aiCommandAction(
  { args, options }: CommandActionData,
  dependencies: { load?: ModuleLoader; cwd?: string } = {},
): Promise<void> {
  if (args.length !== 1 || args[0] !== "measure")
    throw new Error(
      "Usage: warlock ai measure --model <id> [--tools <module>] [--system <file>] [--skills <dir>] [--json]",
    );
  const stringOption = (name: string, required = false): string | undefined => {
    const value = options[name];
    if (value === undefined && !required) return undefined;
    if (typeof value !== "string" || !value.trim())
      throw new Error(
        `--${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} requires a value.`,
      );
    return value;
  };
  const id = stringOption("model", true);
  if (!id) throw new Error("--model is required.");
  const modelModule = stringOption("modelModule");
  const toolsModule = stringOption("tools");
  const systemFile = stringOption("system");
  const skillsDir = stringOption("skills");
  const cwd = dependencies.cwd ?? process.cwd();
  const load = dependencies.load ?? ((specifier) => loadMeasureModule(specifier, cwd));
  const calculate = async (): Promise<Measurement> => {
    let exported: ModuleExports;
    try {
      exported = await load("@warlock.js/ai");
    } catch (cause) {
      throw new Error(
        "Cannot load @warlock.js/ai. Install it in this project to use warlock ai measure.",
        { cause },
      );
    }
    // The optional peer stays behind the action; unrelated CLI commands never import AI.
    if (!isMeasureModule(exported)) {
      throw new Error("warlock ai measure requires @warlock.js/ai 5.33.0 or newer.");
    }
    const aiPackage = exported;
    const model = await resolveMeasureModel(id, modelModule, load);
    let tools: ToolConfig<unknown, unknown>[] = [];
    if (toolsModule) {
      const module = await load(toolsModule);
      const entries: unknown = module.tools ?? module.default;
      if (!Array.isArray(entries) || !entries.every(isTool))
        throw new Error("--tools must export an array of tool configs as tools or default.");
      tools = entries;
    }
    const system = systemFile ? await readFile(path.resolve(cwd, systemFile), "utf8") : undefined;
    let skills: ReturnType<typeof aiPackage.skills> | undefined;
    if (skillsDir) {
      const directory = path.resolve(cwd, skillsDir);
      if (!(await stat(directory)).isDirectory())
        throw new Error("--skills must name a directory.");
      skills = aiPackage.skills({
        name: "measured-skills",
        sources: [{ type: "directory", path: directory }],
      });
    }
    return aiPackage.measure({ model, tools, system, skills });
  };
  const report = options.json === true ? await withConsoleOnStderr(calculate) : await calculate();
  console.log(options.json === true ? JSON.stringify(report, null, 2) : formatMeasurement(report));
}
