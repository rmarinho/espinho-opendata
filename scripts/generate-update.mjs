import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(PUBLIC_DIR, 'data');
const ARCHIVE_DIR = path.join(DATA_DIR, 'archive');

const USE_MOCK_DATA = (process.env.USE_MOCK_DATA ?? 'true').toLowerCase() !== 'false';
const AI_PROVIDER = (process.env.AI_PROVIDER ?? 'openai').toLowerCase();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? 'gpt-4.1-mini';

const sourceCatalog = [
  { title: 'Município de Espinho', url: 'https://www.cm-espinho.pt/', publisher: 'Município de Espinho' },
  { title: 'Turismo de Espinho', url: 'https://www.visitespinho.pt/', publisher: 'Turismo de Espinho' },
  { title: 'IPMA Avisos Meteorológicos', url: 'https://api.ipma.pt/open-data/forecast/warnings/warnings_www.json', publisher: 'IPMA' },
  { title: 'CP - Comboios de Portugal', url: 'https://www.cp.pt/passageiros/pt/consultar-horarios/avisos', publisher: 'CP' },
  { title: 'Infraestruturas de Portugal', url: 'https://www.infraestruturasdeportugal.pt/pt-pt/alertas', publisher: 'Infraestruturas de Portugal' },
  { title: 'Diário de Aveiro', url: 'https://www.diariodeaveiro.pt/', publisher: 'Diário de Aveiro' },
  { title: 'Agenda de Espinho', url: 'https://www.cm-espinho.pt/pt/eventos/', publisher: 'Município de Espinho' }
];

const mockSnippets = [
  {
    topic: 'Eventos Locais',
    text: 'A agenda municipal destaca atividades culturais e familiares para os próximos dias em Espinho.',
    location: 'Espinho',
    sourceUrl: 'https://www.cm-espinho.pt/pt/eventos/'
  },
  {
    topic: 'Condições Meteorológicas',
    text: 'Os avisos públicos do IPMA devem ser consultados para acompanhar alterações no estado do tempo no litoral.',
    location: 'Espinho',
    sourceUrl: 'https://api.ipma.pt/open-data/forecast/warnings/warnings_www.json'
  },
  {
    topic: 'Transportes',
    text: 'Antes de viajar, confirme avisos operacionais da CP e da Infraestruturas de Portugal para eventuais condicionamentos.',
    location: 'Linha do Norte / Espinho',
    sourceUrl: 'https://www.cp.pt/passageiros/pt/consultar-horarios/avisos'
  }
];

