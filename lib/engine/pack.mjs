import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { safeTitle, shortHash, projectKey } from './project-key.mjs';
import { walkTree, copyWalkedFiles, pathExists, isAbsolutePath, toPosix, atomicWriteJson, tempDir } from './fsutil.mjs';
import { readWorkspaceState, listWorkspaces, sessionInfo, readSessionTitle } from './workspace-data.mjs';
import { sanitizeSessionBuffer, isSessionLogName } from './session-log.mjs';
import { createTarGz } from './archive.mjs';

async function copyExtraTree(source, dest) {
  await fsp.mkdir(dest, { recursive: true });
  for (const entry of await fsp.readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(dest, entry.name);
    const stat = await fsp.lstat(from);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) await copyExtraTree(from, to);
    else if (stat.isFile()) { await fsp.mkdir(path.dirname(to), { recursive: true }); await fsp.copyFile(from, to); }
  }
}

function selectedWorkspaceMap(request) {
  const map = new Map();
  for (const item of Array.isArray(request.workspaces) ? request.workspaces : []) {
    if (!item || typeof item.title !== 'string') continue;
    map.set(item.title, { title: item.title, includeProject: item.includeProject !== false });
  }
  return map;
}

function selectedSessionKeys(request) {
  const out = [];
  for (const item of Array.isArray(request.sessions) ? request.sessions : []) {
    if (!item || typeof item.workspaceTitle !== 'string' || typeof item.sessionId !== 'string') continue;
    out.push({ workspaceTitle: item.workspaceTitle, sessionId: item.sessionId });
  }
  return out;
}

async function attachmentScan(home) {
  const root = path.join(home, 'attachments');
  if (!(await pathExists(root))) return { root, scan: null, files: 0, bytes: 0 };
  const scan = await walkTree(root, { includeSecrets: true, includeGit: true });
  return { root, scan, files: scan.files.length, bytes: scan.bytes };
}

/**
 * Build a full pack plan without writing any file. The plan carries the scanned
 * file lists so pack can copy exactly what the user reviewed.
 */
