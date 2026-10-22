import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { projectKey } from './engine/project-key.mjs';
import { rewriteSessionCwd, readSessionHeader } from './engine/session-log.mjs';
import { verifyArchiveSha, extractTarGz, readTarEntry } from './engine/archive.mjs';
import { isAbsolutePath, isSubPath, pathKey, pathExists, isNonEmptyDir, copyDir } from './engine/fsutil.mjs';

function isWithin(base, child) {
  const b = pathKey(base);
  const c = pathKey(child);
  return c === b || c.startsWith(b + '/');
}

function stamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }

function shortId(id) { return String(id).replace(/^session-/, ''); }

function assertTarget(home, target) {
  if (!isAbsolutePath(target)) throw new Error('target path must be absolute: ' + target);
  const resolved = path.resolve(target);
  if (resolved === path.parse(resolved).root) throw new Error('target path cannot be a drive root');
  if (isSubPath(home, resolved)) throw new Error('target path cannot be inside DSH home: ' + resolved);
  return resolved;
}

async function copyTree(src, dest, options = {}) {
  const overwrite = options.overwrite === true;
  const journal = options.journal;
  const tag = options.tag || 'project';
  const conflicts = [];
  async function visit(dir, rel) {
    for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
      const from = path.join(dir, entry.name);
      const relChild = rel ? rel + '/' + entry.name : entry.name;
      const to = path.join(dest, relChild);
      const stat = await fsp.lstat(from);
      if (stat.isSymbolicLink()) throw new Error('archive contains a symlink: ' + relChild);
      if (stat.isDirectory()) {
        if (!(await pathExists(to))) {
          await fsp.mkdir(to, { recursive: true });
          journal?.actions.push({ type: 'new-dir', path: to, tag });
        }
        await visit(from, relChild);
      } else if (stat.isFile()) {
        const exists = await pathExists(to);
        if (exists && !overwrite) { conflicts.push(relChild); continue; }
        if (!exists) journal?.actions.push({ type: 'new-file', path: to, tag });
        await fsp.mkdir(path.dirname(to), { recursive: true });
        await fsp.copyFile(from, to);
        const when = new Date(stat.mtimeMs);
        await fsp.utimes(to, when, when).catch(() => {});
      }
    }
  }
  await visit(src, '');
  return conflicts;
}

async function rollback(journal) {
  const failures = [];
  for (let i = journal.actions.length - 1; i >= 0; i -= 1) {
    const action = journal.actions[i];
    try {
      if (action.type === 'new-file') await fsp.rm(action.path, { force: true });
      else if (action.type === 'new-dir') await fsp.rm(action.path, { recursive: true, force: true });
      else if (action.type === 'project-backup') {
        await fsp.rm(action.path, { recursive: true, force: true });
        await copyDir(action.backup, action.path);
      }
    } catch (error) {
      failures.push({ action, error: error.message });
    }
  }
  return failures;
}

