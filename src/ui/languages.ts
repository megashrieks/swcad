/** The language a package file opens in, by extension. Kept free of Monaco itself so the
 * editor chunk stays lazy. */
export function languageFor(file: string): string {
  const ext = file.slice(file.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'json') return 'json';
  if (ext === 'js' || ext === 'mjs' || ext === 'cjs') return 'javascript';
  if (ext === 'ts') return 'typescript';
  if (ext === 'svg' || ext === 'xml' || ext === 'html') return 'xml';
  if (ext === 'css') return 'css';
  if (ext === 'md') return 'markdown';
  return 'plaintext';
}
