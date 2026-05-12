import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { MAX_UPDATES, assertValidUpdateSchema } from './update-schema.mjs';
import { mockSnippets, sourceCatalog } from './source-catalog.mjs';

const ROOT = process.cwd();
const MIN_TEXT_BLOCK_LENGTH = 30;
const DEFAULT_SNIPPET_MAX_CHARS = 360;
const IPMA_WARNING_MAX_CHARS = 380;
const RELEVANCE_KEYWORDS = ['espinho', 'aveiro'];
const NOTICE_FOOTER_PREFIX = '⚠️ Rascunho gerado por IA para revisão (não publicação oficial).';
const PORTUGUESE_MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export function getRuntimeConfig(env = process.env) {
  return {
    useMockData: (env.USE_MOCK_DATA ?? 'true').toLowerCase() !== 'false',
    aiProvider: (env.AI_PROVIDER ?? 'openai').toLowerCase(),
    openAiApiKey: env.OPENAI_API_KEY,
    openAiModel: env.OPENAI_MODEL ?? 'gpt-4.1-mini'
  };
}

export function stripHtml(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function htmlToBlocks(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<(\/p|\/li|\/h1|\/h2|\/h3|\/article|\/section|\/div|br\s*\/?)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length >= MIN_TEXT_BLOCK_LENGTH)
    // Visit/Diário pages often include many interleaved cards; keeping a wider window improves event/article capture.
    .slice(0, 220);
}

function isHttpUrl(url) {
  return /^https?:\/\//.test(String(url));
}

function isRelevantLocalText(text) {
  const lower = String(text).toLowerCase();
  return RELEVANCE_KEYWORDS.some((keyword) => lower.includes(keyword));
}

function hasDateLikeToken(text) {
  const lower = String(text).toLowerCase();
  if (/\b\d{1,2}[\/\-.]\d{1,2}(?:[\/\-.]\d{2,4})?\b/.test(lower)) return true;
  if (/\b\d{4}-\d{2}-\d{2}\b/.test(lower)) return true;
  return PORTUGUESE_MONTHS.some((month) => lower.includes(` ${month}`) || lower.includes(`${month} `));
}

export function pickRelevantText(blocks, keywords, maxChars = DEFAULT_SNIPPET_MAX_CHARS) {
  if (!Array.isArray(blocks) || !blocks.length) return null;

  const lowerKeywords = keywords.map((key) => key.toLowerCase());
  const matches = blocks.filter((block) => lowerKeywords.some((key) => block.toLowerCase().includes(key)));
  const candidates = matches.length ? matches : blocks;

  let text = '';
  for (const line of candidates) {
    if ((text + ' ' + line).trim().length > maxChars) break;
    text = `${text} ${line}`.trim();
    // Aim for richer snippets while still concise enough for the daily summary payload.
    if (text.length >= maxChars * 0.75) break;
  }

  return text || null;
}

function getSourceMeta(url, catalog = sourceCatalog) {
  return catalog.find((source) => source.url === url) ?? null;
}

function getPublisherByUrl(url, catalog = sourceCatalog) {
  return getSourceMeta(url, catalog)?.publisher ?? 'Fonte pública';
}

function snippetFromText({ topic, text, location, sourceUrl }) {
  if (!text || !sourceUrl) return null;
  return {
    topic,
    text: String(text).trim().slice(0, 420),
    location,
    sourceUrl
  };
}

export function parseIpmaRelevantWarnings(raw, now = new Date()) {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return [];
  }

  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.warnings)
        ? payload.warnings
        : [];

  return list
    .map((entry) => {
      const district = String(entry?.district ?? entry?.districtName ?? entry?.region ?? '').trim();
      const area = String(entry?.county ?? entry?.local ?? entry?.locality ?? '').trim();
      const text = String(entry?.textWarning ?? entry?.text ?? entry?.description ?? '').trim();
      const level = String(entry?.awarenessLevelID ?? entry?.level ?? '').trim();
      const start = String(entry?.startTime ?? entry?.validFrom ?? entry?.begin ?? '').trim();

      const combined = `${district} ${area} ${text}`.toLowerCase();
      const isRelevant = combined.includes('aveiro') || combined.includes('espinho');
      if (!isRelevant || !text) return null;

      return {
        topic: 'IPMA - Aviso meteorológico relevante',
        text: `${text}${level ? ` (nível ${level})` : ''}`.slice(0, IPMA_WARNING_MAX_CHARS),
        dateTime: start && !Number.isNaN(Date.parse(start)) ? new Date(start).toISOString() : now.toISOString(),
        location: area || district || 'Espinho',
        sourceUrl: 'https://api.ipma.pt/open-data/forecast/warnings/warnings_www.json'
      };
    })
    .filter(Boolean)
    .slice(0, 3);
}

