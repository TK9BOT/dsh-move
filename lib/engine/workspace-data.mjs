import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { projectKey } from './project-key.mjs';
import { pickMainLog, readSessionHeader } from './session-log.mjs';
import { walkTree, pathExists, toPosix } from './fsutil.mjs';

export function resolveDshHome(homeArg) {
  const value = homeArg || process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  return path.resolve(value);
}

export function workspaceStatePath(home) {
  return path.join(home, 'storages', 'workspace.json');
}

export async function readWorkspaceState(home) {
  const file = workspaceStatePath(home);
  let text;
  try {
    text = await fsp.readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  const state = JSON.parse(text);
  if (!state || typeof state !== 'object') throw new Error('workspace.json is not an object');
  if (!state.tables || typeof state.tables !== 'object' || !state.tables.workspaces || typeof state.tables.workspaces !== 'object') {
    throw new Error('workspace.json missing tables.workspaces');
  }
  return state;
}

export async function readSessionTitle(home, sessionId) {
  const id = String(sessionId).replace(/^session-/, '');
  const file = path.join(home, 'storages', 'session_projcache', 'sessions', id + '.json');
  try {
    const record = JSON.parse(await fsp.readFile(file, 'utf8'));
    const value = record?.record?.rows?.title?.val;
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

async function listSessionFiles(dir) {
  const files = [];
  const stat = await fsp.lstat(dir);
  if (!stat.isDirectory()) throw new Error('not a session directory: ' + dir);
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  let bytes = 0;
  let mtimeMs = stat.mtimeMs;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const abs = path.join(dir, entry.name);
    const info = await fsp.stat(abs);
    files.push({ rel: entry.name, abs, size: info.size, mtimeMs: info.mtimeMs });
    bytes += info.size;
    if (info.mtimeMs > mtimeMs) mtimeMs = info.mtimeMs;
  }
  return { files, bytes, mtimeMs, names: files.map((file) => file.rel) };
}

export async function sessionInfo(home, sessionId, sessionDir, listed) {
  const files = await listSessionFiles(sessionDir);
  const mainName = pickMainLog(files.names);
  const mainLog = mainName ? path.join(sessionDir, mainName) : null;
  let cwd = null;
  let header = null;
  if (mainLog && mainLog.endsWith('.zstd')) {
    try {
      header = readSessionHeader(await fsp.readFile(mainLog));
      cwd = header && typeof header.cwd === 'string' ? header.cwd : null;
    } catch {
      header = null;
    }
  } else if (mainLog) {
    try {
      const text = await fsp.readFile(mainLog, 'utf8');
      header = JSON.parse(text.split('\n')[0]);
      cwd = header && typeof header.cwd === 'string' ? header.cwd : null;
    } catch {
      header = null;
    }
  }
  return {
    sessionId,
    listed: listed === true,
    title: await readSessionTitle(home, sessionId),
    cwd,
    date: new Date(files.mtimeMs).toISOString(),
    bytes: files.bytes,
    files: files.files.map((file) => file.rel),
    mainLog: mainName,
    dir: sessionDir
  };
}

export async function listWorkspaces(home, options = {}) {
  const state = await readWorkspaceState(home);
  if (!state) throw new Error('workspace.json not found: ' + workspaceStatePath(home));
  const scanProjects = options.scanProjects !== false;
  const workspaces = [];
  for (const [id, record] of Object.entries(state.tables.workspaces)) {
    const title = typeof record.title === 'string' && record.title ? record.title : path.basename(String(record.path || ''));
    const cwd = String(record.path || '');
    let exists = false;
    let project = null;
    let projectError = null;
    try {
      exists = await pathExists(cwd);
      if (exists && scanProjects) {
        const scan = await walkTree(cwd, { includeGit: false, includeSecrets: false });
        project = {
          files: scan.files.length,
          bytes: scan.bytes,
          excludedDirs: scan.excludedDirs.length,
          excludedFiles: scan.excludedFiles.length,
          secrets: scan.secrets.length,
          symlinks: scan.symlinks.length,
          unreadable: scan.unreadable.length,
          unreadableSample: scan.unreadable.slice(0, 20),
          excludedDirSample: scan.excludedDirs.slice(0, 20),
          secretSample: scan.secrets.slice(0, 20)
        };
      }
    } catch (error) {
      projectError = error.message;
    }
    const sessions = [];
    const sessionRoot = path.join(home, 'sessions', projectKey(cwd));
    const found = new Set();
    try {
      for (const entry of await fsp.readdir(sessionRoot, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name.startsWith('session-')) found.add(entry.name);
      }
    } catch {
      // no session folder yet
    }
    const listed = new Set(Array.isArray(record.sessionIds) ? record.sessionIds : []);
    for (const sessionId of listed) found.add(sessionId);
    for (const sessionId of found) {
      const dir = path.join(sessionRoot, sessionId);
      try {
        const info = await sessionInfo(home, sessionId, dir, listed.has(sessionId));
        info.missing = false;
        sessions.push(info);
      } catch {
        sessions.push({
          sessionId, listed: listed.has(sessionId), missing: true, title: null,
          cwd: null, date: record.updatedAt || null, bytes: 0, files: [], mainLog: null, dir
        });
      }
    }
    sessions.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    workspaces.push({
      id,
      title,
      path: cwd,
      pathPosix: toPosix(cwd),
      exists,
      projectError,
      project,
      sessionCount: sessions.length,
      sessions,
      updatedAt: record.updatedAt || null,
      pinned: Array.isArray(state.global?.pinnedSessionIds) && sessions.some((s) => state.global.pinnedSessionIds.includes(s.sessionId)),
      archived: Array.isArray(state.global?.archivedSessionIds) && sessions.some((s) => state.global.archivedSessionIds.includes(s.sessionId))
    });
  }
  workspaces.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  let attachments = { files: 0, bytes: 0, exists: false };
  const attachmentRoot = path.join(home, 'attachments');
  if (await pathExists(attachmentRoot)) {
    const scan = await walkTree(attachmentRoot, { includeSecrets: true });
    attachments = { files: scan.files.length, bytes: scan.bytes, exists: true };
  }
  return {
    format: 'dsh-move-workspace-list/1',
    home: toPosix(home),
    generatedAt: new Date().toISOString(),
    workspaces,
    attachments
  };
}

export function workspaceByTitle(list, title) {
  return list.workspaces.find((workspace) => workspace.title === title) || null;
}

export function findWorkspaceByPath(state, targetPath) {
  const key = toPosix(path.resolve(targetPath)).replace(/\/+$/, '').toLowerCase();
  for (const [id, record] of Object.entries(state.tables.workspaces)) {
    const recordKey = toPosix(path.resolve(String(record.path || ''))).replace(/\/+$/, '').toLowerCase();
    if (recordKey === key) return { id, record };
  }
  return null;
}

export function findWorkspaceByTitle(state, title) {
  for (const [id, record] of Object.entries(state.tables.workspaces)) {
    if (record.title === title) return { id, record };
  }
  return null;
}

export function findWorkspacesByTitle(state, title) {
  const matches = [];
  for (const [id, record] of Object.entries(state.tables.workspaces)) {
    if (record.title === title) matches.push({ id, record });
  }
  return matches;
}

export function sessionProjectKey(cwd) {
  return projectKey(cwd);
}

export function dshSessionRoot(home) {
  return path.join(home, 'sessions');
}
