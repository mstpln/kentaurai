import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join, relative } from 'node:path';

const migration = readFileSync(new URL('../migrations/0001_core.sql', import.meta.url), 'utf8');
const decisions = readFileSync(new URL('../docs/DECISIONS.md', import.meta.url), 'utf8');
const forbiddenTokenHashes = new Set([
  '21332bab0f011f523f061e365e353c565a31acad9ee9ee4626f5efd755f16c92',
  '4782d554cf05759705dc6906cad4a1ddd6cbb5e411fa6eea25ec5d2152cc9775'
]);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dataExtensions = new Set(['.json', '.jsonl', '.ndjson', '.csv', '.sqlite', '.sqlite3', '.db']);

function publicFiles(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.git', '.wrangler', 'coverage'].includes(name)) continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) files.push(...publicFiles(path));
    else if (stat.isFile()) files.push(path);
  }
  return files;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function containsForbiddenPrivateSourceToken(buffer) {
  const tokens = buffer.toString('utf8').toLowerCase().match(/[a-z0-9]{6,}/g) || [];
  return tokens.some((token) => forbiddenTokenHashes.has(sha256(token)));
}

test('learning registry is present from first schema version', () => {
  assert.match(migration, /learning_hypotheses/);
  assert.match(migration, /learning_observations/);
  assert.match(migration, /model_change_log/);
});

test('manual editorial import is separated from automated provider collection', () => {
  assert.match(decisions, /Manual editorial data uses a separate import path/);
  assert.match(decisions, /does not browse or collect editorial content itself/);
});

test('public repository documents generic editorial-source handling', () => {
  const publicDocs = `${decisions}\n${readFileSync(new URL('../README.md', import.meta.url), 'utf8')}`;
  assert.match(publicDocs, /generic manual editorial (import|ingestion)/);
  assert.match(publicDocs, /never identify a private editorial source/);
});

test('all public repository files avoid private editorial source tokens', () => {
  const matches = [];
  for (const file of publicFiles(root)) {
    if (containsForbiddenPrivateSourceToken(readFileSync(file))) {
      matches.push(relative(root, file));
    }
  }
  assert.deepEqual(matches, []);
});

test('public repository contains no unapproved data-like files', () => {
  const unexpected = [];
  for (const file of publicFiles(root)) {
    const repoPath = relative(root, file).replaceAll('\\', '/');
    if (!dataExtensions.has(extname(file).toLowerCase())) continue;
    if (repoPath === 'package.json' || repoPath === 'package-lock.json') continue;
    if (repoPath.startsWith('fixtures/')) continue;
    unexpected.push(repoPath);
  }
  assert.deepEqual(unexpected, []);
});

test('gitignore blocks expected private reference export patterns', () => {
  const ignore = readFileSync(new URL('../.gitignore', import.meta.url), 'utf8');
  assert.match(ignore, /private-imports\//);
  assert.match(ignore, /reference-data\//);
  assert.match(ignore, /kentaurai_V85_\*\.json/);
  assert.match(ignore, /kentaurai_V86_\*\.json/);
});
