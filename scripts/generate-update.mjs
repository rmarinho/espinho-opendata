import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assertValidUpdateSchema } from './update-schema.mjs';

const ROOT = process.cwd();
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(PUBLIC_DIR, 'data');
const ARCHIVE_DIR = path.join(DATA_DIR, 'archive');

const USE_MOCK_DATA = (process.env.USE_MOCK_DATA ?? 'true').toLowerCase() !== 'false';
const AI_PROVIDER = (process.env.AI_PROVIDER ?? 'openai').toLowerCase();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? 'gpt-4.1-mini';

const sourceCatalog = [
  { id: 'municipio', title: 'Município de Espinho', url: 'https://www.cm-espinho.pt/', publisher: 'Município de Espinho' },
  { id: 'visit_espinho_events', title: 'Visit Espinho - Eventos', url: 'https://www.visit.espinho.pt/pt/eventos/', publisher: 'Turismo de Espinho' },
  { id: 'ipma_warnings', title: 'IPMA Avisos Meteorológicos', url: 'https://api.ipma.pt/open-data/forecast/warnings/warnings_www.json', publisher: 'IPMA' },
  { id: 'cp_notices', title: 'CP - Comboios de Portugal', url: 'https://www.cp.pt/passageiros/pt/consultar-horarios/avisos', publisher: 'CP' },
  { id: 'ip_alerts', title: 'Infraestruturas de Portugal', url: 'https://www.infraestruturasdeportugal.pt/pt-pt/alertas', publisher: 'Infraestruturas de Portugal' },
  { id: 'diario_aveiro_espinho', title: 'Diário de Aveiro - Espinho', url: 'https://www.diarioaveiro.pt/regiao/espinho/', publisher: 'Diário de Aveiro' }
];

const mockSnippets = [
  {
    topic: 'Eventos Locais',
    text: 'A agenda do Visit Espinho destaca atividades culturais e comunitárias para os próximos dias.',
    location: 'Espinho',
    sourceUrl: 'https://www.visit.espinho.pt/pt/eventos/'
  },
  {
    topic: 'Condições Meteorológicas',
    text: 'Consulte os avisos públicos do IPMA para acompanhar alterações meteorológicas com impacto em Aveiro/Espinho.',
    location: 'Espinho',
    sourceUrl: 'https://api.ipma.pt/open-data/forecast/warnings/warnings_www.json'
  },
  {
    topic: 'Transportes',
    text: 'Antes de viajar, confirme avisos operacionais da CP para eventuais condicionamentos na circulação ferroviária.',
    location: 'Linha do Norte / Espinho',
    sourceUrl: 'https://www.cp.pt/passageiros/pt/consultar-horarios/avisos'
  }
];

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function htmlToBlocks(html) {
  return html
    .replace(/<script[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<(\/p|\/li|\/h1|\/h2|\/h3|\/article|\/section|br\s*\/?)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length >= 30)
    .slice(0, 120);
}

function pickRelevantText(blocks, keywords, maxChars = 360) {
  if (!Array.isArray(blocks) || !blocks.length) return null;

  const lowerKeywords = keywords.map((key) => key.toLowerCase());
  const matches = blocks.filter((block) => lowerKeywords.some((key) => block.toLowerCase().includes(key)));
  const candidates = matches.length ? matches : blocks;

  let text = '';
  for (const line of candidates) {
    if ((text + ' ' + line).trim().length > maxChars) break;
    text = `${text} ${line}`.trim();
    if (text.length >= maxChars * 0.7) break;
  }

  return text || null;
}

function parseIpmaRelevantWarnings(raw) {
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

  const relevant = list
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
        text: `${text}${level ? ` (nível ${level})` : ''}`.slice(0, 380),
        dateTime: start && !Number.isNaN(Date.parse(start)) ? new Date(start).toISOString() : new Date().toISOString(),
        location: area || district || 'Espinho',
        sourceUrl: 'https://api.ipma.pt/open-data/forecast/warnings/warnings_www.json'
      };
    })
    .filter(Boolean)
    .slice(0, 3);

  return relevant;
}

