import type { Migration } from "./types";

export class MigrationOffice {
  /**
   * Migrations list
   */
  protected migrations: Migration[] = [];

  /**
   * Register a migration
   */
  public register(migration: Migration) {
    this.migrations.push(migration);

    return this;
  }

  /**
   * Get all migrations
   */
  public list() {
    return this.migrations;
  }

  /**
   * Get blueprints only
   */
  public blueprints() {
    return this.migrations.map(migration => migration.blueprint);
  }
}

export const migrationOffice = new MigrationOffice();
