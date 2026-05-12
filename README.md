# Espinho Updates

Site estático para gerar e publicar um rascunho diário local de Espinho (PT) com base em fontes públicas verificáveis.

## Estrutura

- `public/index.html`: página principal.
- `public/data/latest.json`: atualização mais recente.
- `public/data/archive/YYYY-MM-DD.json`: arquivo diário.
- `scripts/generate-update.mjs`: recolha de fontes + resumo em JSON (LLM opcional).
- `scripts/validate-generated-json.mjs`: validação simples do schema obrigatório.
- `.github/workflows/update-site.yml`: geração agendada + deploy para GitHub Pages.

## Execução local

```bash
npm run generate:update
npm run validate:update
```

## Variáveis de configuração

| Variável | Tipo | Valor recomendado | Efeito |
|---|---|---|---|
| `USE_MOCK_DATA` | env/repo variable | `false` em produção | `true` usa snippets mock; `false` faz recolha real de fontes públicas |
| `AI_PROVIDER` | env/repo variable | `openai` | ativa fornecedor LLM suportado |
| `OPENAI_MODEL` | env/repo variable | `gpt-4.1-mini` (ou outro) | modelo para sumarização opcional |
| `OPENAI_API_KEY` | secret | definido | chave da API OpenAI |

### Recomendação para GitHub Actions (produção)

Defina **Repository Variable** `USE_MOCK_DATA=false` para que a execução agendada use recolha real de fontes públicas.

## Fontes públicas priorizadas

- Município de Espinho
- Visit Espinho (eventos)
- IPMA (avisos, filtrados para relevância Aveiro/Espinho)
- CP / Infraestruturas de Portugal (avisos de transportes)
- Diário de Aveiro (secção Espinho)

## Comportamento sem atualizações significativas

Com `USE_MOCK_DATA=false`, se a recolha real não encontrar conteúdo local significativo, o JSON é gerado com:

- `updates: []`
- `noSignificantUpdates: true`

Sem fallback para snippets mock nesse caminho.

## Segurança

- Só utiliza fontes públicas configuradas.
- Prompt exige JSON estrito, sem alegações não suportadas.
- Chaves ficam apenas em GitHub Secrets.
- Links externos na UI usam `rel="noopener noreferrer"`.
