import assert from 'node:assert/strict';
import fs from 'node:fs';
import { projectKey } from '../lib/engine/project-key.mjs';

assert.equal(projectKey('C:\\work\\My Project'), '--C-work-My~0020Project--');
for (const file of ['lib/index.js', 'lib/client.js', 'lib/native-restore.js', 'lib/config-migrate.js', 'cordis.patch.yml', 'icon.svg', 'README.md', 'README.zh-CN.md']) {
  assert.equal(fs.existsSync(new URL('../' + file, import.meta.url)), true, file);
}
console.log('smoke ok');
