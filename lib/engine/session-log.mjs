import zlib from 'node:zlib';

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const SESSION_LOG_RE = /^session(?:\.v([1-9][0-9]*))?\.jsonl(?:\.zstd)?$/;

export function zstdAvailable() {
  return typeof zlib.zstdDecompressSync === 'function' && typeof zlib.zstdCompressSync === 'function';
}

function frameStarts(buf) {
  const starts = [];
  for (let i = 0; i <= buf.length - 4; i += 1) {
    if (buf[i] === 0x28 && buf[i + 1] === 0xb5 && buf[i + 2] === 0x2f && buf[i + 3] === 0xfd) starts.push(i);
  }
  return starts;
}

/** Decode a concatenated zstd frame stream. Throws if any frame is invalid. */
export function decodeFrames(buf) {
  if (!zstdAvailable()) throw new Error('Node zstd API unavailable (need Node 22.15+/24)');
  const starts = frameStarts(buf);
  if (starts.length === 0 || starts[0] !== 0) throw new Error('not a zstd frame stream');
  const frames = [];
  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1] : buf.length;
    let text;
    try {
      text = zlib.zstdDecompressSync(buf.subarray(start, end)).toString('utf8');
    } catch (error) {
      throw new Error('invalid zstd frame at offset ' + start + ': ' + error.message);
    }
    frames.push({ start, end, text });
  }
  return frames;
}

function tryDecodeAll(buf) {
  try {
    return decodeFrames(buf);
  } catch {
    return null;
  }
}

/**
 * Live copies can end in a partially written frame. Keep the longest prefix that
 * decodes completely; never invent bytes.
 */
export function sanitizeSessionBuffer(buf) {
  if (tryDecodeAll(buf)) return { buffer: buf, trimmed: false };
  const starts = frameStarts(buf);
  for (let i = starts.length - 1; i > 0; i -= 1) {
    const candidate = buf.subarray(0, starts[i]);
    if (tryDecodeAll(candidate)) return { buffer: candidate, trimmed: true };
  }
  throw new Error('session log has no complete zstd frame');
}

export function readSessionHeader(buf) {
  const frames = decodeFrames(buf);
  if (frames.length === 0) throw new Error('empty session log');
  const lines = frames[0].text.replace(/\r\n/g, '\n').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  return null;
}

export function sessionHeaderCwd(buf) {
  try {
    const header = readSessionHeader(buf);
    return header && typeof header.cwd === 'string' ? header.cwd : null;
  } catch {
    return null;
  }
}

/**
 * Rewrite the first frame's cwd. All other frames are preserved byte-for-byte.
 * Returns the original buffer unchanged when there is no cwd to rewrite.
 */
export function rewriteSessionCwd(buf, newCwd) {
  const starts = frameStarts(buf);
  if (starts.length === 0 || starts[0] !== 0) throw new Error('not a zstd frame stream');
  const firstEnd = starts.length > 1 ? starts[1] : buf.length;
  const text = zlib.zstdDecompressSync(buf.subarray(0, firstEnd)).toString('utf8');
  const hasNewline = text.endsWith('\n');
  const lines = (hasNewline ? text.slice(0, -1) : text).split('\n');
  if (lines.length === 0) return { buffer: buf, changed: false };
  let header;
  try {
    header = JSON.parse(lines[0]);
  } catch {
    return { buffer: buf, changed: false };
  }
  if (!header || typeof header !== 'object' || !Object.prototype.hasOwnProperty.call(header, 'cwd')) {
    return { buffer: buf, changed: false };
  }
  if (header.cwd === newCwd) return { buffer: buf, changed: false };
  header.cwd = newCwd;
  lines[0] = JSON.stringify(header);
  const newText = lines.join('\n') + (hasNewline ? '\n' : '');
  const newFirst = zlib.zstdCompressSync(Buffer.from(newText, 'utf8'));
  const out = Buffer.concat([newFirst, buf.subarray(firstEnd)]);
  decodeFrames(out); // verify the whole stream still decodes
  return { buffer: out, changed: true };
}

/** Rewrite the first JSONL line's cwd for uncompressed session logs. */
export function rewriteRawCwd(buf, newCwd) {
  const text = buf.toString('utf8');
  const hasNewline = text.endsWith('\n');
  const lines = (hasNewline ? text.slice(0, -1) : text).split('\n');
  if (lines.length === 0) return { buffer: buf, changed: false };
  let header;
  try {
    header = JSON.parse(lines[0]);
  } catch {
    return { buffer: buf, changed: false };
  }
  if (!header || typeof header !== 'object' || !Object.prototype.hasOwnProperty.call(header, 'cwd')) {
    return { buffer: buf, changed: false };
  }
  if (header.cwd === newCwd) return { buffer: buf, changed: false };
  header.cwd = newCwd;
  lines[0] = JSON.stringify(header);
  return { buffer: Buffer.from(lines.join('\n') + (hasNewline ? '\n' : ''), 'utf8'), changed: true };
}

export function isSessionLogName(name) {
  return SESSION_LOG_RE.test(name);
}

export function sessionGeneration(name) {
  const match = SESSION_LOG_RE.exec(name);
  return match && match[1] ? Number(match[1]) : 0;
}

/** Pick the newest generation / compressed main log in a session directory. */
export function pickMainLog(fileNames) {
  const logs = fileNames
    .filter(isSessionLogName)
    .sort((a, b) => {
      const ga = sessionGeneration(a);
      const gb = sessionGeneration(b);
      if (ga !== gb) return gb - ga;
      return b.endsWith('.zstd') ? 1 : -1;
    });
  return logs[0] ?? null;
}