export async function planPack(home, request) {
  const state = await readWorkspaceState(home);
  if (!state) throw new Error('workspace.json not found');
  const wanted = selectedWorkspaceMap(request);
  const sessionKeys = selectedSessionKeys(request);
  if (wanted.size === 0 && sessionKeys.length === 0) throw new Error('no workspaces or sessions selected');
  const includeGit = request.includeGit === true;
  const includeSecrets = request.includeSecrets === true;
  const includeAttachments = request.includeAttachments === true && sessionKeys.length > 0;
  const allowUnreadable = request.allowUnreadable === true;

  const workspaces = [];
  const workspaceRecords = new Map();
  for (const [title, record] of Object.entries(state.tables.workspaces)) {
    if (!workspaceRecords.has(record.title)) workspaceRecords.set(record.title, []);
    workspaceRecords.get(record.title).push({ id: title, record });
  }
  const usedSafe = new Set();
  const titleToSafe = new Map();
  const unreadable = [];
  const warnings = [];

  for (const [title, selection] of wanted.entries()) {
    const records = workspaceRecords.get(title) || [];
    if (records.length === 0) throw new Error('workspace not found: ' + title);
    if (records.length > 1) warnings.push('duplicate workspace title: ' + title);
    const base = safeTitle(title);
    let safe = base;
    if (usedSafe.has(safe.toLowerCase())) safe = base + '-' + shortHash(records[0].record.path || title);
    usedSafe.add(safe.toLowerCase());
    titleToSafe.set(title, safe);
    const record = records[0].record;
    const sourcePath = String(record.path || '');
    let scan = null;
    if (selection.includeProject) {
      if (!isAbsolutePath(sourcePath)) throw new Error('workspace path is not absolute: ' + title);
      if (!(await pathExists(sourcePath))) throw new Error('workspace path missing: ' + sourcePath);
      scan = await walkTree(sourcePath, { includeGit, includeSecrets });
      unreadable.push(...scan.unreadable.map((item) => ({ workspace: title, rel: item.rel, code: item.code })));
    }
    workspaces.push({
      title,
      safeTitle: safe,
      id: records[0].id,
      sourcePath: toPosix(sourcePath),
      includeProject: selection.includeProject,
      scan,
      files: scan ? scan.files.length : 0,
      bytes: scan ? scan.bytes : 0,
      excludedDirs: scan ? scan.excludedDirs.length : 0,
      excludedFiles: scan ? scan.excludedFiles.length : 0,
      secrets: scan ? scan.secrets.length : 0,
      symlinks: scan ? scan.symlinks.length : 0,
      unreadable: scan ? scan.unreadable.length : 0
    });
  }

  for (const key of sessionKeys) {
    if (wanted.has(key.workspaceTitle)) continue;
    const records = workspaceRecords.get(key.workspaceTitle) || [];
    if (records.length === 0) throw new Error('workspace not found for session: ' + key.workspaceTitle);
    const record = records[0].record;
    const base = safeTitle(key.workspaceTitle);
    let safe = base;
    if (usedSafe.has(safe.toLowerCase())) safe = base + '-' + shortHash(record.path || key.workspaceTitle);
    usedSafe.add(safe.toLowerCase());
    titleToSafe.set(key.workspaceTitle, safe);
    wanted.set(key.workspaceTitle, { title: key.workspaceTitle, includeProject: false });
    workspaces.push({
      title: key.workspaceTitle,
      safeTitle: safe,
      id: records[0].id,
      sourcePath: toPosix(String(record.path || '')),
      includeProject: false,
      scan: null,
      files: 0,
      bytes: 0,
      excludedDirs: 0,
      excludedFiles: 0,
      secrets: 0,
      symlinks: 0,
      unreadable: 0
    });
  }

  const sessions = [];
  const sessionRoot = path.join(home, 'sessions');
  for (const key of sessionKeys) {
    const records = workspaceRecords.get(key.workspaceTitle) || [];
    if (records.length === 0) throw new Error('workspace not found for session: ' + key.workspaceTitle);
    const record = records[0].record;
    const safe = titleToSafe.get(key.workspaceTitle) || safeTitle(key.workspaceTitle);
    const sourceCwd = String(record.path || '');
    const dir = path.join(sessionRoot, projectKey(sourceCwd), key.sessionId);
    if (!(await pathExists(dir))) throw new Error('session directory missing: ' + key.workspaceTitle + ' / ' + key.sessionId);
    const info = await sessionInfo(home, key.sessionId, dir, true);
    const shortId = key.sessionId.replace(/^session-/, '');
    const projcacheSource = path.join(home, 'storages', 'session_projcache', 'sessions', shortId + '.json');
    let projcache = null;
    if (await pathExists(projcacheSource)) {
      const cacheStat = await fsp.stat(projcacheSource);
      projcache = { source: projcacheSource, shortId, bytes: cacheStat.size, mtimeMs: cacheStat.mtimeMs };
    }
    sessions.push({
      workspaceTitle: key.workspaceTitle,
      safeTitle: safe,
      sessionId: key.sessionId,
      title: info.title,
      date: info.date,
      sourceCwd: toPosix(sourceCwd),
      sourceProjectKey: projectKey(sourceCwd),
      files: info.files.length,
      bytes: info.bytes,
      dir,
      fileNames: info.files,
      mainLog: info.mainLog,
      hasProjcache: Boolean(projcache),
      projcacheBytes: projcache ? projcache.bytes : 0,
      projcacheSource: projcache ? projcache.source : null,
      projcacheShortId: projcache ? projcache.shortId : null,
      pinned: Array.isArray(state.global?.pinnedSessionIds) && state.global.pinnedSessionIds.includes(key.sessionId),
      archived: Array.isArray(state.global?.archivedSessionIds) && state.global.archivedSessionIds.includes(key.sessionId)
    });
  }

  let attachments = { files: 0, bytes: 0, scan: null, root: null };
  if (includeAttachments) {
    attachments = await attachmentScan(home);
    unreadable.push(...(attachments.scan?.unreadable || []).map((item) => ({ workspace: 'attachments', rel: item.rel, code: item.code })));
  }

  if (unreadable.length > 0 && !allowUnreadable) {
    const error = new Error('unreadable items: ' + unreadable.length + ' (set allowUnreadable to skip them)');
    error.code = 'UNREADABLE_ITEMS';
    error.items = unreadable;
    throw error;
  }
  const output = path.resolve(String(request.output || '').trim() || path.join(os.homedir(), 'Desktop', 'DSH-Move', 'workspaces-' + new Date().toISOString().replace(/[:.]/g, '-') + '.tar.gz'));
  if (!isAbsolutePath(output)) throw new Error('output path must be absolute');
  if (!output.toLowerCase().endsWith('.tar.gz')) throw new Error('output must end with .tar.gz');
  return {
    format: 'dsh-move-pack-plan/1',
    home: toPosix(home),
    workspaces,
    sessions,
    attachments,
    includeAttachments,
    includeGit,
    includeSecrets,
    allowUnreadable,
    unreadable,
    warnings,
    output: toPosix(output),
    totals: {
      projectFiles: workspaces.reduce((sum, item) => sum + item.files, 0),
      projectBytes: workspaces.reduce((sum, item) => sum + item.bytes, 0),
      sessionFiles: sessions.reduce((sum, item) => sum + item.files, 0),
      sessionBytes: sessions.reduce((sum, item) => sum + item.bytes, 0),
      projcacheFiles: sessions.filter((item) => item.hasProjcache).length,
      projcacheBytes: sessions.reduce((sum, item) => sum + (item.projcacheBytes || 0), 0),
      attachmentFiles: attachments.files,
      attachmentBytes: attachments.bytes
    }
  };
}

