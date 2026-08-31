# DESIGN — Indicadores Operacionais na Visão Executiva

**Status: proposta aprovar → implementar | ago/2026 | Mockup visual: `planorc-v2-indicadores-mockup.html` (raiz)**

Evolução da **Visão Executiva** (`/dashboards/executivo`) para absorver os indicadores operacionais TOESTE (LER, % recorrência, matriz de receita, margens) usando o que o PLANORC já tem: o relatório DRE com linhas calculadas pelo engine. **Princípio: indicador é linha de relatório, não código hardcoded.**

Referências de conteúdo (pasta do projeto "Indicadores Operacionais TOESTE"): `TOESTE_Indicadores_Operacionais.md` (dicionário/fórmulas/metas) e `TOESTE_Benchmark_Indicadores_Mercado.md` (benchmarks e novos indicadores).

---

## 1. A conexão — por que quase tudo já existe

O `engine.ts` calcula linhas `FORMULA`/`INDICADOR` com `expressao` referenciando outras linhas por código (`=[C00001]/[C00002]`), suporta `ANTERIOR([cod], n)`, `nao_soma` (linha de apoio referenciável fora da soma do pai) e natureza `NEUTRO`. A `IndicadoresPage` **já transforma linhas INDICADOR em cards** (realizado × orçado × ano anterior) e a `ExecutivoPage` já localiza linhas por descrição (EBITDA, Resultado).

Logo, o caminho não é criar um motor novo — é **criar linhas no relatório DRE** e evoluir a camada visual:

```
DRE (relatorio_linha)                          Visão Executiva
├─ [REC] Receita Total (SOMAR_FILHOS)          ┌────────────────────────┐
│   ├─ [R1] Repasse recorrente                 │ cards KPI (já existe)  │
│   ├─ [R2] Repasse pontual                    │ + faixas de status     │
│   ├─ [S1] Serviço recorrente                 │ + 12m móveis           │
│   └─ [S2] Projetos                           │ + gráficos (nivo)      │
├─ [CP] Custo Pessoas Full (apoio, nao_soma)   └────────────────────────┘
├─ [FTE] Headcount FTE (apoio, NEUTRO)                  ▲
├─ [LER] INDICADOR  =[REC]/[CP]                         │ engine.ts
├─ [LERM] INDICADOR =[MB]/[CP]                          │ (já calcula)
├─ [RFTE] INDICADOR =[REC]/[FTE]                        │
└─ [PREC] INDICADOR =([R1]+[S1])/[REC]*100  ────────────┘
```

## 2. Estrutura de linhas a criar no DRE (P1 — sem código, só cadastro)

| Código sug. | Linha | Tipo | Observação |
|---|---|---|---|
| R1/R2/S1/S2 | Matriz de receita 2×2 | ANALITICA sob Receita | Reamarrar contas (`conta_linha`); hoje o plano separa rec×não-rec mas não repasse×serviço — criar as contas orçamentárias que faltam |
| CP | Custo Pessoas — fully loaded | FORMULA ou SOMAR_FILHOS, `nao_soma` | Folha + encargos + benefícios + PJ + treinamentos (regra na seção 3 do estudo-base). Se as contas já estão na DRE como despesa, usar FORMULA somando os códigos existentes para não duplicar amarração |
| FTE | Headcount médio (FTE) | ANALITICA de apoio, `nao_soma`, natureza NEUTRO | Ver decisão D1 |
| LER | LER Bruto | INDICADOR `=[REC]/[CP]` | formato NUMERO, 2 casas |
| LERM | LER de Margem | INDICADOR `=[MB]/[CP]` | idem |
| RFTE | Receita por FTE | INDICADOR `=[REC]/[FTE]` | MOEDA |
| CMP | Custo médio por pessoa | INDICADOR `=[CP]/[FTE]` | MOEDA |
| PREC | % Recorrência total | INDICADOR `=([R1]+[S1])/[REC]*100` | PERCENTUAL |
| MBP | Margem Bruta % | INDICADOR `=[MB]/[REC]*100` | se já não existir |

Com isso, LER e % recorrência **aparecem sozinhos** como cards na página Indicadores, com real × orçado × ano anterior — antes de qualquer linha de código.

## 3. Decisões de conceito (fechar antes de codar)

**D1 — De onde vem o FTE (medida não financeira).** Opções:
- (a) **Curto prazo**: linha ANALITICA de apoio preenchida como orçado (grade Orçar) e realizado lançado manual/importado (`fat_realizado.origem = MANUAL|IMPORT` já existe). Simples, destrava Receita por FTE já.
- (b) **Médio prazo**: o motor de postos (F5.2) passa a publicar headcount/FTE mensal por empresa — o grão funcionário já está no design aprovado. A linha FTE passa a ser alimentada pelo motor.
- **Recomendação: (a) agora, migrando para (b) quando P1 dos postos entrar.**

**D2 — Metas e faixas de status por indicador → CRUD `indicador_meta` (decidido em ago/2026).** Os cards hoje colorem por real×orçado; indicadores como o LER precisam de faixas absolutas (≥2,5x excelente / ≥2,0x saudável / ≥1,5x atenção) — e meta é dado vivo: evolui por ano (meta progressiva: 2026 1,9x → 2027 2,1x → 2028 2,5x), pode variar por empresa e carrega a referência de benchmark que a justifica. É o equivalente PLANORC da aba "Parâmetros" da planilha. Estrutura:

