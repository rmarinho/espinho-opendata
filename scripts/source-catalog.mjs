export const sourceCatalog = [
  { id: 'municipio', title: 'Município de Espinho', url: 'https://www.cm-espinho.pt/', publisher: 'Município de Espinho' },
  { id: 'visit_espinho_events', title: 'Visit Espinho - Eventos', url: 'https://www.visit.espinho.pt/pt/eventos/', publisher: 'Turismo de Espinho' },
  { id: 'ipma_warnings', title: 'IPMA Avisos Meteorológicos', url: 'https://api.ipma.pt/open-data/forecast/warnings/warnings_www.json', publisher: 'IPMA' },
  { id: 'cp_notices', title: 'CP - Comboios de Portugal', url: 'https://www.cp.pt/passageiros/pt/consultar-horarios/avisos', publisher: 'CP' },
  { id: 'ip_alerts', title: 'Infraestruturas de Portugal', url: 'https://www.infraestruturasdeportugal.pt/pt-pt/alertas', publisher: 'Infraestruturas de Portugal' },
  { id: 'diario_aveiro_espinho', title: 'Diário de Aveiro - Espinho', url: 'https://www.diarioaveiro.pt/regiao/espinho/', publisher: 'Diário de Aveiro' }
];

export const mockSnippets = [
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
