import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathKey, isSubPath, toPosix, listDriveRoots } from './fsutil.mjs';
import { readWorkspaceState } from './workspace-data.mjs';

const SKIP_DIRS = new Set([
  'windows', 'program files', 'program files (x86)', 'programdata', 'appdata',
  'application data', 'local settings', 'recent', 'sendto', 'templates', 'cookies',
  'netHood', 'printhood', 'start menu', 'temporary internet files',
  '$recycle.bin', 'system volume information', 'node_modules', '.dsh', '.git',
  '.venv', 'venv', '__pycache__', 'dist', 'build', 'target', '.cache', 'onedrivetemp'
].map((value) => value.toLowerCase()));

function safeTitleBase(title) {
  return String(title || '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim();
}

async function addCandidate(candidates, seen, value, source, score, exists) {
  const abs = path.resolve(value);
  const key = pathKey(abs);
  if (seen.has(key)) return;
  seen.add(key);
  let mtime = null;
  let isDir = false;
  try {
    const stat = await fsp.stat(abs);
    isDir = stat.isDirectory();
    mtime = stat.mtimeMs;
  } catch {
    // missing is allowed for the default target path
  }
  const present = exists === undefined ? isDir : Boolean(exists);
  candidates.push({
    path: toPosix(abs),
    source,
    exists: present,
    mtime: mtime ? new Date(mtime).toISOString() : null,
    score: score + (isDir ? 10 : 0) + (present ? 5 : 0)
  });
}

async function scanRoots(title, home, deadline, warnings) {
  const wanted = title.toLowerCase();
  const found = [];
  const seen = new Set();
  const homeDir = os.homedir();
  const userRoots = [homeDir, path.join(homeDir, 'Desktop'), path.join(homeDir, 'Documents'), path.join(homeDir, 'Downloads'), path.join(homeDir, 'OneDrive')];
  const roots = [];
  for (const root of userRoots) roots.push({ root, depth: root === homeDir ? 2 : 3, source: 'scan' });
  for (const root of listDriveRoots()) roots.push({ root, depth: 2, source: 'scan-drive' });

  async function visit(dir, depth, maxDepth) {
    if (Date.now() > deadline) {
      warnings.push('扫描超时，结果可能不完整');
      return;
    }
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (Date.now() > deadline) {
        warnings.push('扫描超时，结果可能不完整');
        return;
      }
      if (!entry.isDirectory()) continue;
      const lower = entry.name.toLowerCase();
      if (SKIP_DIRS.has(lower)) continue;
      const abs = path.join(dir, entry.name);
      let stat;
      try {
        stat = await fsp.lstat(abs);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) continue;
      if (lower === wanted) {
        const key = pathKey(abs);
        if (!seen.has(key)) {
          seen.add(key);
          found.push({ path: toPosix(abs), mtime: new Date(stat.mtimeMs).toISOString(), source: 'scan' });
        }
      }
      if (depth < maxDepth) await visit(abs, depth + 1, maxDepth);
    }
  }

  for (const { root, depth, source } of roots) {
    if (Date.now() > deadline) break;
    try {
      const stat = await fsp.lstat(root);
      if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
    } catch {
      continue;
    }
    const before = found.length;
    await visit(root, 1, depth);
    for (let i = before; i < found.length; i += 1) found[i].source = source;
  }
  return found;
}

/**
 * Recommend target paths for a workspace: existing target workspace first,
 * then the restore root, then same-named directories found by a bounded scan.
 */
export async function scanWorkspacePaths({ home, title, targetRoot }) {
  const candidates = [];
  const seen = new Set();
  const warnings = [];
  const state = await readWorkspaceState(home).catch(() => null);
  if (state) {
    for (const record of Object.values(state.tables.workspaces)) {
      if (record.title !== title) continue;
      await addCandidate(candidates, seen, record.path, 'workspace', 1000, undefined);
    }
  }
  const root = path.resolve(targetRoot || path.join(os.homedir(), 'Desktop', 'DSH-Move'));
  const base = safeTitleBase(title) || 'workspace';
  await addCandidate(candidates, seen, path.join(root, base), 'target-root', 900, undefined);
  const deadline = Date.now() + 5000;
  const scanned = await scanRoots(title, home, deadline, warnings);
  for (const item of scanned) {
    await addCandidate(candidates, seen, item.path, item.source, 500, true);
    const candidate = candidates[candidates.length - 1];
    if (candidate && item.mtime) candidate.mtime = item.mtime;
  }
  candidates.sort((a, b) => b.score - a.score || String(b.mtime || '').localeCompare(String(a.mtime || '')));
  if (candidates.length > 0) candidates[0].recommended = true;
  return {
    format: 'dsh-move-scan/1',
    title,
    targetRoot: toPosix(root),
    candidates,
    warnings
  };
}

export function isInsideDshHome(dshHome, candidate) {
  return isSubPath(dshHome, candidate);
}
