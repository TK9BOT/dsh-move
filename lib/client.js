/**
 * dsh-move browser page.
 *
 * The same compact migration flow is mounted in two places:
 *   Settings -> 迁移
 *   Plugins -> dsh-move -> DSH 迁移
 *
 * It talks only to /plugin/dsh-move/* and stores the last migration choice in
 * $DSH_HOME/dsh-move/state.json through the Host half.
 */
window.__ModuleLoader__.load({
  id: 'dsh-move',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
    var React = require('react');
    var { jsx, jsxs } = require('react/jsx-runtime');
    var { useState, useEffect, useRef, useCallback } = React;

    var API = '/plugin/dsh-move';
    var CONFIG_KEY = 'dsh-move';

    var C = {
      page: { display: 'flex', flexDirection: 'column', gap: 14, color: 'var(--dsw-alias-label-primary, #e8e8e8)', fontSize: 13, lineHeight: 1.5 },
      card: { background: 'var(--dsw-alias-bg-layer-3, #16181d)', border: '1px solid var(--dsw-alias-border-l2, #2a2d34)', borderRadius: 12, padding: '16px 18px' },
      cardSoft: { background: 'var(--dsw-alias-bg-layer-2, #1b1e24)', border: '1px solid var(--dsw-alias-border-l2, #2a2d34)', borderRadius: 10, padding: '10px 12px' },
      head: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
      title: { margin: 0, fontSize: 16, fontWeight: 650, color: 'var(--dsw-alias-label-primary, #e8e8e8)' },
      sub: { margin: '3px 0 0', fontSize: 12, color: 'var(--dsw-alias-label-secondary, #9ca3af)' },
      muted: { fontSize: 12, color: 'var(--dsw-alias-label-secondary, #9ca3af)' },
      row: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
      field: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 },
      label: { fontSize: 12, color: 'var(--dsw-alias-label-secondary, #9ca3af)' },
      input: { boxSizing: 'border-box', width: '100%', height: 36, padding: '0 11px', borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2, #2a2d34)', background: 'var(--dsw-alias-bg-layer-2, #1b1e24)', color: 'var(--dsw-alias-label-primary, #e8e8e8)', fontSize: 13, outline: 'none' },
      button: { appearance: 'none', border: '1px solid transparent', borderRadius: 8, minHeight: 34, padding: '0 15px', background: '#4176e6', color: '#ffffff', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' },
      buttonGhost: { appearance: 'none', border: '1px solid var(--dsw-alias-border-l2, #2a2d34)', borderRadius: 8, minHeight: 34, padding: '0 14px', background: 'var(--dsw-alias-bg-layer-2, #1b1e24)', color: 'var(--dsw-alias-label-primary, #e8e8e8)', fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' },
      buttonTiny: { appearance: 'none', border: '1px solid var(--dsw-alias-border-l2, #2a2d34)', borderRadius: 6, padding: '2px 8px', background: 'transparent', color: 'var(--dsw-alias-label-secondary, #9ca3af)', fontSize: 11, cursor: 'pointer' },
      list: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 },
      item: { border: '1px solid var(--dsw-alias-border-l2, #2a2d34)', borderRadius: 10, padding: '10px 12px', background: 'var(--dsw-alias-bg-layer-2, #1b1e24)' },
      itemHead: { display: 'flex', alignItems: 'flex-start', gap: 10 },
      checkbox: { width: 16, height: 16, marginTop: 2, accentColor: '#4176e6', flex: '0 0 auto' },
      path: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary, #7b8494)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' },
      session: { display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--dsw-alias-label-secondary, #9ca3af)', padding: '3px 0 3px 26px' },
      details: { marginTop: 8, color: 'var(--dsw-alias-label-secondary, #9ca3af)' },
      summary: { cursor: 'pointer', fontSize: 12, color: 'var(--dsw-alias-label-secondary, #9ca3af)', padding: '3px 0' },
      segment: { display: 'inline-flex', border: '1px solid var(--dsw-alias-border-l2, #2a2d34)', borderRadius: 8, overflow: 'hidden' },
      seg: { appearance: 'none', border: 0, padding: '6px 12px', background: 'transparent', color: 'var(--dsw-alias-label-secondary, #9ca3af)', fontSize: 12, cursor: 'pointer' },
      segActive: { appearance: 'none', border: 0, padding: '6px 12px', background: '#4176e6', color: '#ffffff', fontSize: 12, cursor: 'pointer' },
      note: { marginTop: 10, padding: 10, borderRadius: 8, background: 'rgba(79,124,255,0.10)', color: 'var(--dsw-alias-label-secondary, #9ca3af)', fontSize: 12 },
      ok: { marginTop: 10, padding: 10, borderRadius: 8, background: 'rgba(34,197,94,0.12)', color: '#86efac', fontSize: 12, whiteSpace: 'pre-wrap' },
      error: { marginTop: 10, padding: 10, borderRadius: 8, background: 'rgba(239,68,68,0.12)', color: '#fca5a5', fontSize: 12, whiteSpace: 'pre-wrap' },
      pre: { marginTop: 10, padding: 10, borderRadius: 8, background: 'var(--dsw-alias-bg-layer-2, #1b1e24)', color: 'var(--dsw-alias-label-primary, #e8e8e8)', fontSize: 11, overflow: 'auto', maxHeight: 240, whiteSpace: 'pre-wrap' },
      link: { color: '#4176e6', fontSize: 12 },
      hr: { border: 0, borderTop: '1px solid var(--dsw-alias-border-l2, #2a2d34)', margin: '12px 0' }
    };

    async function api(path, init) {
      var res = await fetch(API + path, {
        cache: 'no-store',
        headers: init && init.body ? { 'Content-Type': 'application/json' } : undefined,
        ...init
      });
      var data = null;
      try { data = await res.json(); } catch (error) { data = null; }
      if (!res.ok) throw new Error((data && data.error) || ('HTTP ' + res.status));
      return data;
    }

    function fmtTime(value) {
      if (!value) return '';
      try { return new Date(value).toLocaleString(); } catch (error) { return String(value); }
    }

    function fmtBytes(n) {
      if (!n) return '0 B';
      if (n < 1024) return n + ' B';
      if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
      return (n / 1024 / 1024).toFixed(1) + ' MB';
    }

    function Segmented(props) {
      return jsx('div', { style: C.segment, children: (props.options || []).map(function (option) {
        return jsx('button', {
          type: 'button',
          style: option.value === props.value ? C.segActive : C.seg,
          onClick: function () { props.onChange(option.value); },
          children: option.label
        }, option.value);
      }) });
    }

    function StepHead(props) {
      return jsxs('div', { style: C.head, children: [
        jsxs('div', { children: [jsx('h3', { style: C.title, children: props.title }), props.hint ? jsx('p', { style: C.sub, children: props.hint }) : null] }),
        props.right || null
      ] });
    }

    function MovePage() {
      var [status, setStatus] = useState(null);
      var [updateInfo, setUpdateInfo] = useState(null);
      var [updateBusy, setUpdateBusy] = useState('');
      var [updateNotice, setUpdateNotice] = useState('');
      var [workspaces, setWorkspaces] = useState([]);
      var [selected, setSelected] = useState({});
      var [sessionSelected, setSessionSelected] = useState({});
      var [archive, setArchive] = useState('');
      var [targetRoot, setTargetRoot] = useState('');
      var [outputDir, setOutputDir] = useState('');
      var [projectMode, setProjectMode] = useState('merge');
      var [sessionMode, setSessionMode] = useState('keep');
      var [includeAttachments, setIncludeAttachments] = useState(false);
      var [includeConfig, setIncludeConfig] = useState(true);
      var [configMode, setConfigMode] = useState('merge');
      var [advanced, setAdvanced] = useState(false);
      var [busy, setBusy] = useState('');
      var [uploading, setUploading] = useState(false);
      var [error, setError] = useState('');
      var [notice, setNotice] = useState('');
      var [result, setResult] = useState(null);
      var [saved, setSaved] = useState(null);
      var [resumeVisible, setResumeVisible] = useState(false);
      var [lastArchive, setLastArchive] = useState('');
      var fileRef = useRef(null);
      var loadedRef = useRef(false);

      var applyStateLists = useCallback(function (list, state) {
        var nextSelected = {};
        var nextSessions = {};
        var chosenTitles = state && Array.isArray(state.titles) ? state.titles : null;
        (list || []).forEach(function (workspace) {
          nextSelected[workspace.title] = !chosenTitles || chosenTitles.indexOf(workspace.title) >= 0;
          nextSessions[workspace.title] = {};
          var chosenSessions = state && state.sessions && Array.isArray(state.sessions[workspace.title]) ? state.sessions[workspace.title] : null;
          (workspace.sessions || []).forEach(function (session) {
            nextSessions[workspace.title][session.sessionId] = !chosenSessions || chosenSessions.indexOf(session.sessionId) >= 0;
          });
        });
        setSelected(nextSelected);
        setSessionSelected(nextSessions);
      }, []);

      var load = useCallback(async function (resetLists) {
        var data = await Promise.all([api('/status'), api('/workspaces'), api('/state')]);
        var s = data[0];
        var w = data[1].workspaces || [];
        var st = data[2].state || {};
        setStatus(s);
        setWorkspaces(w);
        setTargetRoot(function (prev) { return prev || s.suggestedTargetRoot || ''; });
        if (resetLists || !loadedRef.current) {
          applyStateLists(w, null);
          loadedRef.current = true;
        }
        if (st && (st.lastPack || st.lastRestore)) {
          setSaved(st);
          setResumeVisible(true);
          if (st.archive) setArchive(st.archive);
          if (st.lastPack) setLastArchive(st.lastPack);
        }
        return { workspaces: w, state: st };
      }, [applyStateLists]);

      useEffect(function () {
        load(true).catch(function (e) { setError(String(e.message || e)); });
      }, [load]);

      var checkUpdate = async function (silent) {
        setUpdateBusy('check');
        try {
          var response = await fetch(API + '/update/check', { cache: 'no-store' });
          var data = await response.json();
          if (!response.ok || !data.ok) throw new Error(data.error || ('HTTP ' + response.status));
          setUpdateInfo(data);
          if (!silent) setUpdateNotice(data.updateAvailable ? ('发现新版本 ' + data.latest + '，可以一键更新。') : '已经是最新版本。');
        } catch (e) {
          if (!silent) setUpdateNotice('检查更新失败：' + String(e.message || e));
        } finally {
          setUpdateBusy('');
        }
      };

      var runUpdate = async function () {
        setUpdateBusy('update');
        setUpdateNotice('正在下载并安装新版本，可能需要几十秒…');
        try {
          var response = await fetch(API + '/update', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
          var data = await response.json();
          if (!response.ok || !data.ok) throw new Error(data.error || ('HTTP ' + response.status));
          if (data.changed) {
            setUpdateInfo({ current: data.installed, latest: data.latest, updateAvailable: false, repository: 'TK9BOT/dsh-move' });
            setUpdateNotice('已更新到 ' + data.installed + '。完整退出 DSH 再打开，新版本才会生效。');
          } else {
            setUpdateInfo({ current: data.current, latest: data.latest, updateAvailable: false, repository: 'TK9BOT/dsh-move' });
            setUpdateNotice('已经是最新版本。');
          }
        } catch (e) {
          setUpdateNotice('更新失败：' + String(e.message || e));
        } finally {
          setUpdateBusy('');
        }
      };

      useEffect(function () { checkUpdate(true); }, []);

      var titles = Object.keys(selected).filter(function (title) { return selected[title]; });
      var sessionPayload = function () {
        var out = {};
        titles.forEach(function (title) {
          out[title] = Object.keys(sessionSelected[title] || {}).filter(function (id) { return sessionSelected[title][id]; });
        });
        return out;
      };

      var toggleWorkspace = function (title) {
        setSelected(function (prev) {
          var next = { ...prev };
          next[title] = !next[title];
          return next;
        });
      };
      var toggleSession = function (title, id) {
        setSessionSelected(function (prev) {
          var next = { ...prev };
          next[title] = { ...(next[title] || {}) };
          next[title][id] = !next[title][id];
          return next;
        });
      };
      var chooseAll = function (value) {
        var next = {};
        workspaces.forEach(function (workspace) { next[workspace.title] = value; });
        setSelected(next);
      };
      var rememberTarget = function () {
        if (!targetRoot) return;
        api('/state', { method: 'POST', body: JSON.stringify({ targetRoot: targetRoot, outputDir: outputDir, archive: archive, titles: titles, sessions: sessionPayload(), projectMode: projectMode, sessionMode: sessionMode, includeAttachments: includeAttachments }) }).catch(function () {});
      };

      var applyLast = function () {
        if (!saved) return;
        applyStateLists(workspaces, saved);
        if (saved.targetRoot) setTargetRoot(saved.targetRoot);
        if (saved.outputDir) setOutputDir(saved.outputDir);
        setIncludeConfig(saved.includeConfig !== false);
        setConfigMode(saved.configMode === 'overwrite' ? 'overwrite' : 'merge');
        if (saved.archive) setArchive(saved.archive);
        if (saved.lastPack) setLastArchive(saved.lastPack);
        setProjectMode(saved.projectMode === 'overwrite' ? 'overwrite' : saved.projectMode === 'skip' ? 'skip' : 'merge');
        setSessionMode(saved.sessionMode === 'replace' ? 'replace' : 'keep');
        setIncludeAttachments(saved.includeAttachments === true);
        setResumeVisible(false);
        setNotice('已沿用上次迁移的选项。确认后可以直接恢复。');
      };
      var resetLast = function () {
        setResumeVisible(false);
        setNotice('已收起上次记录；重新选择不会删除记录。');
      };

      var pack = async function () {
        if (titles.length === 0) { setError('请先勾选至少一个工作区。'); return; }
        setBusy('pack'); setError(''); setNotice(''); setResult(null);
        var saveHandle = null;
        var useOutputDir = !!outputDir.trim();
        var suggested = 'dsh-move-' + new Date().toISOString().replace(/[:.]/g, '-') + '.tar.gz';
        if (!useOutputDir && typeof window.showSaveFilePicker === 'function') {
          try {
            saveHandle = await window.showSaveFilePicker({
              suggestedName: suggested,
              types: [{ description: 'DSH 迁移归档', accept: { 'application/gzip': ['.gz', '.tgz'] } }]
            });
          } catch (e) {
            if (e && e.name === 'AbortError') { setBusy(''); setNotice('已取消保存，没有生成归档。'); return; }
            saveHandle = null;
          }
        }
        try {
          var data = await api('/pack', { method: 'POST', body: JSON.stringify({ titles: titles, sessions: sessionPayload(), includeAttachments: includeAttachments, outputDir: useOutputDir ? outputDir.trim() : undefined }) });
          setLastArchive(data.result.file);
          setArchive(data.result.file);
          if (useOutputDir) {
            setNotice('打包完成，已保存到：' + data.result.file);
          } else if (saveHandle) {
            var download = await fetch(API + '/download?path=' + encodeURIComponent(data.result.file));
            if (!download.ok) throw new Error('归档下载失败：HTTP ' + download.status);
            var writable = await saveHandle.createWritable();
            if (download.body) await download.body.pipeTo(writable);
            else await writable.write(await download.arrayBuffer());
            await writable.close();
            setNotice('打包完成，已保存到你选择的位置：' + saveHandle.name);
          } else {
            setNotice('打包完成。当前浏览器不支持系统保存对话框，归档在 DSH 的 dsh-move/exports 下，可以点“下载归档”另存。');
          }
          setResult(data.result);
          await api('/state', { method: 'POST', body: JSON.stringify({ titles: titles, sessions: sessionPayload(), archive: data.result.file, lastPack: data.result.file, lastAction: 'pack', targetRoot: targetRoot, outputDir: outputDir, projectMode: projectMode, sessionMode: sessionMode, includeAttachments: includeAttachments, includeConfig: includeConfig, configMode: configMode }) });
          setSaved({ titles: titles, sessions: sessionPayload(), archive: data.result.file, lastPack: data.result.file, lastAction: 'pack', targetRoot: targetRoot, outputDir: outputDir, projectMode: projectMode, sessionMode: sessionMode, includeAttachments: includeAttachments, includeConfig: includeConfig, configMode: configMode });
        } catch (e) { setError(String(e.message || e)); }
        finally { setBusy(''); }
      };

      var upload = async function (file) {
        if (!file) return;
        setUploading(true); setError('');
        try {
          var res = await fetch(API + '/upload', { method: 'POST', headers: { 'x-filename': file.name }, body: file });
          var data = await res.json();
          if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
          setArchive(data.file);
          setNotice('已选择归档：' + data.file);
          await api('/state', { method: 'POST', body: JSON.stringify({ archive: data.file, targetRoot: targetRoot }) });
        } catch (e) { setError(String(e.message || e)); }
        finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
      };

      var restore = async function () {
        if (titles.length === 0) { setError('请先勾选至少一个工作区。'); return; }
        if (!archive) { setError('请先选择归档文件。'); return; }
        if (!targetRoot) { setError('请先填写目标根目录。'); return; }
        var projectLabel = projectMode === 'overwrite' ? '覆盖（先备份）' : projectMode === 'skip' ? '跳过项目文件' : '合并（保留目标已有文件，只补缺失）';
        var configLabel = includeConfig ? (configMode === 'overwrite' ? '包含，冲突用归档覆盖' : '包含，保留目标已有配置') : '不包含';
        var sessionLabel = sessionMode === 'replace' ? '替换现有会话（先备份）' : '保留现有会话';
        if (!window.confirm('将从归档恢复到：\n' + targetRoot + '\n\n同名工作区会合并到已有路径。\n项目文件：' + projectLabel + '\n会话冲突：' + sessionLabel + '\n配置（插件/技能/MCP/设置）：' + configLabel + '\n\n只恢复你信任的归档：插件安装和 MCP 配置会执行第三方代码。\n\n继续？')) return;
        setBusy('restore'); setError(''); setNotice(''); setResult(null);
        try {
          var data = await api('/restore', { method: 'POST', body: JSON.stringify({
            archive: archive,
            targetRoot: targetRoot,
            titles: titles,
            sessions: sessionPayload(),
            projectMode: projectMode,
            sessionMode: sessionMode,
            includeAttachments: includeAttachments,
            includeConfig: includeConfig,
            configMode: configMode,
            mergeSameTitle: true
          }) });
          setNotice('恢复完成。工作区和会话已写入；如果左侧没有立刻出现，点下面的“刷新页面”。插件/技能/MCP/设置需要重启 DSH 后生效。');
          setResult(data.result);
          await load(false);
        } catch (e) { setError(String(e.message || e)); }
        finally { setBusy(''); }
      };

      return jsxs('div', { style: C.page, children: [
        jsxs('div', { style: C.card, children: [
          jsxs('div', { style: C.head, children: [
            jsxs('div', { children: [
              jsx('h2', { style: C.title, children: '备份与迁移' }),
              jsx('p', { style: C.sub, children: '工作区、会话、附件、插件、技能、MCP 和设置，一个归档带到另一台电脑。' }),
              jsx('div', { style: C.note, children: '第一次迁移：1 选择工作区 → 2 打包并下载 → 3 到新电脑恢复。' })
            ] }),
            jsx('div', { style: C.muted, children: status ? ('当前：' + status.profile + ' · ' + status.home) : '正在读取…' })
          ]})
        ]}),
        resumeVisible && saved ? jsxs('div', { style: C.card, children: [
          jsxs('div', { style: C.head, children: [
            jsxs('div', { children: [
              jsx('div', { style: { fontWeight: 650, fontSize: 13 }, children: '上次迁移记录' }),
              jsx('div', { style: C.sub, children: fmtTime(saved.updatedAt) + ' · ' + (saved.titles ? saved.titles.length : 0) + ' 个工作区' + (saved.targetRoot ? ' · 目标 ' + saved.targetRoot : '') })
            ]}),
            jsxs('div', { style: C.row, children: [
              jsx('button', { style: C.button, onClick: applyLast, children: '沿用上次' }),
              jsx('button', { style: C.buttonGhost, onClick: resetLast, children: '重新选择' })
            ]})
          ]}),
          jsx('div', { style: C.note, children: '沿用会恢复上次的工作区、会话、目标目录和项目/会话策略。' })
        ]}) : null,
        jsxs('div', { style: C.card, children: [
          StepHead({ title: '1. 选择工作区', hint: '勾选要带走的工作区；下面的会话可以单独取消。', right: jsxs('div', { style: C.row, children: [
            jsx('button', { style: C.buttonTiny, onClick: function () { chooseAll(true); }, children: '全选' }),
            jsx('button', { style: C.buttonTiny, onClick: function () { chooseAll(false); }, children: '清空' })
          ]}) }),
          jsx('div', { style: C.list, children: workspaces.length === 0 ? jsx('div', { style: C.muted, children: '暂无工作区。先回到 DSH 创建一个工作区。' }) : workspaces.map(function (workspace) {
            var checked = !!selected[workspace.title];
            return jsxs('div', { style: C.item, children: [
              jsxs('div', { style: C.itemHead, children: [
                jsx('input', { type: 'checkbox', style: C.checkbox, checked: checked, onChange: function () { toggleWorkspace(workspace.title); } }),
                jsxs('div', { style: { minWidth: 0, flex: 1 }, children: [
                  jsx('div', { style: { fontWeight: 600, fontSize: 13 }, children: workspace.title }),
                  jsx('div', { style: C.path, title: workspace.path, children: workspace.path }),
                  jsx('div', { style: C.muted, children: (workspace.sessions ? workspace.sessions.length : 0) + ' 个会话' })
                ]})
              ]}),
              checked && workspace.sessions && workspace.sessions.length > 0 ? jsxs('details', { style: C.details, children: [
                jsx('summary', { style: C.summary, children: '选择会话（已选 ' + workspace.sessions.filter(function (s) { return sessionSelected[workspace.title] && sessionSelected[workspace.title][s.sessionId]; }).length + ' / ' + workspace.sessions.length + '）' }),
                workspace.sessions.map(function (session) {
                  return jsxs('label', { style: C.session, children: [
                    jsx('input', { type: 'checkbox', style: C.checkbox, checked: !!(sessionSelected[workspace.title] && sessionSelected[workspace.title][session.sessionId]), onChange: function () { toggleSession(workspace.title, session.sessionId); } }),
                    jsx('span', { children: (session.title || session.sessionId) + ' · ' + fmtBytes(session.bytes) })
                  ]}, workspace.title + '/' + session.sessionId);
                })
              ]}) : null
            ]}, workspace.id);
          }) })
        ]}),
        jsxs('div', { style: C.card, children: [
          StepHead({ title: '2. 打包', hint: '生成一个归档文件；保存位置由你选择。' }),
          jsxs('div', { style: C.field, children: [
            jsx('label', { style: C.label, children: '保存目录（留空则弹出系统另存为）' }),
            jsx('input', { style: C.input, value: outputDir, placeholder: '例如 C:/Users/你/Desktop', onChange: function (e) { setOutputDir(e.target.value); }, onBlur: rememberTarget })
          ]}),
          jsxs('div', { style: C.row, children: [
            jsx('button', { style: C.button, disabled: !!busy || titles.length === 0, onClick: pack, children: busy === 'pack' ? '打包中…' : '打包并生成归档' }),
            jsxs('label', { style: C.muted, children: [jsx('input', { type: 'checkbox', style: C.checkbox, checked: includeAttachments, onChange: function (e) { setIncludeAttachments(e.target.checked); } }), ' 包含附件'] })
          ]}),
          lastArchive ? jsxs('div', { style: { ...C.cardSoft, marginTop: 10 }, children: [
            jsx('div', { style: C.muted, children: '最近归档：' + lastArchive }),
            outputDir ? jsx('div', { style: C.muted, children: '归档已在你选择的目录里，直接去该目录取文件。' }) : jsx('a', { style: C.link, href: API + '/download?path=' + encodeURIComponent(lastArchive), children: '下载归档' })
          ]}) : null
        ]}),
        jsxs('div', { style: C.card, children: [
          StepHead({ title: '3. 在新电脑恢复', hint: '选择归档和目标目录。默认只补缺失文件，不覆盖已有内容。' }),
          jsxs('div', { style: C.field, children: [
            jsx('label', { style: C.label, children: '归档文件' }),
            jsxs('div', { style: C.row, children: [
              jsx('input', { style: { ...C.input, flex: 1, minWidth: 220 }, value: archive, placeholder: 'C:/.../dsh-move-....tar.gz', onChange: function (e) { setArchive(e.target.value); } }),
              jsx('button', { style: C.buttonGhost, disabled: uploading, onClick: function () { if (fileRef.current) fileRef.current.click(); }, children: uploading ? '上传中…' : '选择文件' }),
              jsx('input', { ref: fileRef, type: 'file', accept: '.gz,.tgz,application/gzip', style: { display: 'none' }, onChange: function (e) { upload(e.target.files && e.target.files[0]); } })
            ]})
          ]}),
          jsxs('div', { style: C.field, children: [
            jsx('label', { style: C.label, children: '目标根目录（新电脑上放工作区的位置）' }),
            jsx('input', { style: C.input, value: targetRoot, onBlur: rememberTarget, onChange: function (e) { setTargetRoot(e.target.value); }, placeholder: 'C:/Users/你/Desktop' })
          ]}),
          jsx('div', { style: C.details, children: jsxs('details', { children: [
            jsx('summary', { style: C.summary, children: '高级选项（默认即可）' }),
            jsxs('div', { style: { paddingTop: 8 }, children: [
              jsxs('div', { style: { ...C.row, marginBottom: 10 }, children: [
                jsx('span', { style: C.label, children: '项目文件' }),
                jsx(Segmented, { value: projectMode, onChange: setProjectMode, options: [{ value: 'merge', label: '合并（保留已有文件）' }, { value: 'overwrite', label: '覆盖（先备份）' }, { value: 'skip', label: '跳过项目' }] })
              ]}),
              jsxs('div', { style: C.row, children: [
                jsx('span', { style: C.label, children: '会话冲突' }),
                jsx(Segmented, { value: sessionMode, onChange: setSessionMode, options: [{ value: 'keep', label: '保留现有' }, { value: 'replace', label: '替换（先备份）' }] })
              ]})
            ]})
          ]}) }),
          jsxs('div', { style: { ...C.row, marginTop: 14, justifyContent: 'space-between' }, children: [
            jsx('span', { style: C.muted, children: titles.length === 0 ? '请先勾选工作区' : '已选 ' + titles.length + ' 个工作区' }),
            jsx('button', { style: C.button, disabled: !!busy || !archive || !targetRoot || titles.length === 0, onClick: restore, children: busy === 'restore' ? '恢复中…' : '开始恢复' })
          ]})
        ]}),
        error ? jsx('div', { style: C.error, children: error }) : null,
        notice ? jsx('div', { style: C.ok, children: notice }) : null,
        result ? jsxs('div', { style: C.card, children: [
          jsx('div', { style: { fontWeight: 650, marginBottom: 6 }, children: '恢复结果' }),
          (result.projects || []).map(function (project) {
            return jsx('div', { style: C.muted, children: '工作区：' + project.title + ' → ' + project.targetPath }, project.title);
          }),
          jsx('div', { style: C.muted, children: '会话：' + ((result.sessions || []).length) + ' 个；插件安装：' + ((result.config && result.config.plugins && result.config.plugins.installed) || []).length + ' 个；技能/MCP/设置已写入。' }),
          jsx('button', { style: C.buttonGhost, onClick: function () { window.location.reload(); }, children: '刷新页面查看工作区' }),
          jsx('details', { style: C.details, children: [jsx('summary', { style: C.summary, children: '查看完整结果' }), jsx('pre', { style: C.pre, children: JSON.stringify(result, null, 2) })] })
        ]}) : null,
        jsxs('div', { style: C.card, children: [
          StepHead({ title: '4. 配置（插件 / 技能 / MCP / 设置）', hint: '和工作区一起进同一个归档；恢复时自动合并。' }),
          jsxs('label', { style: C.muted, children: [jsx('input', { type: 'checkbox', style: C.checkbox, checked: includeConfig, onChange: function (e) { setIncludeConfig(e.target.checked); } }), ' 包含插件、技能、MCP、系统设置'] }),
          includeConfig ? jsxs('div', { style: C.details, children: [jsx('div', { style: { ...C.row, marginTop: 8 }, children: [
            jsx('span', { style: C.label, children: '冲突处理' }),
            jsx(Segmented, { value: configMode, onChange: setConfigMode, options: [{ value: 'merge', label: '保留目标已有' }, { value: 'overwrite', label: '归档覆盖' }] })
          ] }), jsx('div', { style: C.note, children: '插件代码会在恢复时调用 DSH 插件安装器自动安装；技能/MCP/设置会在重启 DSH 后生效。归档包含插件设置原值，可能含 API Key，请妥善保管。' })] }) : null
        ]}),
        jsxs('div', { style: C.cardSoft, children: [
          jsxs('div', { style: C.row, children: [
            jsx('div', { style: { fontWeight: 650, fontSize: 13 }, children: '插件更新' }),
            jsx('span', { style: C.muted, children: '当前 v' + ((updateInfo && updateInfo.current) || (status && status.version) || '…') }),
            updateInfo && updateInfo.latest ? jsx('span', { style: C.muted, children: '最新 v' + updateInfo.latest }) : null,
            jsx('button', { style: C.buttonGhost, disabled: updateBusy !== '', onClick: function () { checkUpdate(false); }, children: updateBusy === 'check' ? '检查中…' : '检查更新' }),
            updateInfo && updateInfo.updateAvailable ? jsx('button', { style: C.button, disabled: updateBusy !== '', onClick: runUpdate, children: updateBusy === 'update' ? '更新中…' : ('一键更新到 v' + updateInfo.latest) }) : null
          ]}),
          jsx('div', { style: C.note, children: updateNotice || '更新会从 GitHub 重新安装 dsh-move；安装完成后需要重启 DSH。' })
        ]}),
      ]});
    }

    function MoveConfig(props) {
      if (props && props.view === 'summary') return '工作区、会话与附件的原生迁移。';
      return jsx(MovePage, {});
    }

    function apply(ctx) {
      ctx.slots.inject('settings.section', function () {
        return ctx.slots.register({
          name: 'settings.section',
          id: 'dsh-move',
          order: 20,
          label: function () { return '备份与迁移'; }
        }, MoveConfig);
      });
      ctx.slots.inject('plugins.bundle.config', function () {
        return ctx.slots.register({ name: 'plugins.bundle.config', key: CONFIG_KEY }, MoveConfig);
      });
    }

    exports.apply = apply;
    exports.inject = ['slots', 'connection'];
    exports.CONFIG_KEY = CONFIG_KEY;
    exports.MoveConfig = MoveConfig;
    exports.MovePage = MovePage;
    return module.exports;
  }
});
