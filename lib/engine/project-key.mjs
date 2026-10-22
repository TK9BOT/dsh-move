import { createHash } from 'node:crypto';

/** Exact DSH projectKey(cwd) algorithm (session project directory name). */
export function projectKey(cwd) {
  if (typeof cwd !== 'string' || cwd.length === 0) {
    throw new Error('projectKey requires a non-empty path');
  }
  let readable = '';
  let separatorRun = false;
  for (const ch of cwd) {
    const code = ch.charCodeAt(0);
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-';
      separatorRun = true;
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch;
      separatorRun = false;
    } else {
      readable += '~' + code.toString(16).toUpperCase().padStart(4, '0');
      separatorRun = false;
    }
  }
  return '--' + ((readable.replace(/^-+/, '') || 'root').slice(0, 251)) + '--';
}

/** Archive folder name derived from a workspace title. Keeps CJK, strips Windows-invalid chars. */
export function safeTitle(title, max = 80) {
  let out = String(title ?? 'workspace').normalize('NFC');
  out = out.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
  out = out.replace(/[. ]+$/g, '').trim();
  if (!out) out = 'workspace';
  if (out.length > max) {
    const digest = createHash('sha256').update(out).digest('hex').slice(0, 8);
    out = out.slice(0, max - 9) + '-' + digest;
  }
  return out;
}

/** Stable short hash used when two workspaces share a title. */
export function shortHash(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 8);
}
