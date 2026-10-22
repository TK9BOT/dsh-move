import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const PROFILE_PATCH = 'cordis.patch.yml';

function readText(file) { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } }

function splitIdRows(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const prelude = [];
  const rows = [];
  let current = null;
  for (const line of lines) {
    if (/^- id:\s*/.test(line)) {
      if (current) rows.push(current);
      current = { id: line.replace(/^- id:\s*/, '').trim(), lines: [line] };
    } else if (current) current.lines.push(line);
    else prelude.push(line);
  }
  if (current) rows.push(current);
  return { prelude, rows };
}

function mergeProfilePatch(sourceText, targetText, overwrite) {
  const source = splitIdRows(sourceText);
  const target = splitIdRows(targetText);
  const map = new Map(target.rows.map((row) => [row.id, row]));
  let added = 0;
  let replaced = 0;
  for (const row of source.rows) {
    if (map.has(row.id)) {
      if (overwrite) { map.set(row.id, row); replaced += 1; }
    } else { map.set(row.id, row); added += 1; }
  }
  const prelude = target.prelude.length > 0 ? target.prelude : source.prelude;
  const lines = [...prelude];
  for (const row of map.values()) lines.push(...row.lines);
  let text = lines.join('\n').replace(/\n{3,}/g, '\n\n');
  if (!text.endsWith('\n')) text += '\n';
  return { text, added, replaced };
}

function mcpBlocks(rootPatchText) {
  const lines = String(rootPatchText || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^\s{2,}- id:\s*(.+)$/.exec(lines[i]);
    if (!match) continue;
    const id = match[1].trim();
    const block = [lines[i]];
    let j = i + 1;
    while (j < lines.length && !/^\s{2,}- id:\s*/.test(lines[j]) && !/^-\s/.test(lines[j])) { block.push(lines[j]); j += 1; }
    out.push({ id, block });
    i = j - 1;
  }
  return out;
}

function mergeRootPatch(sourceText, targetText, overwrite) {
  if (!targetText.trim()) return { text: sourceText.endsWith('\n') ? sourceText : sourceText + '\n', added: mcpBlocks(sourceText).length, replaced: 0 };
  const existing = new Set(mcpBlocks(targetText).map((row) => row.id));
  const missing = mcpBlocks(sourceText).filter((row) => !existing.has(row.id));
  if (missing.length === 0) return { text: targetText, added: 0, replaced: 0 };
  const append = ['', '- insert:'];
  for (const row of missing) append.push(...row.block.map((line) => line.startsWith('  ') ? line : '    ' + line));
  let text = targetText.replace(/\s*$/, '') + '\n' + append.join('\n') + '\n';
  return { text, added: missing.length, replaced: 0 };
}

function mergePackage(sourcePkg, targetPkg, overwrite) {
  const next = JSON.parse(JSON.stringify(targetPkg || {}));
  next.dependencies = { ...(next.dependencies || {}) };
  next.dsh = next.dsh || {};
  next.dsh.profile = next.dsh.profile || {};
  const oldDeps = { ...next.dependencies };
  const installed = [];
  for (const [name, spec] of Object.entries(sourcePkg.dependencies || {})) {
    if (name === 'dsh-move' || name === 'dsh-config-manager') continue;
    if (!Object.hasOwn(next.dependencies, name) || overwrite) next.dependencies[name] = spec;
    if (!Object.hasOwn(oldDeps, name)) installed.push({ name, spec });
  }
  const previousBundles = Array.isArray(next.dsh.profile.bundles) ? next.dsh.profile.bundles : [];
  const nextBundles = [...previousBundles];
  for (const name of sourcePkg.dsh?.profile?.bundles || []) {
    if (name === 'dsh-move' || name === 'dsh-config-manager') continue;
    if (!nextBundles.includes(name)) nextBundles.push(name);
  }
  next.dsh.profile.bundles = nextBundles;
  return { pkg: next, addedDependencies: installed, addedBundles: nextBundles.filter((name) => !previousBundles.includes(name)) };
}

