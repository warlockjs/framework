/**
 * Build a migration filename timestamp prefix in the framework's
 * MM-DD-YYYY_HH-MM-SS form. Cascade infers a migration's createdAt from this
 * prefix and orders migrations deterministically by it. Pass `offsetSeconds` to
 * stamp sibling migrations created in the same scaffold a second apart so they
 * never collide and keep a stable relative order.
 */
export function migrationTimestamp(offsetSeconds = 0): string {
  const now = new Date(Date.now() + offsetSeconds * 1000);
  const pad = (value: number) => String(value).padStart(2, "0");

  return (
    `${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${now.getFullYear()}_` +
    `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
  );
}