```sql
-- migration schema_v3_0XX_indicador_meta.sql
create table indicador_meta (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  linha_id    uuid not null references relatorio_linha(id) on delete cascade,
  ano         int  null,      -- NULL = vale para todos os anos (default)
  empresa_id  uuid null references empresa(id),  -- NULL = todas (premissa global, padrão v3_050)
  maior_melhor boolean not null default true,    -- false p/ churn, DSO, turnover…
  excelente   numeric null,   -- ≥ → Excelente (ou ≤, se maior_melhor=false)
  saudavel    numeric null,   -- ≥ → Saudável
  atencao     numeric null,   -- ≥ → Atenção; fora → Crítico
  benchmark_ref text null,    -- ex.: 'Crabtree ≥2,0x' · 'SPI 2025: HPO 75%' · 'TOTVS: +13% ARR a.a.'
  comentario  text null,
  unique nulls not distinct (tenant_id, linha_id, ano, empresa_id)
);
-- RLS por tenant_id, igual às demais
```

Resolução por precedência (mesmo padrão de herança das premissas globais da F5): `(linha, ano, empresa)` → `(linha, ano, NULL)` → `(linha, NULL, NULL)`. UI: seção **"Metas de indicadores"** em Cadastros (CRUD: linha/relatório, vigência, faixas, benchmark, comentário) + atalho de edição no modo Estrutura sobre linhas INDICADOR; capacidade nova em `lib/capacidades.ts` (convenção CLAUDE.md). Consumo: `IndicadoresPage`/`ExecutivoPage` carregam as metas das linhas exibidas, resolvem a precedência e renderizam o chip de status + linhas de referência nos gráficos. O campo `benchmark_ref` aparece como tooltip/legenda do card — o número de mercado sempre visível ao lado da meta interna.

**D3 — 12 meses móveis.** Sem mudança no engine: a página carrega 24 meses (`ExecutivoPage` já busca ano−1) e calcula o móvel no front somando as séries `computed` de [REC] e [CP]. Regra: móvel de razão = razão das somas (Σreceita ÷ Σcusto), nunca média das razões.

**D4 — Matriz 2×2 no plano de contas.** Separar "serviços recorrentes" de "projetos" exige contas/classificação novas (S1×S2) e reamarração. Trabalho de cadastro + eventual ajuste na importação do realizado. Sem isso, PREC sai só com R1 (subestimado) — aceitável como primeira versão, sinalizando no card.

**D5 — Indicadores que NÃO viram linha de DRE** (dados fora do razão): GRR/NRR/churn (motor de repasses — Fase 2), utilização/horas (Fase 3), book-to-bill (Fase 4). No painel, aparecem como cards "apagados" com chip da fase (padrão do mockup) até a fonte existir.

## 4. Evolução visual da Visão Executiva (P2 — código)

- **Cards com faixa de status** (D2): chip Excelente/Saudável/Atenção/Crítico + linha de meta, mantendo a anatomia atual do `Kpi` (lbl/val/ksub).
- **Seção "Eficiência"**: gráfico LER mensal + 12m móveis com bandas de faixa (nivo line + camadas de área; cores via `nivoTheme()`), Receita × Custo Pessoas, LER trimestral.
- **Seção "Receita"**: barras empilhadas R1/S1/R2/S2 + linha % recorrência (nivo bar + line).
- Config de quais cards aparecem: reaproveitar o padrão da `IndicadoresPage` (Checklist de linhas + preset `dashboard_card`).
- Capacidades: gatear seções novas com `can(...)` (`lib/capacidades.ts`), convenção do CLAUDE.md.

## 5. Fases de implementação

- **P0 (sem código)** — criar linhas/contas da seção 2 no DRE via modo Estrutura + amarração; validar LER calculado contra a planilha (gabarito: estudo-base seção 7, abr/24–abr/26). ✅ critério: card LER na página Indicadores batendo com a planilha.
- **P1** — migration `indicador_meta` + CRUD em Cadastros + chips de status nos cards (D2); linha FTE com entrada manual (D1a). Carga inicial das metas: seção 5 do estudo-base (Parâmetros) + `benchmark_ref` da pesquisa de mercado.
- **P2** — seções Eficiência e Receita na Visão Executiva (gráficos nivo do mockup); 12m móveis (D3).
- **P3** — separação S1×S2 no plano de contas + reamarração (D4); PREC completo.

## 6. Onde trabalhar o quê

- **Cowork (aqui)**: conceito, este design, mockup, validação de números, motor de repasses da Fase 2 (template externo).
- **VS Code + Claude Code (repo)**: P1–P3. Apontar o Claude Code para este arquivo + o mockup; arquivos-alvo: `pages/dashboard/ExecutivoPage.tsx`, `IndicadoresPage.tsx`, `pages/cadastros/CadastrosPage.tsx` (CRUD de metas), `lib/relatorioTotais.ts` (se precisar expor séries mensais), `lib/capacidades.ts`, migration `schema_v3_0XX_indicador_meta.sql`.
