async function safeFetchJson(path) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Falha ao obter ${path}`);
  return response.json();
}

function dateToPt(value) {
  try {
    return new Date(value).toLocaleString('pt-PT', { timeZone: 'Europe/Lisbon' });
  } catch {
    return value;
  }
}

function renderLatest(data) {
  document.getElementById('latest-meta').textContent = `Data: ${data.date} · Gerado em: ${dateToPt(data.generatedAt)}`;
  document.getElementById('latest-title').textContent = data.title;
  document.getElementById('facebook-draft').textContent = data.facebookDraft;

  const updatesList = document.getElementById('updates-list');
  updatesList.innerHTML = '';
  for (const update of data.updates) {
    const li = document.createElement('li');
    const strong = document.createElement('strong');
    strong.textContent = update.topic;
    const summary = document.createTextNode(`: ${update.text}`);
    const br = document.createElement('br');
    const small = document.createElement('small');
    small.textContent = `${update.location} · ${dateToPt(update.dateTime)}`;
    li.append(strong, summary, br, small);
    updatesList.appendChild(li);
  }
  if (!data.updates.length) {
    const li = document.createElement('li');
    li.textContent = 'Sem atualizações locais significativas nas fontes verificadas.';
    updatesList.appendChild(li);
  }

  const sourcesList = document.getElementById('sources-list');
  sourcesList.innerHTML = '';
  for (const source of data.sources) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = source.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = `${source.title} (${source.publisher})`;
    li.appendChild(a);
    sourcesList.appendChild(li);
  }
}

async function renderArchive() {
  const archiveList = document.getElementById('archive-list');
  archiveList.innerHTML = '';

  try {
    const dates = await safeFetchJson('./data/archive/index.json');
    for (const date of dates) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = `./data/archive/${date}.json`;
      a.textContent = date;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      li.appendChild(a);
      archiveList.appendChild(li);
    }
    if (dates.length === 0) {
      archiveList.textContent = 'Sem entradas de arquivo ainda.';
    }
  } catch {
    archiveList.textContent = 'Arquivo indisponível neste momento.';
  }
}

(async function init() {
  try {
    const latest = await safeFetchJson('./data/latest.json');
    renderLatest(latest);
  } catch (error) {
    document.getElementById('latest-meta').textContent = 'Não foi possível carregar a atualização diária.';
  }

  await renderArchive();
})();
