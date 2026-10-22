import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { sha256File, atomicWriteFile } from './fsutil.mjs';

export function findTar() {
  const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
  const candidate = path.join(systemRoot, 'System32', 'tar.exe');
  if (fs.existsSync(candidate)) return candidate;
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const file = path.join(dir, 'tar.exe');
    if (fs.existsSync(file)) return file;
  }
  throw new Error('tar.exe not found (Windows 10 1803+ required)');
}

function tempFile(suffix) {
  return path.join(os.tmpdir(), 'dsh-tar-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(16).slice(2) + suffix);
}

/** Run tar without piped stdio (Windows sandbox-safe), writing stdout/stderr to files. */
function runTar(args, options = {}) {
  const tar = findTar();
  const stdoutFile = options.stdoutFile || null;
  const stderrFile = options.stderrFile || tempFile('.err');
  const outFd = stdoutFile ? fs.openSync(stdoutFile, 'w') : 'ignore';
  const errFd = fs.openSync(stderrFile, 'w');
  let result;
  try {
    result = spawnSync(tar, args, {
      stdio: ['ignore', outFd, errFd],
      windowsHide: true,
      timeout: options.timeout || 30 * 60 * 1000
    });
  } finally {
    if (typeof outFd === 'number') fs.closeSync(outFd);
    fs.closeSync(errFd);
  }
  let stderr = '';
  try { stderr = fs.readFileSync(stderrFile, 'utf8'); } catch {}
  if (!options.keepStderr) fs.rmSync(stderrFile, { force: true });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error('tar failed (' + result.status + '): ' + stderr.slice(0, 2000));
  }
  return { status: result.status, stderr };
}

export async function createTarGz(stagingDir, outFile, entries) {
  const partial = outFile + '.partial';
  await fsp.rm(partial, { force: true }).catch(() => {});
  const existing = entries.filter((entry) => fs.existsSync(path.join(stagingDir, entry)));
  if (existing.length === 0) throw new Error('nothing to archive');
  runTar(['-c', '-z', '-f', partial, '--format=pax', '-C', stagingDir, ...existing]);
  await fsp.rename(partial, outFile);
  const sha = await sha256File(outFile);
  await atomicWriteFile(outFile + '.sha256', sha + '  ' + path.basename(outFile) + '\n');
  return { file: outFile, sha256: sha, bytes: (await fsp.stat(outFile)).size };
}

export function listTarVerbose(archive) {
  const out = tempFile('.out');
  try {
    runTar(['-t', '-v', '-f', archive], { stdoutFile: out });
    return fs.readFileSync(out, 'utf8').split(/\r?\n/).filter(Boolean);
  } finally {
    fs.rmSync(out, { force: true });
  }
}

export function assertSafeArchive(archive) {
  for (const line of listTarVerbose(archive)) {
    const kind = line.charAt(0);
    if (kind === 'l' || kind === 'h' || kind === 'c' || kind === 'b' || kind === 'p' || kind === 's') throw new Error('archive contains a link/device/special entry; refusing to extract');
  }
  for (const name of listTar(archive)) {
    const normalized = name.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!normalized.trim()) continue;
    if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) throw new Error('archive contains an absolute path: ' + name);
    if (normalized.includes(String.fromCharCode(0))) throw new Error('archive path contains NUL');
    for (const part of normalized.split('/')) {
      if (!part) continue;
      if (part === '..') throw new Error('archive path escapes root: ' + name);
      if (part.includes(':')) throw new Error('archive path contains a drive/ADS separator: ' + name);
    }
  }
}

export function extractTarGz(archive, destDir) {
  assertSafeArchive(archive);
  fs.mkdirSync(destDir, { recursive: true });
  runTar(['-x', '-z', '-f', archive, '-C', destDir]);
}

export function readTarEntry(archive, entry) {
  const out = tempFile('.out');
  try {
    runTar(['-x', '-O', '-f', archive, entry], { stdoutFile: out });
    return fs.readFileSync(out, 'utf8');
  } finally {
    fs.rmSync(out, { force: true });
  }
}

export function listTar(archive) {
  const out = tempFile('.out');
  try {
    runTar(['-t', '-f', archive], { stdoutFile: out });
    return fs.readFileSync(out, 'utf8').split(/\r?\n/).filter(Boolean);
  } finally {
    fs.rmSync(out, { force: true });
  }
}

export async function readShaSidecar(archive) {
  try {
    const text = await fsp.readFile(archive + '.sha256', 'utf8');
    const match = text.match(/[a-fA-F0-9]{64}/);
    return match ? match[0].toLowerCase() : null;
  } catch {
    return null;
  }
}

export async function verifyArchiveSha(archive) {
  const expected = await readShaSidecar(archive);
  const actual = await sha256File(archive);
  if (expected && expected !== actual) {
    throw new Error('archive SHA256 mismatch: expected ' + expected + ', got ' + actual);
  }
  return { sha256: actual, expected, verified: Boolean(expected) };
}