export function extractVisitEspinhoEventSnippets(html, source) {
  const blocks = htmlToBlocks(html);
  const snippets = [];

  for (let index = 0; index < blocks.length; index += 1) {
    const line = blocks[index];
    const lower = line.toLowerCase();
    const isEventLike = /evento|agenda|festival|concerto|espetáculo|exposi[çc][ãa]o|workshop|feira/.test(lower);
    const titleLike = line.length >= 18 && line.length <= 150;
    if (!isEventLike || !titleLike) continue;

    const nearby = [blocks[index + 1], blocks[index + 2]].filter(Boolean);
    const dateLine = [line, ...nearby].find((candidate) => hasDateLikeToken(candidate));
    const locationLine = [line, ...nearby].find((candidate) => /espinho|auditório|casino|multimeios|biblioteca|praia|fórum/i.test(candidate));
    const detailBits = [];
    if (dateLine) detailBits.push(`Data: ${dateLine.slice(0, 90)}`);
    if (locationLine) detailBits.push(`Local: ${locationLine.slice(0, 90)}`);

    const text = detailBits.length ? `${line}. ${detailBits.join(' · ')}` : line;
    snippets.push(
      snippetFromText({
        topic: 'Evento em Espinho',
        text,
        location: 'Espinho',
        sourceUrl: source.url
      })
    );

    if (snippets.length >= 4) break;
  }

  const filtered = snippets.filter(Boolean);
  if (filtered.length) return filtered;

  const broad = pickRelevantText(blocks, ['evento', 'agenda', 'espinho', 'festival', 'concerto']);
  return broad
    ? [
        snippetFromText({
          topic: 'Eventos em Espinho',
          text: broad,
          location: 'Espinho',
          sourceUrl: source.url
        })
      ]
    : [];
}

export function extractDiarioAveiroSnippets(html, source) {
  const blocks = htmlToBlocks(html);
  const noise = /(menu|navega|pesquisa|subscr|newsletter|facebook|instagram|whatsapp|cookies|aceitar|publicidade|entrar|login)/i;
  const titleLine = /[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ]/;
  const snippets = [];

  for (let index = 0; index < blocks.length; index += 1) {
    const line = blocks[index];
    if (noise.test(line)) continue;
    if (!isRelevantLocalText(line)) continue;
    if (!titleLine.test(line) || line.length < 24 || line.length > 170) continue;

    const next = blocks[index + 1] ?? '';
    const dateLine = hasDateLikeToken(line) ? line : hasDateLikeToken(next) ? next : '';
    const text = dateLine && dateLine !== line ? `${line}. Data: ${dateLine.slice(0, 80)}` : line;

    snippets.push(
      snippetFromText({
        topic: 'Notícia local (Diário de Aveiro)',
        text,
        location: 'Espinho',
        sourceUrl: source.url
      })
    );

    if (snippets.length >= 4) break;
  }

  return snippets.filter(Boolean);
}

