import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateUpdate, normalizeAiOutput, buildFallbackUpdate, generateWithGitHubModels } from '../scripts/generate-update.mjs';
import { validateGeneratedJson } from '../scripts/validate-generated-json.mjs';

const SOURCE_URL = 'https://www.visit.espinho.pt/pt/eventos/';
const IPMA_URL = 'https://api.ipma.pt/open-data/forecast/warnings/warnings_www.json';

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

// --- normalizeAiOutput hardening tests ---

const testCatalog = [
  { id: 'visit_espinho_events', title: 'Visit Espinho - Eventos', url: SOURCE_URL, publisher: 'Turismo de Espinho' },
  { id: 'ipma_warnings', title: 'IPMA Avisos', url: IPMA_URL, publisher: 'IPMA' }
];

const testSnippets = [
  { topic: 'Evento', text: 'Feira local.', location: 'Espinho', sourceUrl: SOURCE_URL }
];

test('normalizeAiOutput fixes invalid generatedAt and update dateTime', () => {
  const now = new Date('2026-05-13T00:00:00.000Z');
  const aiData = {
    date: '2024-05-09',
    generatedAt: 'not-a-date',
    title: 'Teste',
    facebookDraft: 'Rascunho.',
    updates: [
      {
        topic: 'Evento',
        text: 'Feira local.',
        dateTime: 'also-invalid',
        location: 'Espinho',
        sources: [SOURCE_URL]
      }
    ],
    sources: [{ title: 'Visit Espinho', url: SOURCE_URL, publisher: 'Turismo' }],
    checkedSources: [SOURCE_URL],
    noSignificantUpdates: false
  };

  const result = normalizeAiOutput(aiData, [SOURCE_URL], testSnippets, testCatalog, now);

  assert.equal(result.date, '2026-05-13');
  assert.equal(result.generatedAt, '2026-05-13T00:00:00.000Z');
  assert.equal(result.updates.length, 1);
  assert.equal(result.updates[0].dateTime, '2026-05-13T00:00:00.000Z');
});

test('normalizeAiOutput forces root date and generatedAt to run timestamp', () => {
  const now = new Date('2026-05-13T01:02:03.000Z');
  const aiData = {
    date: '2024-05-09',
    generatedAt: '2024-05-09T12:00:00.000Z',
    title: 'Teste',
    facebookDraft: 'Rascunho.',
    updates: [],
    sources: [],
    checkedSources: [SOURCE_URL],
    noSignificantUpdates: true
  };

  const result = normalizeAiOutput(aiData, [SOURCE_URL], [], testCatalog, now);
  assert.equal(result.date, '2026-05-13');
  assert.equal(result.generatedAt, '2026-05-13T01:02:03.000Z');
});

test('normalizeAiOutput drops stale past AI updates and falls back when none remain', () => {
  const now = new Date('2026-05-13T01:02:03.000Z');
  const aiData = {
    date: '2024-05-09',
    generatedAt: '2024-05-09T12:00:00.000Z',
    title: 'Teste',
    facebookDraft: 'Rascunho.',
    updates: [
      {
        topic: 'Evento antigo',
        text: 'Evento antigo de 2024.',
        dateTime: '2024-05-09T00:00:00.000Z',
        location: 'Espinho',
        sources: [SOURCE_URL]
      }
    ],
    sources: [{ title: 'Visit Espinho', url: SOURCE_URL, publisher: 'Turismo' }],
    checkedSources: [SOURCE_URL],
    noSignificantUpdates: false
  };

  const result = normalizeAiOutput(aiData, [SOURCE_URL], testSnippets, testCatalog, now);
  assert.equal(result.date, '2026-05-13');
  assert.equal(result.generatedAt, '2026-05-13T01:02:03.000Z');
  assert.equal(result.updates.length, 1);
  assert.equal(result.updates[0].topic, 'Evento');
  assert.equal(result.updates[0].dateTime, '2026-05-13T01:02:03.000Z');
});

test('normalizeAiOutput filters out invented source URLs', () => {
  const inventedUrl = 'https://evil.example.com/fake-news';
  const aiData = {
    date: '2026-05-12',
    generatedAt: '2026-05-12T20:00:00.000Z',
    title: 'Teste',
    facebookDraft: 'Rascunho.',
    updates: [
      {
        topic: 'Evento legítimo',
        text: 'Algo real.',
        dateTime: '2026-05-12T20:00:00.000Z',
        location: 'Espinho',
        sources: [SOURCE_URL, inventedUrl]
      }
    ],
    sources: [
      { title: 'Visit Espinho', url: SOURCE_URL, publisher: 'Turismo' },
      { title: 'Fonte falsa', url: inventedUrl, publisher: 'Fake' }
    ],
    checkedSources: [SOURCE_URL],
    noSignificantUpdates: false
  };

  const result = normalizeAiOutput(aiData, [SOURCE_URL], testSnippets, testCatalog);

  assert.equal(result.updates[0].sources.length, 1);
  assert.equal(result.updates[0].sources[0], SOURCE_URL);
  assert.ok(result.sources.every((s) => s.url !== inventedUrl));
});

