export type LayerType = "FSR" | "HMR";
export type FileType =
  | "main"
  | "config"
  | "event"
  | "route"
  | "controller"
  | "service"
  | "model"
  | "other";

export type FileManifest = {
  absolutePath: string;
  relativePath: string;
  lastModified: number;
  hash: string;
  dependencies: string[];
  dependents: string[];
  version: number;
  type: FileType;
  layer: LayerType;
  cachePath: string;
};

export type FileState = "idle" | "loading" | "ready" | "error" | "updating" | "deleted";