export function extractSnippetsFromHtmlSource(source, html) {
  const blocks = htmlToBlocks(html);

  switch (source.id) {
    case 'municipio': {
      const text = pickRelevantText(blocks, ['espinho', 'município', 'câmara', 'edital', 'aviso']);
      return text
        ? [snippetFromText({ topic: 'Município de Espinho', text, location: 'Espinho', sourceUrl: source.url })]
        : [];
    }
    case 'visit_espinho_events':
      return extractVisitEspinhoEventSnippets(html, source);
    case 'cp_notices': {
      const text = pickRelevantText(blocks, ['aviso', 'interrupção', 'supressão', 'atraso', 'espinho', 'aveiro']);
      if (!text || !isRelevantLocalText(text)) return [];
      return [snippetFromText({ topic: 'Avisos CP', text, location: 'Linha do Norte / Espinho', sourceUrl: source.url })];
    }
    case 'ip_alerts': {
      const text = pickRelevantText(blocks, ['condicionamento', 'trânsito', 'obra', 'alerta', 'espinho', 'aveiro']);
      if (!text || !isRelevantLocalText(text)) return [];
      return [snippetFromText({ topic: 'Infraestruturas e Mobilidade', text, location: 'Espinho / Aveiro', sourceUrl: source.url })];
    }
    case 'diario_aveiro_espinho':
      return extractDiarioAveiroSnippets(html, source);
    default: {
      const text = pickRelevantText(blocks, RELEVANCE_KEYWORDS) ?? stripHtml(html).slice(0, 320);
      return text ? [snippetFromText({ topic: source.title, text, location: 'Espinho', sourceUrl: source.url })] : [];
    }
  }
}

export async function fetchWithTimeout(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'espinho-updates-bot/1.0 (+https://github.com/rmarinho/espinho-opendata)'
      }
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function dedupeSnippets(snippets) {
  const deduped = [];
  const seen = new Set();

  for (const snippet of snippets) {
    const key = createHash('sha256')
      .update(`${snippet.topic}|${snippet.location}|${snippet.text}`.toLowerCase().trim())
      .digest('hex');
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(snippet);
  }

  return deduped;
}

export async function collectSnippets({ useMockData, fetchFn = fetchWithTimeout, catalog = sourceCatalog, now = new Date() }) {
  if (useMockData) {
    return {
      snippets: mockSnippets,
      checkedSources: catalog.map((source) => source.url)
    };
  }

  const checkedSources = [];
  const snippets = [];

  for (const source of catalog) {
    checkedSources.push(source.url);
    const content = await fetchFn(source.url);
    if (!content) continue;

    if (source.id === 'ipma_warnings') {
      snippets.push(...parseIpmaRelevantWarnings(content, now));
      continue;
    }

    snippets.push(...extractSnippetsFromHtmlSource(source, content));
  }

  return { snippets: dedupeSnippets(snippets), checkedSources };
}

function sourceLabelsFromUrls(sourceUrls, catalog = sourceCatalog) {
  const labels = sourceUrls
    .map((url) => getSourceMeta(url, catalog)?.title ?? url)
    .filter(Boolean)
    .slice(0, 4);
  return labels.length ? labels.join('; ') : 'fontes públicas verificáveis';
}

export function ensureDraftFooter(baseDraft, sourceUrls, catalog = sourceCatalog) {
  const trimmed = String(baseDraft ?? '').trim();
  const withoutFooter = trimmed.includes(NOTICE_FOOTER_PREFIX) ? trimmed.split(NOTICE_FOOTER_PREFIX)[0].trim() : trimmed;
  const labels = sourceLabelsFromUrls(sourceUrls, catalog);
  return `${withoutFooter}\n\n${NOTICE_FOOTER_PREFIX} Fontes: ${labels}.`;
}

export function buildFallbackUpdate({ snippets, checkedSources, now = new Date(), catalog = sourceCatalog }) {
  const date = now.toISOString().slice(0, 10);
  const updates = snippets.slice(0, MAX_UPDATES).map((snippet) => ({
    topic: snippet.topic,
    text: snippet.text,
    dateTime: now.toISOString(),
    location: snippet.location,
    sources: [snippet.sourceUrl]
  }));

  const uniqueSourcesFromUpdates = Array.from(new Set(updates.flatMap((update) => update.sources))).filter(isHttpUrl);
  const sourceUrls = uniqueSourcesFromUpdates.length ? uniqueSourcesFromUpdates : Array.from(new Set(checkedSources)).filter(isHttpUrl);
  const noSignificantUpdates = updates.length === 0;

  const baseDraft = noSignificantUpdates
    ? 'Boa noite, comunidade de Espinho. Hoje não foram identificadas atualizações locais significativas nas fontes públicas verificadas. Há algum tema local que queiram que seja monitorizado amanhã?'
    : 'Boa noite, comunidade de Espinho! Segue um rascunho rápido com os principais pontos locais do dia, com fontes públicas para verificação. O que consideram mais relevante para acompanhar amanhã?';

  return {
    date,
    generatedAt: now.toISOString(),
    title: `Atualização diária de Espinho - ${date}`,
    facebookDraft: ensureDraftFooter(baseDraft, sourceUrls, catalog),
    updates,
    sources: sourceUrls.map((url) => ({
      title: getSourceMeta(url, catalog)?.title ?? 'Fonte pública',
      url,
      publisher: getPublisherByUrl(url, catalog)
    })),
    checkedSources,
    noSignificantUpdates
  };
}

