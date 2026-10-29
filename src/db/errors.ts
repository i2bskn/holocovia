// D1 errors may be wrapped (e.g. DrizzleQueryError), so the cause chain is followed.
// Keep in the same shape as isUniqueViolation.
export function isForeignKeyViolation(error: unknown): boolean {
  for (let e: unknown = error; e instanceof Error; e = e.cause) {
    if (e.message.includes("FOREIGN KEY constraint failed")) return true;
  }
  return false;
}