function extractSnippetFromHtmlSource(source, html) {
  const blocks = htmlToBlocks(html);

  switch (source.id) {
    case 'municipio': {
      const text = pickRelevantText(blocks, ['espinho', 'município', 'câmara', 'edital', 'aviso']);
      return text
        ? {
            topic: 'Município de Espinho',
            text,
            location: 'Espinho',
            sourceUrl: source.url
          }
        : null;
    }
    case 'visit_espinho_events': {
      const text = pickRelevantText(blocks, ['evento', 'agenda', 'espinho', 'festival', 'concerto']);
      return text
        ? {
            topic: 'Eventos em Espinho',
            text,
            location: 'Espinho',
            sourceUrl: source.url
          }
        : null;
    }
    case 'cp_notices': {
      const text = pickRelevantText(blocks, ['linha', 'circulação', 'comboio', 'aviso', 'espinho']);
      return text
        ? {
            topic: 'Avisos CP',
            text,
            location: 'Linha do Norte / Espinho',
            sourceUrl: source.url
          }
        : null;
    }
    case 'ip_alerts': {
      const text = pickRelevantText(blocks, ['condicionamento', 'trânsito', 'obra', 'alerta', 'espinho', 'aveiro']);
      return text
        ? {
            topic: 'Infraestruturas e Mobilidade',
            text,
            location: 'Espinho / Aveiro',
            sourceUrl: source.url
          }
        : null;
    }
    case 'diario_aveiro_espinho': {
      const text = pickRelevantText(blocks, ['espinho', 'região', 'aveiro']);
      return text
        ? {
            topic: 'Notícias locais',
            text,
            location: 'Espinho',
            sourceUrl: source.url
          }
        : null;
    }
    default: {
      const text = stripHtml(html).slice(0, 320);
      return text
        ? {
            topic: source.title,
            text,
            location: 'Espinho',
            sourceUrl: source.url
          }
        : null;
    }
  }
}

