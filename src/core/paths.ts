/** Parent of a desktop file path, without importing Node into the renderer. */
export function parentDirectory(path: string): string {
  const separator = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  if (separator < 0) return '.';
  if (separator === 0 || separator === 2 && /^[a-z]:/i.test(path)) return path.slice(0, separator + 1);
  return path.slice(0, separator);
}
