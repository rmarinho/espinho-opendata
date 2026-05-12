import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateUpdate } from '../scripts/generate-update.mjs';

const SOURCE_URL = 'https://www.visit.espinho.pt/pt/eventos/';

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf-8'));
}

test('real-source no-snippet fallback yields noSignificantUpdates=true and no mock updates', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'espinho-updates-test-'));

  const output = await generateUpdate({
    rootDir,
    env: {
      USE_MOCK_DATA: 'false',
      AI_PROVIDER: 'none'
    },
    collectSnippetsFn: async () => ({
      snippets: [],
      checkedSources: [SOURCE_URL]
    }),
    now: new Date('2026-05-12T20:00:00.000Z')
  });

  assert.equal(output.updates.length, 0);
  assert.equal(output.noSignificantUpdates, true);
  assert.match(output.facebookDraft, /Rascunho gerado por IA/);
  assert.doesNotMatch(output.facebookDraft, /agenda do Visit Espinho/i);
});

test('generateUpdate writes latest, date archive file, and updates archive index', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'espinho-updates-archive-'));
  const archiveDir = path.join(rootDir, 'public', 'data', 'archive');
  await mkdir(archiveDir, { recursive: true });
  await writeFile(path.join(archiveDir, 'index.json'), JSON.stringify(['2026-05-11'], null, 2), 'utf-8');

  const output = await generateUpdate({
    rootDir,
    env: {
      USE_MOCK_DATA: 'false',
      AI_PROVIDER: 'none'
    },
    collectSnippetsFn: async () => ({
      snippets: [
        {
          topic: 'Evento em Espinho',
          text: 'Feira local no fim de semana.',
          location: 'Espinho',
          sourceUrl: SOURCE_URL
        }
      ],
      checkedSources: [SOURCE_URL]
    }),
    now: new Date('2026-05-12T20:10:00.000Z')
  });

  const latest = await readJson(path.join(rootDir, 'public', 'data', 'latest.json'));
  const archived = await readJson(path.join(rootDir, 'public', 'data', 'archive', `${output.date}.json`));
  const index = await readJson(path.join(rootDir, 'public', 'data', 'archive', 'index.json'));

  assert.equal(latest.date, '2026-05-12');
  assert.deepEqual(latest, archived);
  assert.deepEqual(index, ['2026-05-12', '2026-05-11']);
});