test('normalizeAiOutput drops update with no allowed source URL', () => {
  const inventedUrl = 'https://evil.example.com/fake';
  const aiData = {
    date: '2026-05-12',
    generatedAt: '2026-05-12T20:00:00.000Z',
    title: 'Teste',
    facebookDraft: 'Rascunho.',
    updates: [
      {
        topic: 'Claim sem fonte válida',
        text: 'Algo inventado.',
        dateTime: '2026-05-12T20:00:00.000Z',
        location: 'Espinho',
        sources: [inventedUrl]
      },
      {
        topic: 'Evento real',
        text: 'Evento verdadeiro.',
        dateTime: '2026-05-12T20:00:00.000Z',
        location: 'Espinho',
        sources: [SOURCE_URL]
      }
    ],
    sources: [],
    checkedSources: [SOURCE_URL],
    noSignificantUpdates: false
  };

  const result = normalizeAiOutput(aiData, [SOURCE_URL], testSnippets, testCatalog);

  assert.equal(result.updates.length, 1);
  assert.equal(result.updates[0].topic, 'Evento real');
  assert.equal(result.noSignificantUpdates, false);
});

test('normalizeAiOutput forces noSignificantUpdates based on final updates array', () => {
  const aiData = {
    date: '2026-05-12',
    generatedAt: '2026-05-12T20:00:00.000Z',
    title: 'Teste',
    facebookDraft: 'Rascunho.',
    updates: [
      {
        topic: 'Evento válido',
        text: 'Algo real.',
        dateTime: '2026-05-12T20:00:00.000Z',
        location: 'Espinho',
        sources: [SOURCE_URL]
      }
    ],
    sources: [],
    checkedSources: [SOURCE_URL],
    noSignificantUpdates: true
  };

  const withUpdates = normalizeAiOutput(aiData, [SOURCE_URL], testSnippets, testCatalog);
  assert.equal(withUpdates.noSignificantUpdates, false);

  const emptyAiData = {
    ...aiData,
    updates: [],
    noSignificantUpdates: false
  };
  const withoutUpdates = normalizeAiOutput(emptyAiData, [SOURCE_URL], [], testCatalog);
  assert.equal(withoutUpdates.noSignificantUpdates, true);
});

// --- GitHub Models provider tests ---

test('generateWithGitHubModels uses correct endpoint and auth header', async () => {
  let capturedUrl;
  let capturedHeaders;
  let capturedBody;

  const fakeFetch = async (url, options) => {
    capturedUrl = url;
    capturedHeaders = options.headers;
    capturedBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                date: '2026-05-12',
                generatedAt: '2026-05-12T20:00:00.000Z',
                title: 'Teste',
                facebookDraft: 'Rascunho.',
                updates: [],
                sources: [],
                checkedSources: [SOURCE_URL],
                noSignificantUpdates: true
              })
            }
          }
        ]
      })
    };
  };

  await generateWithGitHubModels(
    { snippets: [], checkedSources: [SOURCE_URL] },
    { token: 'test-github-token', model: 'openai/gpt-4.1-mini', fetchFn: fakeFetch }
  );

  assert.equal(capturedUrl, 'https://models.github.ai/inference/chat/completions');
  assert.equal(capturedHeaders.Authorization, 'Bearer test-github-token');
  assert.equal(capturedHeaders.Accept, 'application/vnd.github+json');
  assert.equal(capturedHeaders['X-GitHub-Api-Version'], '2022-11-28');
  assert.equal(capturedHeaders['Content-Type'], 'application/json');
  assert.equal(capturedBody.model, 'openai/gpt-4.1-mini');
  assert.deepEqual(capturedBody.response_format, { type: 'json_object' });
  assert.ok(capturedBody.messages.length > 0);
});

test('generateWithGitHubModels parses JSON output correctly', async () => {
  const expectedOutput = {
    date: '2026-05-12',
    generatedAt: '2026-05-12T20:00:00.000Z',
    title: 'Teste',
    facebookDraft: 'Rascunho.',
    updates: [
      { topic: 'Evento', text: 'Feira.', dateTime: '2026-05-12T20:00:00.000Z', location: 'Espinho', sources: [SOURCE_URL] }
    ],
    sources: [{ title: 'Visit Espinho', url: SOURCE_URL, publisher: 'Turismo' }],
    checkedSources: [SOURCE_URL],
    noSignificantUpdates: false
  };

  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(expectedOutput) } }] })
  });

  const result = await generateWithGitHubModels(
    { snippets: [], checkedSources: [SOURCE_URL] },
    { token: 'tok', model: 'openai/gpt-4.1-mini', fetchFn: fakeFetch }
  );

  assert.equal(result.date, '2026-05-12');
  assert.equal(result.updates.length, 1);
  assert.equal(result.updates[0].topic, 'Evento');
});

