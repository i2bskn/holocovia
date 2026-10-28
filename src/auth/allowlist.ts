export function parseAllowlist(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== "");
}

// `email` must already be normalized. An empty list allows everyone.
export function isEmailAllowed(email: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return true;
  const normalized = email.toLowerCase();
  const domain = normalized.slice(normalized.lastIndexOf("@") + 1);
  return allowlist.some((entry) => (entry.includes("@") ? entry === normalized : entry === domain));
}