export function normalizeAiOutput(data, checkedSources, fallbackSnippets, catalog = sourceCatalog) {
  const fallback = buildFallbackUpdate({ snippets: fallbackSnippets, checkedSources, catalog });
  if (!data || typeof data !== 'object') return fallback;

  const nowIso = new Date().toISOString();
  const date = typeof data.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.date) ? data.date : nowIso.slice(0, 10);

  const updates = Array.isArray(data.updates)
    ? data.updates
        .slice(0, MAX_UPDATES)
        .map((update) => ({
          topic: String(update?.topic ?? '').slice(0, 120),
          text: String(update?.text ?? '').slice(0, 420),
          dateTime: String(update?.dateTime ?? nowIso),
          location: String(update?.location ?? 'Espinho').slice(0, 120),
          sources: Array.isArray(update?.sources) ? update.sources.map(String).filter(isHttpUrl).slice(0, 4) : []
        }))
        .filter((update) => update.topic && update.text)
    : [];

  const allSources = Array.isArray(data.sources)
    ? data.sources
        .map((source) => ({
          title: String(source?.title ?? '').slice(0, 120),
          url: String(source?.url ?? ''),
          publisher: String(source?.publisher ?? '').slice(0, 120)
        }))
        .filter((source) => isHttpUrl(source.url))
    : [];

  const normalized = {
    date,
    generatedAt: typeof data.generatedAt === 'string' ? data.generatedAt : nowIso,
    title: typeof data.title === 'string' ? data.title.slice(0, 200) : fallback.title,
    facebookDraft: typeof data.facebookDraft === 'string' ? data.facebookDraft.slice(0, 1200) : fallback.facebookDraft,
    updates,
    sources: allSources,
    checkedSources: Array.isArray(checkedSources) ? checkedSources.filter(isHttpUrl) : [],
    noSignificantUpdates: Boolean(data.noSignificantUpdates ?? updates.length === 0)
  };

  if (!normalized.updates.length && !normalized.noSignificantUpdates) {
    normalized.noSignificantUpdates = true;
  }

  if (!normalized.sources.length) {
    normalized.sources = fallback.sources;
  }

  const draftSourceUrls = Array.from(
    new Set([
      ...normalized.sources.map((source) => source.url),
      ...normalized.updates.flatMap((update) => update.sources),
      ...normalized.checkedSources
    ])
  ).filter(isHttpUrl);

  normalized.facebookDraft = ensureDraftFooter(normalized.facebookDraft || fallback.facebookDraft, draftSourceUrls, catalog);

  return normalized;
}