export async function collectConfig(home, profileName, outDir, ctx) {
  const profileDir = path.join(home, 'profiles', profileName);
  await fsp.mkdir(outDir, { recursive: true });
  const included = [];
  async function copyFile(rel, source) {
    if (!fs.existsSync(source)) return;
    const dest = path.join(outDir, rel);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.copyFile(source, dest);
    included.push(rel.replace(/\\/g, '/'));
  }
  await copyFile('home/cordis.patch.yml', path.join(home, 'cordis.patch.yml'));
  await copyFile('home/settings.yaml.imported', path.join(home, 'settings.yaml.imported'));
  await copyFile('home/AGENTS.md', path.join(home, 'AGENTS.md'));
  for (const name of ['settings.yaml.imported', 'hub-settings.json']) await copyFile('home/' + name, path.join(home, name));
  if (fs.existsSync(path.join(home, 'skills'))) {
    await fsp.cp(path.join(home, 'skills'), path.join(outDir, 'home', 'skills'), { recursive: true });
    included.push('home/skills/');
  }
  if (fs.existsSync(path.join(home, '.agent-presets'))) {
    await fsp.cp(path.join(home, '.agent-presets'), path.join(outDir, 'home', '.agent-presets'), { recursive: true });
    included.push('home/.agent-presets/');
  }
  for (const name of [PROFILE_PATCH, 'package.json', 'hub-settings.json']) {
    await copyFile('profile/' + name, path.join(profileDir, name));
  }
  let settingsRecords = [];
  try {
    const settings = ctx && typeof ctx.get === 'function' ? ctx.get('settings') : null;
    if (settings && typeof settings.describe === 'function') {
      const all = await settings.describe();
      settingsRecords = (Array.isArray(all) ? all : []).map((row) => ({ ns: row.ns, value: row.value, revision: row.revision, autoGenerate: row.autoGenerate }));
      await fsp.writeFile(path.join(outDir, 'settings.json'), JSON.stringify(settingsRecords, null, 2), 'utf8');
      included.push('settings.json');
    }
  } catch (error) { /* settings service unavailable; files still restore */ }
  const manifest = { format: 'dsh-move-config/1', profile: profileName, included, settings: settingsRecords.length, createdAt: new Date().toISOString() };
  await fsp.writeFile(path.join(outDir, 'config.json'), JSON.stringify(manifest, null, 2), 'utf8');
  included.push('config.json');
  return manifest;
}

