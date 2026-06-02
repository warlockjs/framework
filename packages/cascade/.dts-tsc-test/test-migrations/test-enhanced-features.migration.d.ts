import { Migration } from "../migration/migration";
/**
 * Test migration to verify all new features:
 * - primaryUuid() shorthand
 * - default() with raw SQL
 * - defaultString() for literal strings
 * - timestamps() driver delegation
 * - statement() for raw SQL (queued operations)
 */
export default class TestEnhancedMigrationFeatures extends Migration {
    table: string;
    up(): Promise<void>;
    down(): Promise<void>;
}
//# sourceMappingURL=test-enhanced-features.migration.d.ts.map