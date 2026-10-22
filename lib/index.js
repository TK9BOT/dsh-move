import fs from 'node:fs';
import { createReadStream, createWriteStream } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { packWorkspaceArchive } from './engine/pack.mjs';
import { listWorkspaces } from './engine/workspace-data.mjs';
import { isSubPath } from './engine/fsutil.mjs';
import { restoreNative } from './native-restore.js';
import { collectConfig, restoreConfig } from './config-migrate.js';

export const name = 'dsh-move';

function isLoopback(req) {
  const address = req.socket && req.socket.remoteAddress ? String(req.socket.remoteAddress) : '';
  return address === '' || address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function isSameOrigin(req) {
  const site = req.headers && req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = (req.headers && (req.headers.origin || req.headers.referer)) || '';
  if (!origin) return true;
  try {
    const target = new URL(origin);
    return target.host === req.headers.host;
  } catch {
    return false;
  }
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value, null, 2);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let text = '';
    let bytes = 0;
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > 2 * 1024 * 1024) { reject(new Error('request too large')); req.destroy(); return; }
      text += chunk;
    });
    req.on('end', () => {
      if (!text.trim()) return resolve({});
      try { resolve(JSON.parse(text)); } catch (error) { reject(new Error('invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function profileHome(ctx) {
  const profile = ctx.get('profileContext');
  if (!profile || typeof profile.home !== 'string') throw new Error('profileContext.home is unavailable');
  return profile.home;
}

function safeStamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }

function statePath(home) { return path.join(home, 'dsh-move', 'state.json'); }

async function readState(home) {
  try { return JSON.parse(await fsp.readFile(statePath(home), 'utf8')); } catch { return {}; }
}

async function saveState(home, patch) {
  const current = await readState(home);
  const next = { ...current, ...patch, updatedAt: Date.now() };
  const file = statePath(home);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temp = file + '.tmp-' + process.pid;
  await fsp.writeFile(temp, JSON.stringify(next, null, 2), 'utf8');
  await fsp.rename(temp, file);
  return next;
}

export function apply(ctx) {
  ctx.inject(['webServer'], (webCtx) => {
    const server = webCtx.webServer;
    ctx.effect(() => server.register({
      kind: 'prefix',
      path: '/plugin/dsh-move',
      handler: async (req, res) => {
        try {
          if (!isLoopback(req) || !isSameOrigin(req)) return sendJson(res, 403, { ok: false, error: 'local same-origin access only' });
          const url = new URL(req.url || '/', 'http://localhost');
          const route = url.pathname.replace(/^\/plugin\/dsh-move/, '') || '/';
          const home = profileHome(ctx);
          const registry = ctx.get('workspaceRegistry');
          if (route === '/status') {
            return sendJson(res, 200, {
              ok: true,
              plugin: name,
              home,
              suggestedTargetRoot: path.join(os.homedir(), 'Desktop'),
              profile: ctx.get('profileContext')?.name || null,
              hasWorkspaceRegistry: Boolean(registry)
            });
          }
          if (route === '/workspaces') {
            if (!registry) return sendJson(res, 503, { ok: false, error: 'workspaceRegistry unavailable' });
            const list = await listWorkspaces(home, { scanProjects: false });
            return sendJson(res, 200, {
              ok: true,
              workspaces: list.workspaces.map((w) => ({
                id: w.id,
                title: w.title,
                path: w.path,
                exists: w.exists,
                project: w.project,
                sessions: w.sessions.map((s) => ({ sessionId: s.sessionId, title: s.title, date: s.date, bytes: s.bytes, missing: s.missing }))
              })),
              attachments: list.attachments
            });
          }
          if (route === '/state') {
            if (req.method === 'GET') return sendJson(res, 200, { ok: true, state: await readState(home) });
            if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'GET or POST required' });
            const body = await readBody(req);
            const allowed = {};
            for (const key of ['titles','sessions','archive','targetRoot','outputDir','projectMode','sessionMode','includeConfig','configMode','includeAttachments','lastPack','lastRestore','lastAction']) {
              if (body[key] !== undefined) allowed[key] = body[key];
            }
            return sendJson(res, 200, { ok: true, state: await saveState(home, allowed) });
          }
          if (route === '/upload') {
            if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST required' });
            const rawName = String(req.headers['x-filename'] || 'archive.tar.gz');
            const name = path.basename(rawName).replace(/[^A-Za-z0-9._-]/g, '_') || 'archive.tar.gz';
            const dir = path.join(home, 'dsh-move', 'uploads');
            await fsp.mkdir(dir, { recursive: true });
            const dest = path.join(dir, safeStamp() + '-' + name);
            await new Promise((resolve, reject) => {
              const out = createWriteStream(dest, { flags: 'wx' });
              req.pipe(out);
              out.on('finish', resolve);
              out.on('error', reject);
              req.on('error', reject);
            });
            return sendJson(res, 200, { ok: true, file: dest, bytes: (await fsp.stat(dest)).size });
          }
          if (route === '/download') {
            const candidate = url.searchParams.get('path') || '';
            const exportsDir = path.join(home, 'dsh-move', 'exports');
            if (!candidate || !isSubPath(exportsDir, candidate)) return sendJson(res, 403, { ok: false, error: 'path outside exports' });
            const stat = await fsp.stat(candidate);
            if (!stat.isFile()) return sendJson(res, 404, { ok: false, error: 'not a file' });
            res.writeHead(200, { 'content-type': 'application/gzip', 'content-length': stat.size, 'content-disposition': 'attachment; filename="' + path.basename(candidate).replace(/[^A-Za-z0-9._-]/g, '_') + '"' });
            createReadStream(candidate).pipe(res);
            return;
          }
          if (route === '/create') {
            if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST required' });
            if (!registry) return sendJson(res, 503, { ok: false, error: 'workspaceRegistry unavailable' });
            const body = await readBody(req);
            const workspace = await registry.create(body.path, body.title);
            return sendJson(res, 200, { ok: true, workspace: { id: workspace.id, title: workspace.title, path: workspace.path, sessionIds: workspace.sessionIds } });
          }
          if (route === '/pack') {
            if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST required' });
            const body = await readBody(req);
            const titles = Array.isArray(body.titles) ? body.titles.filter((t) => typeof t === 'string' && t) : [];
            const selectedSessions = body.sessions && typeof body.sessions === 'object' ? body.sessions : {};
            if (titles.length === 0) return sendJson(res, 400, { ok: false, error: 'select at least one workspace' });
            const list = await listWorkspaces(home, { scanProjects: false });
            const workspaces = [];
            const sessions = [];
            for (const title of titles) {
              const workspace = list.workspaces.find((w) => w.title === title);
              if (!workspace) return sendJson(res, 404, { ok: false, error: 'workspace not found: ' + title });
              workspaces.push({ title, includeProject: true });
              const wanted = Array.isArray(selectedSessions[title]) ? new Set(selectedSessions[title].map(String)) : null;
              for (const session of workspace.sessions) {
                if (!session.missing && (!wanted || wanted.has(session.sessionId))) sessions.push({ workspaceTitle: title, sessionId: session.sessionId });
              }
            }
            let configTemp = null;
            let configManifest = {};
            if (body.includeConfig !== false) {
              configTemp = path.join(home, 'dsh-move', 'tmp', 'config-' + safeStamp());
              await fsp.mkdir(configTemp, { recursive: true });
              configManifest = await collectConfig(home, ctx.get('profileContext')?.name || 'desktop', configTemp, ctx);
            }
            const fileName = 'dsh-move-' + safeStamp() + '.tar.gz';
            let output;
            if (typeof body.outputDir === 'string' && body.outputDir.trim()) {
              if (!path.isAbsolute(body.outputDir.trim())) return sendJson(res, 400, { ok: false, error: 'outputDir must be an absolute directory' });
              await fsp.mkdir(body.outputDir.trim(), { recursive: true });
              output = path.join(body.outputDir.trim(), fileName);
            } else {
              output = path.join(home, 'dsh-move', 'exports', fileName);
              await fsp.mkdir(path.dirname(output), { recursive: true });
            }
            let result;
            try {
              result = await packWorkspaceArchive(home, {
                workspaces,
                sessions,
                includeAttachments: body.includeAttachments === true,
                output,
                overwrite: false,
                extra: configTemp ? [{ source: configTemp, relative: 'config' }] : [],
                configManifest
              });
            } finally {
              if (configTemp) await fsp.rm(configTemp, { recursive: true, force: true }).catch(() => {});
            }
            await saveState(home, { titles, sessions: selectedSessions, archive: result.file, lastPack: result.file, lastAction: 'pack', outputDir: typeof body.outputDir === 'string' ? body.outputDir : undefined, includeConfig: body.includeConfig !== false });
            const { manifest: _manifest, ...visible } = result;
            return sendJson(res, 200, { ok: true, result: visible });
          }
          if (route === '/restore') {
            if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST required' });
            if (!registry) return sendJson(res, 503, { ok: false, error: 'workspaceRegistry unavailable' });
            const body = await readBody(req);
            if (!body.archive) return sendJson(res, 400, { ok: false, error: 'archive is required' });
            if (!body.targetRoot) return sendJson(res, 400, { ok: false, error: 'targetRoot is required' });
            const result = await restoreNative({
              home,
              registry,
              archive: body.archive,
              targetRoot: body.targetRoot,
              titles: Array.isArray(body.titles) ? body.titles : [],
              projectMode: body.projectMode === 'overwrite' ? 'overwrite' : body.projectMode === 'skip' ? 'skip' : 'merge',
              includeAttachments: body.includeAttachments === true,
              sessionMode: body.sessionMode === 'replace' ? 'replace' : 'keep',
              configMode: body.configMode === 'overwrite' ? 'overwrite' : 'merge',
              onExtracted: body.includeConfig === false ? null : async (temp) => { try { return await restoreConfig({ ctx, home, profileName: ctx.get('profileContext')?.name || 'desktop', configDir: path.join(temp, 'config'), mode: body.configMode === 'overwrite' ? 'overwrite' : 'merge' }); } catch (error) { return { error: String(error && error.message || error), restartRequired: true }; } },
              sessionIds: body.sessions && typeof body.sessions === 'object' ? body.sessions : {},
              mergeSameTitle: body.mergeSameTitle !== false
            });
            await saveState(home, { titles: result.projects.map((p) => p.title), sessions: body.sessions && typeof body.sessions === 'object' ? body.sessions : {}, archive: body.archive, targetRoot: body.targetRoot, projectMode: body.projectMode === 'overwrite' ? 'overwrite' : body.projectMode === 'skip' ? 'skip' : 'merge', sessionMode: body.sessionMode === 'replace' ? 'replace' : 'keep', includeAttachments: body.includeAttachments === true, includeConfig: body.includeConfig !== false, configMode: body.configMode === 'overwrite' ? 'overwrite' : 'merge', outputDir: body.outputDir, lastRestore: Date.now(), lastAction: 'restore' });
            return sendJson(res, 200, { ok: true, result });
          }
          return sendJson(res, 404, { ok: false, error: 'unknown route', route });
        } catch (error) {
          return sendJson(res, 500, { ok: false, error: String(error && error.message || error), report: error && error.report || undefined });
        }
      }
    }), 'dsh-move routes');
  });
}
