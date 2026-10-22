import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const EXCLUDED_DIRS = new Set([
  'node_modules', '.venv', 'venv', '__pycache__', '.pytest_cache', '.mypy_cache',
  '.next', '.nuxt', 'dist', 'build', 'target', '.cache', '.git'
]);
export const EXCLUDED_FILE_PATTERNS = [/\.log$/i, /\.tmp$/i, /^\.DS_Store$/];
export const SECRET_FILE_PATTERNS = [/^\.env(\..*)?$/i, /\.pem$/i, /\.key$/i, /^id_rsa$/i];

export function toPosix(value) {
  return String(value).replace(/\\/g, '/');
}

export function normalizePath(value) {
  return path.resolve(String(value));
}

export function pathKey(value) {
  return toPosix(path.resolve(String(value))).replace(/\/+$/, '').toLowerCase();
}

export function isAbsolutePath(value) {
  return typeof value === 'string' && (path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value));
}

export function isSubPath(base, child) {
  const b = path.resolve(base);
  const c = path.resolve(child);
  const rel = path.relative(b, c);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function safeJoin(base, rel) {
  const logical = String(rel).replace(/\\/g, '/');
  if (!logical || logical.startsWith('/') || /^[A-Za-z]:/.test(logical) || logical.includes('\u0000')) {
    throw new Error('unsafe path: ' + rel);
  }
  for (const part of logical.split('/')) {
    if (part === '..' || part === '' || part === '.') throw new Error('unsafe path segment: ' + rel);
    if (/[<>:"|?*]/.test(part)) throw new Error('unsafe path character: ' + rel);
  }
  const joined = path.resolve(base, ...logical.split('/'));
  if (!isSubPath(base, joined)) throw new Error('path escapes base: ' + rel);
  return joined;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return String(bytes);
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return (unit === 0 ? value.toFixed(0) : value.toFixed(1)) + ' ' + units[unit];
}

export async function sha256File(abs) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(abs);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/** Walk a tree, applying the default exclusions. Never follows symlinks/junctions. */
export async function walkTree(root, options = {}) {
  const includeGit = options.includeGit === true;
  const includeSecrets = options.includeSecrets === true;
  const out = {
    files: [], dirs: [], excludedDirs: [], excludedFiles: [], secrets: [],
    symlinks: [], unreadable: []
  };
  async function walk(dir, rel) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (error) {
      out.unreadable.push({ rel: rel || '.', code: error.code || error.message });
      return;
    }
    for (const entry of entries) {
      const relChild = rel ? rel + '/' + entry.name : entry.name;
      const abs = path.join(dir, entry.name);
      let stat;
      try {
        stat = await fsp.lstat(abs);
      } catch (error) {
        out.unreadable.push({ rel: relChild, code: error.code || error.message });
        continue;
      }
      if (stat.isSymbolicLink()) {
        out.symlinks.push(relChild);
        continue;
      }
      if (stat.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name) && !(includeGit && entry.name === '.git')) {
          out.excludedDirs.push(relChild);
          continue;
        }
        out.dirs.push(relChild);
        await walk(abs, relChild);
        continue;
      }
      if (!stat.isFile()) continue;
      if (EXCLUDED_FILE_PATTERNS.some((re) => re.test(entry.name))) {
        out.excludedFiles.push(relChild);
        continue;
      }
      if (!includeSecrets && SECRET_FILE_PATTERNS.some((re) => re.test(entry.name))) {
        out.secrets.push(relChild);
        continue;
      }
      out.files.push({ rel: relChild, abs, size: stat.size, mtimeMs: stat.mtimeMs });
    }
  }
  await walk(root, '');
  out.bytes = out.files.reduce((sum, file) => sum + file.size, 0);
  return out;
}

/** Copy the files described by walkTree into destRoot, preserving relative paths and mtime. */
export async function copyWalkedFiles(scan, destRoot) {
  for (const file of scan.files) {
    const dest = safeJoin(destRoot, file.rel);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.copyFile(file.abs, dest);
    if (Number.isFinite(file.mtimeMs)) {
      const when = new Date(file.mtimeMs);
      await fsp.utimes(dest, when, when).catch(() => {});
    }
  }
}

/** Copy a directory for backup. Symlinks are skipped. */
export async function copyDir(src, dest) {
  await fsp.mkdir(dest, { recursive: true });
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    const stat = await fsp.lstat(from);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) await copyDir(from, to);
    else if (stat.isFile()) {
      await fsp.copyFile(from, to);
      const when = new Date(stat.mtimeMs);
      await fsp.utimes(to, when, when).catch(() => {});
    }
  }
}

export async function pathExists(abs) {
  try {
    await fsp.access(abs);
    return true;
  } catch {
    return false;
  }
}

export async function isNonEmptyDir(abs) {
  try {
    const stat = await fsp.stat(abs);
    if (!stat.isDirectory()) return true;
    const entries = await fsp.readdir(abs);
    return entries.length > 0;
  } catch {
    return false;
  }
}

export async function ensureDir(abs) {
  await fsp.mkdir(abs, { recursive: true });
}

export async function atomicWriteFile(abs, data) {
  const dir = path.dirname(abs);
  await fsp.mkdir(dir, { recursive: true });
  const temp = path.join(dir, '.' + path.basename(abs) + '.' + process.pid + '.' + Date.now() + '.tmp');
  await fsp.writeFile(temp, data);
  let lastError;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await fsp.rename(temp, abs);
      return;
    } catch (error) {
      lastError = error;
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
  await fsp.rm(temp, { force: true }).catch(() => {});
  throw lastError;
}

export async function atomicWriteJson(abs, value) {
  await atomicWriteFile(abs, JSON.stringify(value, null, 2) + '\n');
}

export async function readJson(abs) {
  return JSON.parse(await fsp.readFile(abs, 'utf8'));
}

export function uniqueName(base, used) {
  let candidate = base;
  let index = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = base + '-' + index;
    index += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

export function listDriveRoots() {
  const roots = [];
  for (let code = 67; code <= 90; code += 1) {
    const letter = String.fromCharCode(code);
    const root = letter + ':/';
    try {
      if (fs.existsSync(root)) roots.push(root);
    } catch {
      // ignore
    }
  }
  return roots;
}

export function isDshRunning() {
  try {
    const result = spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      "@(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue).Count"
    ], { encoding: 'utf8', timeout: 10000, windowsHide: true });
    const count = Number.parseInt((result.stdout || '').trim(), 10);
    if (Number.isFinite(count)) return count > 0;
  } catch {
    // fall through
  }
  try {
    const result = spawnSync('tasklist.exe', ['/FI', 'IMAGENAME eq DeepSeek Harness.exe', '/NH', '/FO', 'CSV'], {
      encoding: 'buffer', timeout: 10000, windowsHide: true
    });
    const text = (result.stdout || Buffer.alloc(0)).toString('latin1');
    return /DeepSeek Harness\.exe/i.test(text);
  } catch {
    return false;
  }
}

export function tempDir(prefix) {
  return fsp.mkdtemp(path.join(os.tmpdir(), prefix));
}
