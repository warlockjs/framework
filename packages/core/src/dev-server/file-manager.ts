import path from "path";
import { srcPath } from "../utils";
import { FileHealth } from "./file-health";
import type { FileLayer } from "./types";

export class FileManager {
  /**
   * Current file contents
   */
  private fileContents = "";

  /**
   * Last modified time
   */
  private lastModifiedTime = 0;

  /**
   * Relative path to src directory
   */
  private relativePath = "";

  /**
   * File health state
   */
  private health: FileHealth | null = null;

  /**
   * Constructor
   */
  public constructor(
    private readonly fullPath: string,
    private readonly layer: FileLayer,
  ) {
    this.relativePath = path
      .relative(srcPath(), this.fullPath)
      .replace(/\\/g, "/");
  }

  /**
   * Set file contents
   */
  public setContents(contents: string) {
    this.fileContents = contents;
  }

  /**
   * Get file contents
   */
  public getContents() {
    return this.fileContents;
  }

  /**
   * Get file health state
   */
  public get healthState() {
    if (!this.health) {
      this.health = new FileHealth(this);
    }

    return this.health;
  }
}
