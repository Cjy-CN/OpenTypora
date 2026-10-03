/** Explorer passes a quoted file path as one argument; do not split paths on spaces. */
export function launchDocument(argv: readonly string[], packaged: boolean): string | undefined {
  const explicit = argv.indexOf('--document');
  if (explicit >= 0) return argv[explicit + 1];
  return argv.slice(packaged ? 1 : 2).find(value => !value.startsWith('--') && /\.(?:md|markdown|mdx|txt|rmd|qmd)$/i.test(value));
}