export async function generateWithOpenAI(input, { apiKey, model, fetchFn = fetch } = {}) {
  const prompt = `És um assistente editorial local para Espinho, Portugal.\n\nContexto e restrições:\n- Usar APENAS a informação fornecida em snippets de fontes públicas verificáveis.\n- Ignorar rumores, posts sem validação, spam promocional e notícias nacionais sem ligação clara a Espinho.\n- Deduplicar histórias repetidas.\n- Escrever em português (PT), tom adequado a grupo local de Facebook.\n- Texto conciso, com abertura amigável e pergunta final para engagement.\n- Citar links de fontes.\n- Evitar qualquer afirmação não suportada pelos snippets.\n\nIMPORTANTE DE CUSTO/PREVISIBILIDADE:\n- Priorizar uma saída curta e direta.\n- Se não houver dados relevantes, devolver updates=[] e noSignificantUpdates=true.\n\nResponder APENAS em JSON estrito com este schema:\n{\n  "date": "YYYY-MM-DD",\n  "generatedAt": "ISO_DATETIME",\n  "title": "string",\n  "facebookDraft": "string",\n  "updates": [\n    {\n      "topic": "string",\n      "text": "string",\n      "dateTime": "ISO_DATETIME",\n      "location": "string",\n      "sources": ["https://..."]\n    }\n  ],\n  "sources": [\n    {\n      "title": "string",\n      "url": "https://...",\n      "publisher": "string"\n    }\n  ],\n  "checkedSources": ["https://..."],\n  "noSignificantUpdates": true\n}\n\nInput JSON:\n${JSON.stringify(input)}`;

  const response = await fetchFn('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1200,
      response_format: { type: 'json_object' }
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed with ${response.status}`);
  }

  const payload = await response.json();
  const text = payload?.choices?.[0]?.message?.content;
  if (!text) throw new Error('Missing completion content from OpenAI response');

  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('OpenAI output is not valid JSON');
    return JSON.parse(match[0]);
  }
}

export function buildDataPaths(rootDir = ROOT) {
  const publicDir = path.join(rootDir, 'public');
  const dataDir = path.join(publicDir, 'data');
  const archiveDir = path.join(dataDir, 'archive');
  return {
    publicDir,
    dataDir,
    archiveDir,
    latestPath: path.join(dataDir, 'latest.json'),
    archiveIndexPath: path.join(archiveDir, 'index.json')
  };
}

export async function generateUpdate({
  rootDir = ROOT,
  env = process.env,
  catalog = sourceCatalog,
  collectSnippetsFn = collectSnippets,
  generateWithOpenAIFn = generateWithOpenAI,
  now = new Date()
} = {}) {
  const config = getRuntimeConfig(env);
  const paths = buildDataPaths(rootDir);
  await mkdir(paths.archiveDir, { recursive: true });

  const collected = await collectSnippetsFn({
    useMockData: config.useMockData,
    catalog,
    now
  });

  const checkedSources = Array.isArray(collected.checkedSources) ? collected.checkedSources : [];
  const snippets = Array.isArray(collected.snippets) ? collected.snippets : [];

  let output;
  const llmEnabled = config.aiProvider === 'openai' && config.openAiApiKey;

  if (llmEnabled) {
    try {
      const aiOutput = await generateWithOpenAIFn(
        { snippets, checkedSources },
        {
          apiKey: config.openAiApiKey,
          model: config.openAiModel
        }
      );
      output = normalizeAiOutput(aiOutput, checkedSources, snippets, catalog);
    } catch {
      output = buildFallbackUpdate({ snippets, checkedSources, now, catalog });
    }
  } else {
    output = buildFallbackUpdate({ snippets, checkedSources, now, catalog });
  }

  assertValidUpdateSchema(output);

  const archivePath = path.join(paths.archiveDir, `${output.date}.json`);

  let archiveIndex = [];
  try {
    const existing = JSON.parse(await readFile(paths.archiveIndexPath, 'utf-8'));
    if (Array.isArray(existing)) archiveIndex = existing;
  } catch {
    archiveIndex = [];
  }

  const nextIndex = Array.from(new Set([output.date, ...archiveIndex])).sort((a, b) => (a > b ? -1 : 1));

  await writeFile(paths.latestPath, `${JSON.stringify(output, null, 2)}\n`, 'utf-8');
  await writeFile(archivePath, `${JSON.stringify(output, null, 2)}\n`, 'utf-8');
  await writeFile(paths.archiveIndexPath, `${JSON.stringify(nextIndex, null, 2)}\n`, 'utf-8');

  return output;
}

export async function runCli() {
  try {
    const output = await generateUpdate();
    process.stdout.write(`Generated update for ${output.date}\n`);
  } catch (error) {
    process.stderr.write(`Failed to generate update: ${error.message}\n`);
    process.exitCode = 1;
  }
}

const directExecutionTarget = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === directExecutionTarget) {
  runCli();
}