export async function restoreConfig({ ctx, home, profileName, configDir, mode = 'merge' }) {
  const profileDir = path.join(home, 'profiles', profileName);
  const overwrite = mode === 'overwrite';
  const report = { plugins: { installed: [], skipped: [], warnings: [] }, skills: { copied: 0, kept: 0 }, mcp: { added: 0 }, settings: { added: 0, replaced: 0 }, restartRequired: true };
  const configManifest = JSON.parse(readText(path.join(configDir, 'config.json')) || '{}');
  report.sections = configManifest.included || [];

  // Skills
  const sourceSkills = path.join(configDir, 'home', 'skills');
  if (fs.existsSync(sourceSkills)) {
    const targetSkills = path.join(home, 'skills');
    await fsp.mkdir(targetSkills, { recursive: true });
    for (const entry of fs.readdirSync(sourceSkills, { withFileTypes: true })) {
      const from = path.join(sourceSkills, entry.name);
      const to = path.join(targetSkills, entry.name);
      if (entry.isDirectory()) { if (overwrite || !fs.existsSync(to)) { await fsp.rm(to, { recursive: true, force: true }); await fsp.cp(from, to, { recursive: true }); report.skills.copied += 1; } else report.skills.kept += 1; }
      else if (overwrite || !fs.existsSync(to)) { await fsp.copyFile(from, to); report.skills.copied += 1; } else report.skills.kept += 1;
    }
  }

  // Home-level settings files (do not touch credentials)
  for (const rel of ['settings.yaml.imported', 'AGENTS.md']) {
    const from = path.join(configDir, 'home', rel);
    if (fs.existsSync(from)) { await fsp.copyFile(from, path.join(home, rel)); report.settings.added += 1; }
  }
  if (fs.existsSync(path.join(configDir, 'home', '.agent-presets'))) {
    const target = path.join(home, '.agent-presets');
    await fsp.rm(target, { recursive: true, force: true });
    await fsp.cp(path.join(configDir, 'home', '.agent-presets'), target, { recursive: true });
    report.settings.added += 1;
  }

  // MCP entries in the home patch file.
  const sourceRootPatch = readText(path.join(configDir, 'home', 'cordis.patch.yml'));
  if (sourceRootPatch.trim()) {
    const targetPath = path.join(home, 'cordis.patch.yml');
    const merged = mergeRootPatch(sourceRootPatch, readText(targetPath), overwrite);
    if (merged.added > 0 || !fs.existsSync(targetPath)) {
      await fsp.mkdir(path.dirname(targetPath), { recursive: true });
      await fsp.writeFile(targetPath, merged.text, 'utf8');
      report.mcp.added = merged.added;
    }
  }

  // Profile patch (plugin settings and other settings).
  const sourceProfilePatch = readText(path.join(configDir, 'profile', PROFILE_PATCH));
  if (sourceProfilePatch.trim()) {
    const targetPath = path.join(profileDir, PROFILE_PATCH);
    const merged = mergeProfilePatch(sourceProfilePatch, readText(targetPath), overwrite);
    await fsp.writeFile(targetPath, merged.text, 'utf8');
    report.settings.added += merged.added;
    report.settings.replaced += merged.replaced;
  }

  // Profile package: plugin declarations, then best-effort install.
  let sourcePkg = {};
  try { sourcePkg = JSON.parse(readText(path.join(configDir, 'profile', 'package.json')) || '{}'); } catch {}
  let targetPkg = {};
  try { targetPkg = JSON.parse(readText(path.join(profileDir, 'package.json')) || '{}'); } catch {}
  const beforeDeps = { ...(targetPkg.dependencies || {}) };
  const pluginManager = ctx.get('pluginManager');
  const installTargets = [];
  for (const [name, spec] of Object.entries(sourcePkg.dependencies || {})) {
    if (name === 'dsh-move' || name === 'dsh-config-manager') continue;
    if (Object.hasOwn(beforeDeps, name)) continue;
    if (/^(link|file):/i.test(String(spec))) { report.plugins.warnings.push({ name, reason: 'local path plugin spec cannot be installed on another machine' }); continue; }
    const installSpec = /^(github:|git\+|https?:|file:|link:)/i.test(String(spec)) ? String(spec) : name + '@' + String(spec);
    installTargets.push({ name, spec, installSpec });
  }
  if (pluginManager && typeof pluginManager.installBundle === 'function') {
    for (const item of installTargets) {
      try {
        const result = await pluginManager.installBundle(item.installSpec, { enabled: true });
        if (result && result.application === 'failed') report.plugins.warnings.push({ name: item.name, reason: result.error?.message || 'install failed' });
        else report.plugins.installed.push(item.name);
      } catch (error) {
        report.plugins.warnings.push({ name: item.name, reason: String(error && error.message || error) });
      }
    }
  } else if (installTargets.length > 0) {
    report.plugins.warnings.push({ name: '*', reason: 'pluginManager service unavailable; plugin declarations will be merged and must be installed after restart' });
  }
  // Re-read after installs, then merge the remaining declarations.
  try { targetPkg = JSON.parse(readText(path.join(profileDir, 'package.json')) || '{}'); } catch {}
  const mergedPackage = mergePackage(sourcePkg, targetPkg, overwrite);
  await fsp.writeFile(path.join(profileDir, 'package.json'), JSON.stringify(mergedPackage.pkg, null, 2) + '\n', 'utf8');
  report.plugins.addedDependencies = mergedPackage.addedDependencies;
  report.plugins.addedBundles = mergedPackage.addedBundles;
  if (pluginManager && typeof pluginManager.setBundleEnabled === 'function') {
    for (const name of sourcePkg.dsh?.profile?.bundles || []) {
      if (name === 'dsh-move' || name === 'dsh-config-manager') continue;
      try { await pluginManager.setBundleEnabled(name, true); } catch (error) { report.plugins.warnings.push({ name, reason: String(error && error.message || error) }); }
    }
  }
  // Apply live plugin/settings namespaces captured from the settings service.
  const settings = ctx.get('settings');
  let settingsRecords = [];
  try { settingsRecords = JSON.parse(readText(path.join(configDir, 'settings.json')) || '[]'); } catch {}
  if (settings && Array.isArray(settingsRecords) && settingsRecords.length > 0) {
    let current = [];
    try { current = await settings.describe(); } catch {}
    const byNs = new Map((Array.isArray(current) ? current : []).map((row) => [row.ns, row]));
    for (const record of settingsRecords) {
      if (!record || typeof record.ns !== 'string') continue;
      const target = byNs.get(record.ns);
      if (!target) { report.plugins.warnings.push({ name: 'settings:' + record.ns, reason: 'target namespace is not available; restart DSH after plugins load, then restore again' }); continue; }
      try {
        await settings.replace(record.ns, record.value, target.revision);
        report.settings.added += 1;
      } catch (error) {
        try { await settings.update(record.ns, record.value, target.revision); report.settings.added += 1; }
        catch (error2) { report.plugins.warnings.push({ name: 'settings:' + record.ns, reason: String(error2 && error2.message || error2) }); }
      }
    }
  }

  return report;
}
