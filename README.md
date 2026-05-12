# Espinho Updates

Site estático para gerar e publicar um rascunho diário local de Espinho (PT) com base em fontes públicas.

## Estrutura

- `public/index.html`: página principal.
- `public/data/latest.json`: atualização mais recente.
- `public/data/archive/YYYY-MM-DD.json`: arquivo diário.
- `scripts/generate-update.mjs`: recolha de fontes + resumo em JSON (LLM opcional).
- `.github/workflows/update-site.yml`: geração agendada + deploy para GitHub Pages.

## Execução local

```bash
npm run generate:update
```

Por omissão, usa mock data para custos previsíveis (`USE_MOCK_DATA=true`).

## LLM opcional (OpenAI)

Defina variáveis de ambiente/segredos no GitHub:

- `OPENAI_API_KEY` (secret)
- `OPENAI_MODEL` (variable, opcional)
- `AI_PROVIDER=openai` (variable, opcional)
- `USE_MOCK_DATA=false` (variable, para recolha real)

Se a integração LLM falhar, o script usa fallback seguro sem bloquear a publicação.

## Segurança

- Só utiliza fontes públicas configuradas.
- Prompt exige JSON estrito, sem alegações não suportadas.
- Chaves ficam apenas em GitHub Secrets.
- Links externos na UI usam `rel="noopener noreferrer"`.