test('generateWithGitHubModels throws on API failure', async () => {
  const fakeFetch = async () => ({ ok: false, status: 500 });

  await assert.rejects(
    () => generateWithGitHubModels({ snippets: [], checkedSources: [] }, { token: 'tok', model: 'm', fetchFn: fakeFetch }),
    { message: /GitHub Models request failed with 500/ }
  );
});

test('generateUpdate falls back safely when GitHub Models API fails', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'espinho-ghmodels-fallback-'));

  const failingGitHubModelsFn = async () => {
    throw new Error('API down');
  };

  const output = await generateUpdate({
    rootDir,
    env: {
      USE_MOCK_DATA: 'false',
      AI_PROVIDER: 'github-models',
      GITHUB_TOKEN: 'test-token'
    },
    collectSnippetsFn: async () => ({
      snippets: [{ topic: 'Evento', text: 'Feira local.', location: 'Espinho', sourceUrl: SOURCE_URL }],
      checkedSources: [SOURCE_URL]
    }),
    generateWithGitHubModelsFn: failingGitHubModelsFn,
    now: new Date('2026-05-12T20:00:00.000Z')
  });

  assert.equal(output.updates.length, 1);
  assert.equal(output.noSignificantUpdates, false);
  assert.match(output.facebookDraft, /Rascunho gerado por IA/);
});

test('generateUpdate writes archive using normalized run date, not LLM root date', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'espinho-normalized-date-'));
  const now = new Date('2026-05-13T01:02:03.000Z');

  await generateUpdate({
    rootDir,
    env: {
      USE_MOCK_DATA: 'false',
      AI_PROVIDER: 'github-models',
      GITHUB_TOKEN: 'test-token'
    },
    collectSnippetsFn: async () => ({
      snippets: [{ topic: 'Evento', text: 'Feira local.', location: 'Espinho', sourceUrl: SOURCE_URL }],
      checkedSources: [SOURCE_URL]
    }),
    generateWithGitHubModelsFn: async () => ({
      date: '2024-05-09',
      generatedAt: '2024-05-09T12:00:00.000Z',
      title: 'Teste',
      facebookDraft: 'Rascunho.',
      updates: [
        {
          topic: 'Evento',
          text: 'Feira local.',
          dateTime: '2026-05-13T01:02:03.000Z',
          location: 'Espinho',
          sources: [SOURCE_URL]
        }
      ],
      sources: [{ title: 'Visit Espinho', url: SOURCE_URL, publisher: 'Turismo' }],
      checkedSources: [SOURCE_URL],
      noSignificantUpdates: false
    }),
    now
  });

  const latest = await readJson(path.join(rootDir, 'public', 'data', 'latest.json'));
  const archived = await readJson(path.join(rootDir, 'public', 'data', 'archive', '2026-05-13.json'));
  const index = await readJson(path.join(rootDir, 'public', 'data', 'archive', 'index.json'));

  assert.equal(latest.date, '2026-05-13');
  assert.equal(latest.generatedAt, '2026-05-13T01:02:03.000Z');
  assert.deepEqual(latest, archived);
  assert.deepEqual(index, ['2026-05-13']);
  await assert.rejects(() => readFile(path.join(rootDir, 'public', 'data', 'archive', '2024-05-09.json'), 'utf-8'));
});

test('validateGeneratedJson rejects stale latest date when expected run date is provided', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'espinho-stale-validation-'));
  const archiveDir = path.join(rootDir, 'public', 'data', 'archive');
  await mkdir(archiveDir, { recursive: true });

  const stalePayload = buildFallbackUpdate({
    snippets: [{ topic: 'Evento', text: 'Feira local.', location: 'Espinho', sourceUrl: SOURCE_URL }],
    checkedSources: [SOURCE_URL],
    now: new Date('2024-05-09T12:00:00.000Z'),
    catalog: testCatalog
  });

  await writeFile(path.join(rootDir, 'public', 'data', 'latest.json'), `${JSON.stringify(stalePayload, null, 2)}\n`, 'utf-8');
  await writeFile(path.join(archiveDir, '2024-05-09.json'), `${JSON.stringify(stalePayload, null, 2)}\n`, 'utf-8');
  await writeFile(path.join(archiveDir, 'index.json'), `${JSON.stringify(['2024-05-09'], null, 2)}\n`, 'utf-8');

  await assert.rejects(
    () => validateGeneratedJson({ rootDir, expectedDate: '2026-05-13' }),
    /latest\.json\.date must match expected run date 2026-05-13/
  );
});
