# DSH Move

**English** | [简体中文](README.zh-CN.md)

A native DeepSeek Harness plugin for moving a DSH setup to another Windows computer.

DSH Move is an independent community project. It is **not affiliated with, endorsed by, or sponsored by DeepSeek**. “DeepSeek Harness” is used descriptively to identify the host application.

> **Data safety notice**
>
> DSH Move handles personal files, chat sessions, plugin settings and possibly API keys. **Back up your data independently before using this tool.** Do not rely on this plugin as your only backup.
>
> - The archive is plaintext and may contain private content, credentials or API keys. Store it securely and never share it.
> - This project **cannot guarantee the security, integrity, completeness or recoverability of your data**. See [Safety](#safety).

## What it does

One **Backup & Migration** page in DSH Settings:

- Pack workspaces, project files, sessions and attachments into one archive.
- Pack plugin declarations, plugin settings, user skills, MCP servers and profile settings into the same archive.
- Restore on another Windows machine.
- Install missing plugin packages through DSH's plugin manager.
- Re-create workspaces and attach sessions while DSH is running.
- Remember the previous migration choices and offer to reuse them.

## Requirements

- Windows 10 1803+ (the packer uses the system `tar.exe`; this release is Windows-only)
- DeepSeek Harness 0.2.x
- Git on `PATH` when installing from GitHub

## Install

From the DSH Plugins page, install this Git URL:

    github:TK9BOT/dsh-move

Or use the CLI:

    dsh plugin --profile desktop add github:TK9BOT/dsh-move

Restart DSH once. The single entry is:

> **Settings -> Backup & Migration**

The plugin is plain ESM. There is no build step, native addon or postinstall script.

## Update

Open **Settings -> Backup & Migration** and click **Check for updates**. When a newer release exists, **Update to vX** downloads it from GitHub and installs it into the active profile. Restart DSH to load the new version. The update button is the same page you use for migration.

## Use

### 1. Pack

1. Select one or more workspaces.
2. Choose sessions individually, or keep all of them.
3. Pick a save location:
   - leave the directory blank and use the system “Save As” dialog, or
   - type a directory and the archive is written there.
4. Click **Pack**.

The output is a single `.tar.gz` archive plus a `.sha256` sidecar.

### 2. Restore

1. Select the archive by path or upload it.
2. Choose a target root directory.
3. Click **Restore**.

Default behavior:

- Project files: **merge** — keep existing target files, add missing ones.
- Existing sessions: keep.
- Existing plugins: keep installed versions.
- Skills/MCP/settings: source values are merged in.

Advanced choices:

- Project files: merge / overwrite (target backed up first) / skip.
- Session conflict: keep / replace (target session backed up first).
- Configuration conflict: keep target values / overwrite with archive values.
- Plugin packages missing on the target are installed automatically when DSH's plugin manager is available.

Skills, MCP servers, plugin declarations and profile/settings changes take effect after a DSH restart. Workspaces and sessions are attached live; if the sidebar does not refresh, use the page's **Refresh page** button or restart DSH.

## Where workspaces go

DSH workspaces are absolute paths registered in DSH, not folders next to the DSH application. DSH Move reads those registered paths from DSH, so the project folder and the app folder may be on different drives.

On restore, the target is:

    <target root>/<workspace title>

Examples:

- target root `D:\DSH-Migration` + workspace `My Project` -> `D:\DSH-Migration\My Project`
- If the target DSH already has a workspace with the same title, the archive is merged into that existing workspace path instead of creating a second row.
- If the target DSH has no workspaces at all, both the folder and the workspace are created.
- Source absolute paths are not reused. Session `cwd` values are rewritten to the target path.

Only workspaces registered in DSH are packed. An arbitrary folder that was never added as a DSH workspace is not discovered automatically.

## What is packed

- Workspace project files, excluding common generated folders, `.git`, caches, logs, `.env` and secret files.
- Session logs and projection cache.
- Attachments, if enabled.
- Plugin declarations, bundle selection and plugin settings.
- User skills under `$DSH_HOME/skills`.
- MCP rows and user patches in `$DSH_HOME/cordis.patch.yml`.
- Profile patches and selected settings files.

Credential values in `$DSH_HOME/.credentials.yaml` are **not** packed. Plugin settings are captured as live values and may contain API keys; treat the archive as sensitive plaintext.

## Safety

- Source files are read-only during pack.
- Restore validates the archive SHA256 when the sidecar is present, rejects absolute/traversal paths and link entries, and refuses targets inside DSH home or inside another workspace.
- Overwrite and replace operations back up the target first.
- A failed workspace restore rolls back created files and registry changes.
- Only restore archives you trust. Plugin auto-install and MCP configuration can execute third-party code after restart; an archive is code and configuration, not inert data.
- Routes are loopback-only and same-origin protected; do not expose the DSH web port to untrusted networks.

## Known limits

- Project policy is global, not per workspace.
- Duplicate workspace titles are merged into the first matching target path.
- Plugin specs using `link:` or `file:` are reported and skipped on another machine.
- MCP commands may contain absolute paths; review them after restore if the target layout differs.
- Plugin settings that belong to a plugin not yet active on the target may need a restart and a second restore pass.
- Archives are unencrypted.

## Development

    npm test
    dsh plugin --profile desktop add link:<absolute path to this checkout>

Host half: `lib/index.js`. Browser page: `lib/client.js`. Workspace engine: `lib/engine`. Restore logic: `lib/native-restore.js` and `lib/config-migrate.js`.

## License

MIT. See [LICENSE](LICENSE).
