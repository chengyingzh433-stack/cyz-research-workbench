import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep } from 'node:path';

export function projectPath(root: string, path: string, internal = false): string {
  if (!path || path.includes('\\') || path.startsWith('/') || path.length > 220) throw new Error('INVALID_PATH');
  const parts = path.split('/');
  if (parts.some(p => !p || p === '.' || p === '..' || /[<>:"|?*\x00-\x1f]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) throw new Error('INVALID_PATH');
  if (!internal && parts[0].toLowerCase() === '.cyz') throw new Error('INVALID_PATH');
  const canonical = realpathSync(root);
  let cursor = canonical;
  for (const part of parts) {
    cursor = resolve(cursor, part);
    if (existsSync(cursor)) {
      if (lstatSync(cursor).isSymbolicLink()) throw new Error('INVALID_PATH');
      const rel = relative(canonical, realpathSync(cursor));
      if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep)) throw new Error('INVALID_PATH');
    }
  }
  return cursor;
}