async function fetchWithTimeout(url, timeoutMs = 12000) {
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
    const text = await response.text();
    return text;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function getSourceMeta(url) {
  return sourceCatalog.find((source) => source.url === url) ?? null;
}

function getPublisherByUrl(url) {
  return getSourceMeta(url)?.publisher ?? 'Fonte pública';
}

async function collectSnippets() {
  if (USE_MOCK_DATA) {
    return {
      snippets: mockSnippets,
      checkedSources: sourceCatalog.map((source) => source.url)
    };
  }

  const checkedSources = [];
  const snippets = [];

  for (const source of sourceCatalog) {
    checkedSources.push(source.url);
    const content = await fetchWithTimeout(source.url);
    if (!content) continue;

    if (source.id === 'ipma_warnings') {
      snippets.push(...parseIpmaRelevantWarnings(content));
      continue;
    }

    const snippet = extractSnippetFromHtmlSource(source, content);
    if (snippet?.text) snippets.push(snippet);
  }

  const deduped = [];
  const seen = new Set();
  for (const snippet of snippets) {
    const key = `${snippet.topic.toLowerCase()}|${snippet.text.toLowerCase().slice(0, 140)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(snippet);
  }

  return { snippets: deduped, checkedSources };
}

function buildFallbackUpdate({ snippets, checkedSources }) {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const updates = snippets.slice(0, 7).map((snippet) => ({
    topic: snippet.topic,
    text: snippet.text,
    dateTime: now.toISOString(),
    location: snippet.location,
    sources: [snippet.sourceUrl]
  }));

  const uniqueSourcesFromUpdates = Array.from(new Set(updates.flatMap((update) => update.sources)));
  const sourceUrls = uniqueSourcesFromUpdates.length ? uniqueSourcesFromUpdates : Array.from(new Set(checkedSources));

  const noSignificantUpdates = updates.length === 0;
  const facebookDraft = noSignificantUpdates
    ? 'Boa noite, comunidade de Espinho. Hoje não foram identificadas atualizações locais significativas nas fontes públicas verificadas. Há algum tema local que queiram que seja monitorizado amanhã?'
    : 'Boa noite, comunidade de Espinho! Segue um rascunho rápido com os principais pontos locais do dia, com fontes públicas para verificação. O que consideram mais relevante para acompanhar amanhã?';

  return {
    date,
    generatedAt: now.toISOString(),
    title: `Atualização diária de Espinho - ${date}`,
    facebookDraft,
    updates,
    sources: sourceUrls.map((url) => ({
      title: getSourceMeta(url)?.title ?? 'Fonte pública',
      url,
      publisher: getPublisherByUrl(url)
    })),
    checkedSources,
    noSignificantUpdates
  };
}

function normalizeAiOutput(data, checkedSources) {
  const fallback = buildFallbackUpdate({ snippets: [], checkedSources });
  if (!data || typeof data !== 'object') return fallback;

  const nowIso = new Date().toISOString();
  const date = typeof data.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.date) ? data.date : nowIso.slice(0, 10);

  const updates = Array.isArray(data.updates)
    ? data.updates
        .slice(0, 7)
        .map((update) => ({
          topic: String(update?.topic ?? '').slice(0, 120),
          text: String(update?.text ?? '').slice(0, 420),
          dateTime: String(update?.dateTime ?? nowIso),
          location: String(update?.location ?? 'Espinho').slice(0, 120),
          sources: Array.isArray(update?.sources) ? update.sources.map(String).filter((url) => /^https?:\/\//.test(url)).slice(0, 4) : []
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
        .filter((source) => /^https?:\/\//.test(source.url))
    : [];

  const normalized = {
    date,
    generatedAt: typeof data.generatedAt === 'string' ? data.generatedAt : nowIso,
    title: typeof data.title === 'string' ? data.title.slice(0, 200) : fallback.title,
    facebookDraft: typeof data.facebookDraft === 'string' ? data.facebookDraft.slice(0, 1200) : fallback.facebookDraft,
    updates,
    sources: allSources,
    checkedSources: Array.isArray(checkedSources) ? checkedSources : [],
    noSignificantUpdates: Boolean(data.noSignificantUpdates ?? updates.length === 0)
  };

  if (!normalized.updates.length && !normalized.noSignificantUpdates) {
    normalized.noSignificantUpdates = true;
  }

  if (!normalized.sources.length) {
    normalized.sources = fallback.sources;
  }

  if (!normalized.facebookDraft) {
    normalized.facebookDraft = fallback.facebookDraft;
  }

  return normalized;
}

async function generateWithOpenAI(input) {
  const prompt = `És um assistente editorial local para Espinho, Portugal.\n\nContexto e restrições:\n- Usar APENAS a informação fornecida em snippets de fontes públicas verificáveis.\n- Ignorar rumores, posts sem validação, spam promocional e notícias nacionais sem ligação clara a Espinho.\n- Deduplicar histórias repetidas.\n- Escrever em português (PT), tom adequado a grupo local de Facebook.\n- Texto conciso, com abertura amigável e pergunta final para engagement.\n- Citar links de fontes.\n- Evitar qualquer afirmação não suportada pelos snippets.\n\nIMPORTANTE DE CUSTO/PREVISIBILIDADE:\n- Priorizar uma saída curta e direta.\n- Se não houver dados relevantes, devolver updates=[] e noSignificantUpdates=true.\n\nResponder APENAS em JSON estrito com este schema:\n{\n  "date": "YYYY-MM-DD",\n  "generatedAt": "ISO_DATETIME",\n  "title": "string",\n  "facebookDraft": "string",\n  "updates": [\n    {\n      "topic": "string",\n      "text": "string",\n      "dateTime": "ISO_DATETIME",\n      "location": "string",\n      "sources": ["https://..."]\n    }\n  ],\n  "sources": [\n    {\n      "title": "string",\n      "url": "https://...",\n      "publisher": "string"\n    }\n  ],\n  "checkedSources": ["https://..."],\n  "noSignificantUpdates": true\n}\n\nInput JSON:\n${JSON.stringify(input)}`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
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

async function generateUpdate() {
  await mkdir(ARCHIVE_DIR, { recursive: true });

  const collected = await collectSnippets();
  const checkedSources = collected.checkedSources;

  let output;
  const llmEnabled = AI_PROVIDER === 'openai' && OPENAI_API_KEY;

  if (llmEnabled) {
    try {
      const aiOutput = await generateWithOpenAI({ snippets: collected.snippets, checkedSources });
      output = normalizeAiOutput(aiOutput, checkedSources);
    } catch {
      output = buildFallbackUpdate(collected);
    }
  } else {
    output = buildFallbackUpdate(collected);
  }

  assertValidUpdateSchema(output);

  const latestPath = path.join(DATA_DIR, 'latest.json');
  const archivePath = path.join(ARCHIVE_DIR, `${output.date}.json`);
  const archiveIndexPath = path.join(ARCHIVE_DIR, 'index.json');

  let archiveIndex = [];
  try {
    const existing = JSON.parse(await readFile(archiveIndexPath, 'utf-8'));
    if (Array.isArray(existing)) archiveIndex = existing;
  } catch {
    archiveIndex = [];
  }

  const nextIndex = Array.from(new Set([output.date, ...archiveIndex])).sort((a, b) => (a > b ? -1 : 1));

  await writeFile(latestPath, `${JSON.stringify(output, null, 2)}\n`, 'utf-8');
  await writeFile(archivePath, `${JSON.stringify(output, null, 2)}\n`, 'utf-8');
  await writeFile(archiveIndexPath, `${JSON.stringify(nextIndex, null, 2)}\n`, 'utf-8');

  return output;
}

generateUpdate()
  .then((output) => {
    process.stdout.write(`Generated update for ${output.date}\n`);
  })
  .catch((error) => {
    process.stderr.write(`Failed to generate update: ${error.message}\n`);
    process.exitCode = 1;
  });
