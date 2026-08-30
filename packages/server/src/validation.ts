import type { ZodError } from "zod";

/**
 * Zod's own message is a JSON dump of every issue — fine in a log, useless in a
 * dialog. Render the first few as "field: what's wrong" instead.
 */
export function formatZodError(error: ZodError, limit = 3): string {
  const issues = error.issues.slice(0, limit).map((i) => {
    const where = i.path.length ? `${i.path.join(".")}: ` : "";
    return `${where}${i.message}`;
  });
  const rest = error.issues.length - issues.length;
  return issues.join("; ") + (rest > 0 ? ` (and ${rest} more)` : "");
}