async function copySessionDir(plan, stagingDir) {
  for (const session of plan.sessions) {
    const dest = path.join(stagingDir, 'sessions', session.safeTitle, session.sessionId);
    await fsp.mkdir(dest, { recursive: true });
    for (const name of session.fileNames) {
      const source = path.join(session.dir, name);
      const target = path.join(dest, name);
      if (isSessionLogName(name) && name.endsWith('.zstd')) {
        const raw = await fsp.readFile(source);
        const safe = sanitizeSessionBuffer(raw);
        await fsp.writeFile(target, safe.buffer);
        if (safe.trimmed) session.trimmed = true;
      } else {
        await fsp.copyFile(source, target);
      }
    }
    if (session.projcacheSource && await pathExists(session.projcacheSource)) {
      const cacheDir = path.join(stagingDir, 'projcache');
      await fsp.mkdir(cacheDir, { recursive: true });
      await fsp.copyFile(session.projcacheSource, path.join(cacheDir, session.projcacheShortId + '.json'));
    }
  }
}

export async function packWorkspaceArchive(home, request) {
  const plan = await planPack(home, request);
  const output = plan.output;
  await fsp.mkdir(path.dirname(output), { recursive: true });
  if (await pathExists(output)) {
    if (request.overwrite !== true) throw new Error('output already exists: ' + output);
    await fsp.rm(output, { force: true });
  }
  const staging = await tempDir('dsh-workspace-pack-');
  try {
    for (const workspace of plan.workspaces) {
      if (!workspace.includeProject || !workspace.scan) continue;
      const dest = path.join(staging, 'workspaces', workspace.safeTitle);
      await fsp.mkdir(dest, { recursive: true });
      await copyWalkedFiles(workspace.scan, dest);
    }
    if (plan.sessions.length > 0) await copySessionDir(plan, staging);
    if (plan.includeAttachments && plan.attachments.scan) {
      const dest = path.join(staging, 'attachments');
      await fsp.mkdir(dest, { recursive: true });
      await copyWalkedFiles(plan.attachments.scan, dest);
    }
    const extras = [];
    for (const item of Array.isArray(request.extra) ? request.extra : []) {
      if (!item || typeof item.source !== 'string' || typeof item.relative !== 'string') continue;
      const rel = item.relative.replace(/\\/g, '/').replace(/^\.?\/+|\.\.+\/?/g, '');
      if (!rel) continue;
      const dest = path.join(staging, rel);
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      if ((await fsp.lstat(item.source)).isDirectory()) await copyExtraTree(item.source, dest);
      else await fsp.copyFile(item.source, dest);
      extras.push(rel);
    }
    const manifest = {
      format: 'dsh-workspace-move/1',
      createdAt: new Date().toISOString(),
      source: {
        hostname: os.hostname(),
        platform: process.platform,
        arch: process.arch,
        userHome: toPosix(os.homedir()),
        dshHome: plan.home
      },
      options: {
        includeAttachments: plan.includeAttachments,
        includeGit: plan.includeGit,
        includeSecrets: plan.includeSecrets
      },
      workspaces: plan.workspaces.map(({ scan, ...rest }) => rest),
      sessions: plan.sessions.map(({ dir, fileNames, mainLog, projcacheSource, projcacheShortId, ...rest }) => rest),
      attachments: { files: plan.attachments.files, bytes: plan.attachments.bytes },
      config: request.configManifest || {},
      extras,
      totals: plan.totals,
      exclusions: {
        directories: ['node_modules', '.venv', 'venv', '__pycache__', '.pytest_cache', '.mypy_cache', '.next', '.nuxt', 'dist', 'build', 'target', '.cache', '.git'],
        files: ['*.log', '*.tmp', '.DS_Store'],
        secrets: ['.env', '.env.*', '*.pem', '*.key', 'id_rsa']
      },
      unreadable: plan.unreadable,
      warnings: plan.warnings
    };
    await atomicWriteJson(path.join(staging, '_workspace-manifest.json'), manifest);
    const entries = ['_workspace-manifest.json', 'workspaces', 'sessions', 'projcache', 'attachments', ...extras].filter((name) => fs.existsSync(path.join(staging, name)));
    const created = await createTarGz(staging, output, entries);
    return {
      format: 'dsh-move-pack-result/1',
      file: toPosix(created.file),
      sha256: created.sha256,
      bytes: created.bytes,
      workspaces: manifest.workspaces.length,
      sessions: manifest.sessions.length,
      attachments: manifest.attachments,
      config: manifest.config,
      totals: manifest.totals,
      warnings: plan.warnings,
      unreadable: plan.unreadable,
      manifest
    };
  } finally {
    await fsp.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}