function stripHtml(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
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

function getPublisherByUrl(url) {
  const found = sourceCatalog.find((s) => s.url === url);
  return found?.publisher ?? 'Fonte pública';
}

async function collectSnippets() {
  if (USE_MOCK_DATA) {
    return {
      snippets: mockSnippets,
      checkedSources: sourceCatalog.map((s) => s.url)
    };
  }

  const checkedSources = [];
  const snippets = [];

  for (const source of sourceCatalog) {
    checkedSources.push(source.url);
    const content = await fetchWithTimeout(source.url);
    if (!content) continue;

    const text = stripHtml(content).slice(0, 600);
    if (!text) continue;

    snippets.push({
      topic: source.title,
      text,
      location: 'Espinho',
      sourceUrl: source.url
    });
  }

  const deduped = [];
  const seen = new Set();
  for (const snippet of snippets) {
    const key = `${snippet.topic.toLowerCase()}|${snippet.sourceUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(snippet);
  }

  if (deduped.length === 0) {
    return {
      snippets: mockSnippets,
      checkedSources
    };
  }

  return { snippets: deduped, checkedSources };
}

function buildFallbackUpdate({ snippets, checkedSources }) {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const updates = snippets.slice(0, 5).map((snippet) => ({
    topic: snippet.topic,
    text: snippet.text,
    dateTime: now.toISOString(),
    location: snippet.location,
    sources: [snippet.sourceUrl]
  }));

  const uniqueSources = Array.from(new Set(updates.flatMap((u) => u.sources)));

  return {
    date,
    generatedAt: now.toISOString(),
    title: `Atualização diária de Espinho - ${date}`,
    facebookDraft: `Bom dia, comunidade de Espinho! Segue um rascunho rápido com os principais pontos do dia (fontes públicas no final). O que acham mais relevante hoje para a cidade?`,
    updates,
    sources: uniqueSources.map((url) => ({
      title: sourceCatalog.find((s) => s.url === url)?.title ?? 'Fonte pública',
      url,
      publisher: getPublisherByUrl(url)
    })),
    checkedSources,
    noSignificantUpdates: updates.length === 0
  };
}

function normalizeAiOutput(data, checkedSources) {
  const fallback = buildFallbackUpdate({ snippets: mockSnippets, checkedSources });
  if (!data || typeof data !== 'object') return fallback;

  const nowIso = new Date().toISOString();
  const date = typeof data.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.date) ? data.date : nowIso.slice(0, 10);
  const updates = Array.isArray(data.updates)
    ? data.updates
        .slice(0, 7)
        .map((u) => ({
          topic: String(u?.topic ?? '').slice(0, 120),
          text: String(u?.text ?? '').slice(0, 420),
          dateTime: String(u?.dateTime ?? nowIso),
          location: String(u?.location ?? 'Espinho').slice(0, 120),
          sources: Array.isArray(u?.sources) ? u.sources.map(String).slice(0, 4) : []
        }))
        .filter((u) => u.topic && u.text)
    : fallback.updates;

  const allSources = Array.isArray(data.sources)
    ? data.sources
        .map((s) => ({
          title: String(s?.title ?? '').slice(0, 120),
          url: String(s?.url ?? ''),
          publisher: String(s?.publisher ?? '').slice(0, 120)
        }))
        .filter((s) => s.url.startsWith('http'))
    : fallback.sources;

  return {
    date,
    generatedAt: typeof data.generatedAt === 'string' ? data.generatedAt : nowIso,
    title: typeof data.title === 'string' ? data.title.slice(0, 200) : fallback.title,
    facebookDraft: typeof data.facebookDraft === 'string' ? data.facebookDraft.slice(0, 1200) : fallback.facebookDraft,
    updates: updates.length ? updates : fallback.updates,
    sources: allSources.length ? allSources : fallback.sources,
    checkedSources: Array.isArray(checkedSources) ? checkedSources : [],
    noSignificantUpdates: Boolean(data.noSignificantUpdates ?? updates.length === 0)
  };
}

async function generateWithOpenAI(input) {
  const prompt = `És um assistente editorial local para Espinho, Portugal.\n\nContexto e restrições:\n- Usar APENAS a informação fornecida em snippets de fontes públicas verificáveis.\n- Ignorar rumores, posts sem validação, spam promocional e notícias nacionais sem ligação clara a Espinho.\n- Deduplicar histórias repetidas.\n- Escrever em português (PT), tom adequado a grupo local de Facebook.\n- Texto conciso, com abertura amigável e pergunta final para engagement.\n- Citar links de fontes.\n- Evitar qualquer afirmação não suportada pelos snippets.\n\nIMPORTANTE DE CUSTO/PREVISIBILIDADE:\n- Priorizar uma saída curta e direta.\n- Se houver poucos dados relevantes, marcar noSignificantUpdates=true e explicar de forma responsável.\n\nResponder APENAS em JSON estrito com este schema:\n{\n  "date": "YYYY-MM-DD",\n  "generatedAt": "ISO_DATETIME",\n  "title": "string",\n  "facebookDraft": "string",\n  "updates": [\n    {\n      "topic": "string",\n      "text": "string",\n      "dateTime": "ISO_DATETIME",\n      "location": "string",\n      "sources": ["https://..."]\n    }\n  ],\n  "sources": [\n    {\n      "title": "string",\n      "url": "https://...",\n      "publisher": "string"\n    }\n  ],\n  "checkedSources": ["https://..."],\n  "noSignificantUpdates": true\n}\n\nInput JSON:\n${JSON.stringify(input)}`;

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: prompt,
      max_output_tokens: 1200
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed with ${response.status}`);
  }

  const payload = await response.json();
  const text = payload?.output_text;
  if (!text) throw new Error('Missing output_text from OpenAI response');
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
