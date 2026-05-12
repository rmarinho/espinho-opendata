# Espinho Updates

Site estático para gerar e publicar um rascunho diário local de Espinho (PT) com base em fontes públicas verificáveis.

## Estrutura

- `public/index.html`: página principal.
- `public/data/latest.json`: atualização mais recente.
- `public/data/archive/YYYY-MM-DD.json`: arquivo diário.
- `scripts/source-catalog.mjs`: catálogo de fontes públicas priorizadas.
- `scripts/generate-update.mjs`: recolha de fontes + resumo em JSON (LLM opcional).
- `scripts/validate-generated-json.mjs`: validação simples do schema obrigatório.
- `.github/workflows/update-site.yml`: testes + geração agendada + deploy para GitHub Pages.

## Execução local

```bash
npm test
npm run generate:update
npm run validate:update
```

## Variáveis de configuração

| Variável | Tipo | Valor recomendado | Efeito |
|---|---|---|---|
| `USE_MOCK_DATA` | env/repo variable | `false` em produção | `true` usa snippets mock; `false` faz recolha real de fontes públicas |
| `AI_PROVIDER` | env/repo variable | `github-models` | fornecedor LLM (`github-models` por defeito, `openai` como alternativa) |
| `GITHUB_MODELS_MODEL` | env/repo variable | `openai/gpt-4.1-mini` | modelo para GitHub Models |
| `OPENAI_MODEL` | env/repo variable | `gpt-4.1-mini` | modelo alternativo (só se `AI_PROVIDER=openai`) |
| `OPENAI_API_KEY` | secret | — | chave da API OpenAI (só se `AI_PROVIDER=openai`) |

## Configuração exata do repositório (após merge)

1. **Settings → Pages**
   - Source: **GitHub Actions**
2. **Settings → Actions → General**
   - Workflow permissions: **Read and write permissions**
   - O workflow inclui `models: read` para acesso ao GitHub Models.
3. **Settings → Secrets and variables → Actions**
   - Variables:
     - `USE_MOCK_DATA=false`
     - `AI_PROVIDER=github-models`
     - `GITHUB_MODELS_MODEL=openai/gpt-4.1-mini` (ou modelo escolhido)
   - *(Opcional, apenas se usar `AI_PROVIDER=openai`):*
     - Secret: `OPENAI_API_KEY`
     - Variable: `OPENAI_MODEL=gpt-4.1-mini`

> Nota: A disponibilidade e limites do GitHub Models dependem do plano da conta/organização e do acesso ao GitHub Models.

> Nota: o workflow "Update Espinho Updates Site" aparece normalmente após o ficheiro de workflow existir no **default branch**.

### Execução manual do workflow

1. Abrir **Actions** no GitHub.
2. Selecionar **Update Espinho Updates Site**.
3. Clicar em **Run workflow**.
4. Escolher o branch pretendido e confirmar.

## Fontes públicas priorizadas

- Município de Espinho
- Visit Espinho (eventos)
- IPMA (avisos, filtrados para relevância Aveiro/Espinho)
- CP / Infraestruturas de Portugal (avisos locais relevantes)
- Diário de Aveiro (secção Espinho)

## Comportamento sem atualizações significativas

Com `USE_MOCK_DATA=false`, se a recolha real não encontrar conteúdo local significativo, o JSON é gerado com:

- `updates: []`
- `noSignificantUpdates: true`

Sem fallback para snippets mock nesse caminho.

## Segurança e transparência

- Só utiliza fontes públicas configuradas.
- Prompt exige JSON estrito, sem alegações não suportadas.
- Chaves ficam apenas em GitHub Secrets.
- Links externos na UI usam `rel="noopener noreferrer"`.
- O texto gerado termina com nota explícita de rascunho gerado por IA e referências de fontes públicas usadas.