export async function restoreNative({ home, registry, archive, targetRoot, titles = [], projectMode = 'merge', includeAttachments = false, sessionMode = 'keep', mergeSameTitle = true, sessionIds = {}, configMode = 'merge', onExtracted = null }) {
  if (!archive) throw new Error('archive is required');
  if (!targetRoot) throw new Error('targetRoot is required');
  const archivePath = path.resolve(archive);
  if (!(await pathExists(archivePath))) throw new Error('archive not found: ' + archivePath);
  const root = assertTarget(home, targetRoot);
  await verifyArchiveSha(archivePath);
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-move-native-'));
  const backupDir = path.join(home, 'dsh-move', 'backups', stamp() + '-restore');
  const journal = { actions: [], createdAt: new Date().toISOString() };
  const report = { format: 'dsh-move-native-restore/1', backupDir, projects: [], sessions: [], attachments: { copied: 0, skipped: 0 }, conflicts: [], warnings: [], rolledBack: false };
  const createdWorkspaces = [];
  const attached = [];
  try {
    extractTarGz(archivePath, temp);
    const manifest = JSON.parse(await readTarEntry(archivePath, '_workspace-manifest.json'));
    if (manifest.format !== 'dsh-workspace-move/1') throw new Error('unsupported archive format: ' + manifest.format);
    const selected = new Set(titles.length > 0 ? titles : manifest.workspaces.map((w) => w.title));
    for (const workspace of manifest.workspaces) {
      if (!selected.has(workspace.title)) continue;
      const safe = workspace.safeTitle || workspace.title;
      let targetPath = path.join(root, safe);
      const byTitle = registry.list().filter((w) => w.title === workspace.title);
      if (byTitle.length > 1) {
        const exact = byTitle.find((w) => pathKey(w.path) === pathKey(targetPath));
        if (!exact) { report.warnings.push({ type: 'title-ambiguous', title: workspace.title, paths: byTitle.map((w) => w.path) }); continue; }
      }
      if (byTitle.length === 1) {
        if (pathKey(byTitle[0].path) !== pathKey(targetPath) && !mergeSameTitle) {
          throw new Error('workspace title exists at a different path: ' + workspace.title + ' -> ' + byTitle[0].path);
        }
        targetPath = byTitle[0].path;
      }
      if (isSubPath(home, targetPath)) throw new Error('target path cannot be inside DSH home: ' + targetPath);
      const owner = registry.list().find((w) => pathKey(w.path) === pathKey(targetPath));
      if (owner && owner.title !== workspace.title) throw new Error('target path belongs to another workspace: ' + targetPath);
      for (const other of registry.list()) {
        if (pathKey(other.path) === pathKey(targetPath)) continue;
        if (isWithin(other.path, targetPath)) throw new Error('target path is inside another workspace: ' + targetPath + ' / ' + other.path);
        if (isWithin(targetPath, other.path)) throw new Error('target path contains another workspace: ' + targetPath + ' / ' + other.path);
      }
      if (await pathExists(targetPath)) {
        const targetStat = await fsp.lstat(targetPath);
        if (targetStat.isSymbolicLink()) throw new Error('target path is a symlink: ' + targetPath);
        if (!targetStat.isDirectory()) throw new Error('target path is not a directory: ' + targetPath);
      }
      if (!(await pathExists(targetPath))) {
        await fsp.mkdir(targetPath, { recursive: true });
        journal.actions.push({ type: 'new-dir', path: targetPath, tag: 'workspace-root' });
      }
      const before = new Set(byTitle[0] ? byTitle[0].sessionIds : []);
      const wantedSessions = Array.isArray(sessionIds[workspace.title]) ? new Set(sessionIds[workspace.title].map(String)) : null;
      const selectedSessions = manifest.sessions.filter((s) => s.workspaceTitle === workspace.title && (!wantedSessions || wantedSessions.has(s.sessionId)));
      const sourceProject = path.join(temp, 'workspaces', safe);
      const targetExists = await pathExists(targetPath);
      const nonEmpty = targetExists ? await isNonEmptyDir(targetPath) : false;
      if (projectMode === 'skip' && nonEmpty) {
        report.warnings.push({ type: 'project-skipped', title: workspace.title, reason: 'project mode is skip' });
      } else {
        if (!sourceProject || !(await pathExists(sourceProject))) {
          report.warnings.push({ type: 'project-source-missing', title: workspace.title });
        } else {
          let overwrite = projectMode === 'overwrite';
          if (overwrite && nonEmpty) {
            const backup = path.join(backupDir, 'projects', safe);
            await fsp.mkdir(path.dirname(backup), { recursive: true });
            await copyDir(targetPath, backup);
            journal.actions.push({ type: 'project-backup', path: targetPath, backup, tag: 'project' });
          }
          const conflicts = await copyTree(sourceProject, targetPath, { overwrite, journal, tag: 'project' });
          if (conflicts.length > 0) report.conflicts.push({ type: 'project-file-conflicts', title: workspace.title, count: conflicts.length, sample: conflicts.slice(0, 30) });
        }
      }
      const targetKey = projectKey(targetPath);
      for (const session of selectedSessions) {
        const sourceDir = path.join(temp, 'sessions', safe, session.sessionId);
        if (!(await pathExists(sourceDir))) { report.warnings.push({ type: 'session-source-missing', title: workspace.title, sessionId: session.sessionId }); continue; }
        let header;
        try {
          const logName = (await fsp.readdir(sourceDir)).find((name) => name.endsWith('.jsonl.zstd'));
          if (!logName) throw new Error('no session log');
          header = readSessionHeader(await fsp.readFile(path.join(sourceDir, logName)));
        } catch { header = null; }
        if (!header || String(header.id) !== String(session.sessionId)) {
          report.warnings.push({ type: 'session-invalid', title: workspace.title, sessionId: session.sessionId, reason: 'header id does not match directory name' });
          continue;
        }
        const targetDir = path.join(home, 'sessions', targetKey, session.sessionId);
        if (await pathExists(targetDir)) {
          const targetLstat = await fsp.lstat(targetDir);
          if (targetLstat.isSymbolicLink()) throw new Error('refusing to replace symlink session: ' + targetDir);
          if (sessionMode !== 'replace') {
            report.conflicts.push({ type: 'session-exists', title: workspace.title, sessionId: session.sessionId });
          } else {
            const backup = path.join(backupDir, 'sessions', safe, session.sessionId);
            await fsp.mkdir(path.dirname(backup), { recursive: true });
            await copyDir(targetDir, backup);
            journal.actions.push({ type: 'project-backup', path: targetDir, backup, tag: 'session' });
            await fsp.rm(targetDir, { recursive: true, force: true });
          }
        }
        if (!(await pathExists(targetDir))) {
          await fsp.mkdir(targetDir, { recursive: true });
          journal.actions.push({ type: 'new-dir', path: targetDir, tag: 'session' });
          for (const name of await fsp.readdir(sourceDir)) {
            const from = path.join(sourceDir, name);
            const to = path.join(targetDir, name);
            if (!(await fsp.lstat(from)).isFile()) continue;
            if (name.endsWith('.jsonl.zstd')) {
              const result = rewriteSessionCwd(await fsp.readFile(from), targetPath);
              await fsp.writeFile(to, result.buffer);
            } else {
              await fsp.copyFile(from, to);
            }
          }
          const short = shortId(session.sessionId);
          const cacheFrom = path.join(temp, 'projcache', short + '.json');
          const cacheTo = path.join(home, 'storages', 'session_projcache', 'sessions', short + '.json');
          if (await pathExists(cacheFrom) && !(await pathExists(cacheTo))) {
            try {
              const data = JSON.parse((await fsp.readFile(cacheFrom, 'utf8')).replace(/^\uFEFF/, ''));
              if (data.record?.identity) data.record.identity.cwd = targetPath;
              await fsp.mkdir(path.dirname(cacheTo), { recursive: true });
              journal.actions.push({ type: 'new-file', path: cacheTo, tag: 'projcache' });
              await fsp.writeFile(cacheTo, JSON.stringify(data), 'utf8');
            } catch (error) { report.warnings.push({ type: 'projcache-copy', sessionId: session.sessionId, reason: error.message }); }
          }
        }
        let entity = registry.list().find((w) => pathKey(w.path) === pathKey(targetPath));
        if (!entity) { entity = await registry.create(targetPath, workspace.title); createdWorkspaces.push(entity.id); }
        await entity.attachSession(session.sessionId);
        if (!before.has(session.sessionId)) attached.push({ id: entity.id, sessionId: session.sessionId });
        report.sessions.push({ title: workspace.title, sessionId: session.sessionId, targetPath, action: before.has(session.sessionId) ? 'kept' : 'attached' });
      }
      let entity = registry.list().find((w) => pathKey(w.path) === pathKey(targetPath));
      if (!entity) { entity = await registry.create(targetPath, workspace.title); createdWorkspaces.push(entity.id); }
      report.projects.push({ title: workspace.title, targetPath: entity.path, sessionIds: entity.sessionIds });
    }
    if (includeAttachments && manifest.attachments?.files > 0) {
      const source = path.join(temp, 'attachments');
      if (await pathExists(source)) {
        const target = path.join(home, 'attachments');
        await fsp.mkdir(target, { recursive: true });
        const walk = async (dir, rel) => {
          for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
            const from = path.join(dir, entry.name);
            const relChild = rel ? rel + '/' + entry.name : entry.name;
            const to = path.join(target, relChild);
            const stat = await fsp.lstat(from);
            if (stat.isDirectory()) { await fsp.mkdir(to, { recursive: true }); await walk(from, relChild); }
            else if (stat.isFile()) {
              if (await pathExists(to)) { report.attachments.skipped += 1; continue; }
              await fsp.mkdir(path.dirname(to), { recursive: true });
              journal.actions.push({ type: 'new-file', path: to, tag: 'attachment' });
              await fsp.copyFile(from, to);
              report.attachments.copied += 1;
            }
          }
        };
        await walk(source, '');
      }
    }
    if (typeof onExtracted === 'function' && fs.existsSync(path.join(temp, 'config'))) {
      try { report.config = await onExtracted(temp); } catch (error) { report.config = { error: String(error && error.message || error), restartRequired: true }; }
    }
    return report;
  } catch (error) {
    const failures = await rollback(journal);
    for (const item of attached.reverse()) {
      try { const ws = registry.list().find((w) => w.id === item.id); if (ws) await ws.detachSession(item.sessionId); } catch {}
    }
    for (const id of createdWorkspaces.reverse()) { try { await registry.delete(id); } catch {} }
    report.rolledBack = true;
    error.report = report;
    if (failures.length > 0) error.rollbackFailures = failures;
    throw error;
  } finally {
    await fsp.rm(temp, { recursive: true, force: true }).catch(() => {});
  }
}
