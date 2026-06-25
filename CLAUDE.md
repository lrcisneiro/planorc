# Planorc — Planejamento Orçamentário

Sistema de planejamento e controladoria orçamentária para grupos que operam sobre o ERP TOTVS. Permite estruturar relatórios gerenciais (DRE, Balanço), orçar por linha de relatório, importar o realizado do ERP (razão e balancete) e comparar Orçado × Realizado com dashboards, cubos e múltiplas visões.

> **Nota de manutenção (jun/2026):** este documento foi reescrito para refletir o schema e as telas **vivos** (linhagem v3). Versões anteriores descreviam um protótipo inicial (`plano_orcamentario` + `fat_lancamento` único) que já foi superado. Há ainda referências legadas a `fat_lancamento` no código em transição — ver seção "Legado em transição".

## Stack

- **Frontend**: React 19 + TypeScript + Vite, em `frontend/`. É onde está praticamente toda a lógica — os dados vão direto ao Supabase via SDK do cliente.
- **Backend**: FastAPI (Python), em `backend/` — incipiente, só `/health`. Raramente necessário.
- **Banco**: Supabase (PostgreSQL 15+) — credenciais em `frontend/.env` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`). Multi-tenant com Row Level Security por `tenant_id`.
- **UI**: Tailwind CSS v4 + objetos de estilo inline (`S`) misturados. Sem biblioteca de componentes; ícones via `lucide-react`.
- **Gráficos**: Recharts.
- **Roteamento**: React Router v7.
- **Agregação pesada**: feita no banco via funções RPC (`relatorio_orcado_agg`, `relatorio_realizado_agg`, `relatorio_saldo_agg` e variantes `_anual`), chamadas com `supabase.rpc(...)`.

> Existe uma pasta duplicada `frontend/frontend/` — artefato de criação errada, ignorar.
> **Fonte única de verdade:** trabalhar sempre nesta pasta (`Documents/planorc`). Um clone antigo em `Documents/Claude/Projects/planorc` foi aposentado em jun/2026.

## Rotas / páginas (App.tsx)

| rota | página | função |
|------|--------|--------|
| `/dashboards` | `DashboardsHubPage` | hub de dashboards |
| `/dashboards/anual` | `ComparativoAnualPage` | comparativo anual |
| `/dashboards/cagr` | `CagrPage` | CAGR |
| `/dashboards/executivo` | `ExecutivoPage` | visão executiva |
| `/dashboards/indicadores` | `IndicadoresPage` | indicadores |
| `/dashboard` | `DashboardPage` | dashboard principal |
| `/balanco` | `BalancoDashboardPage` | Balanço (lê `fat_saldo`) |
| `/relatorios` | `RelatorioPage` | lista de relatórios |
| `/relatorios/:id` | `RelatorioEditorPage` | editor de relatório (DRE Orçado × Realizado, fórmulas) |
| `/orcamento` | `OrcadoDadosPage` | dados de orçado |
| `/realizado` | `RealizadoDadosPage` | dados de realizado (importado do ERP) |
| `/saldos` | `SaldoDadosPage` | saldos/balancete |
| `/amarracao` | `AmarracaoPage` | amarração conta contábil → linha de relatório |
| `/cadastros` | `CadastrosPage` | cadastros |
| `/config` | `ConfiguracoesPage` | configurações |
| (login) | `LoginPage` | autenticação |

Páginas **não roteadas** (legado, manter cautela antes de reusar): `orcamento/OrcamentoPage.tsx`, `templates/TemplatePage.tsx`, `templates/TemplateEditorPage.tsx`, `lancamentos/LancamentosPage.tsx`, `dre/DrePage.tsx`.

## Modelo de dados (Supabase — linhagem v3)

Todas as tabelas têm `tenant_id` e RLS. Base SQL em `schema_v2.sql`; evoluções em `schema_v3_*.sql` (migrations numeradas até a 043+). Não há um `schema_atual.sql` consolidado nesta pasta — o estado vivo é a soma das migrations.

### Organização / dimensões fixas
- **`empresa`** — **agrupador / visão**, não é o CNPJ. Ex.: "Unidade Rio Preto". Usada para separar resultados por unidade de negócio.
- **`filial`** — o **CNPJ real do ERP TOTVS** (`empresa_id` FK → empresa). É o grão verdadeiro do dado. Várias filiais (CNPJs distintos) podem apontar para a mesma `empresa` (ex.: filiais `2107` e `2005` → "Rio Preto"). No TOTVS a filial é dimensão obrigatória.
- **`centro_custo`** — hierárquico (`pai_id`).

> **Atenção ao grão (filial × empresa):** como toda filial pertence a uma empresa, `empresa_id` é derivável de `filial_id`. Hoje `filial_id` é **nullable** nas tabelas de fato (relaxado na migration `v2_003` para permitir lançamento consolidado), com uniques usando `NULLS NOT DISTINCT` ou sentinela `COALESCE`. Riscos conhecidos: dupla contagem por mistura de grão (linha consolidada com `filial=NULL` convivendo com linhas por filial) e ausência de FK composta `(empresa_id, filial_id)`. Decisão pendente: tornar `filial_id NOT NULL` (ao menos no realizado, que sempre vem do ERP com filial) e tratar consolidação por view/soma. Ver memória do projeto.

### Plano de contas (multi-ERP)
- **`plano_contas`** — plano de contas por ERP (resolve colisão de códigos entre ERPs). `empresa` aponta para um plano.
- **`conta_contabil`** — conta do razão (`plano_id`). Origem do realizado.
- **`conta_orcamentaria`** — (renomeada de `linha_orcamentaria`) plano de contas orçamentário.

### Estrutura de relatório (o "coração" — DRE/Balanço gerencial)
- **`categoria_relatorio`** — agrupa relatórios.
- **`relatorio`** — um relatório gerencial (uma DRE, um Balanço…). `categoria_id`.
- **`relatorio_linha`** — linhas hierárquicas do relatório (`relatorio_id`, `pai_id`, `ordem`, `nivel`). `tipo_linha ∈ ANALITICA | FORMULA | INDICADOR`; `expressao` guarda a fórmula (ex.: `=[P00001]*[P00002]`, `=ANTERIOR()`); `natureza ∈ RECEITA | DESPESA | NEUTRO`. **Substituiu** o antigo par `template`/`linha_template`.
- **`conta_linha`** — **amarração**: mapeia `conta_id` (conta contábil) → `linha_id` (linha de relatório). É o que resolve o realizado do ERP para as linhas da DRE (tela `/amarracao`).

### Orçamentação por formulário (drivers)
- **`formulario`**, **`formulario_linha`** (hierárquico, com `expressao`/`natureza`), **`formulario_valor`** — captura orçado por direcionadores (ex.: quantidade × preço × índice, fórmulas tipo `=ANTERIOR()*1,05`). Linhas de formulário podem alimentar `fat_orcado` (ver `origem_formulario_linha_id`).

### Tabelas de fato
- **`fat_orcado`** — orçado por `versao_id` × `linha_id` (relatorio_linha) × `empresa_id` × `filial_id` × `cc_id` × `ano`/`mes`. Tem `valor` **ou** `expressao` (célula calculada). `dims jsonb` para dimensões opcionais do tenant (funcionário, verba, projeto…). `origem ∈ MANUAL | FORMULARIO`. Unique por `(versao, linha, empresa, COALESCE(filial), COALESCE(cc), ano, mes, dims::text)`.
- **`fat_realizado`** — razão do ERP (fluxo/movimentação, com sinal). `conta_id`, `linha_id` (nullable — resolvida via `conta_linha` na consulta), `empresa_id`, `filial_id`, `cc_id`, `ano`/`mes`, `valor`, `dims`. `origem ∈ ERP | MANUAL | IMPORT`. Importado em lotes (`lote`/`sublote`).
- **`fat_saldo`** — balancete mensal do ERP (saldo final/estoque por conta/empresa/**filial**/ano/mês). O **Balanço** lê isto direto; a **DRE** usa `fat_realizado` (fluxo).

### Versões, dimensões, BI e operação
- **`versao_orcamento`** — versões/cenários de orçamento (ex.: `BASELINE_2026`).
- **`view_config`** — configuração de visão por relatório/formulário.
- **`dimensao`** / **`dimensao_valor`** + `dims jsonb` nos fatos — cubo de dimensões configuráveis.
- **`lote_contabil`** / **`lote_ignorado`** — controle de cargas do realizado (importação por lote, exclusão/ignorar lotes).
- **`dashboard_card`** — cards configuráveis dos dashboards.
- **snapshots** (`relatorio_snapshot`, RPCs `criar_snapshot`/`restaurar_snapshot`) — congelar estados.
- **`indice_economico`** / **`indice_valor`** — índices de correção.
- **Acesso**: `tenant`, `user_tenant`, `user_acesso_regra`, `grupo_empresarial`.

### Agregação (RPC, no banco)
`relatorio_orcado_agg`, `relatorio_realizado_agg`, `relatorio_saldo_agg` e variantes `_anual`/`_empresa` consolidam os fatos por linha/empresa/período para alimentar relatórios e dashboards. `refresh_realizado_mensal` materializa o realizado.

## Legado em transição

O frontend ainda referencia `fat_lancamento` (~10 pontos) — tabela fato única do modelo antigo (`tipo_lancamento ORCADO|REALIZADO`, ligada a `plano_orcamentario`). A linhagem v3 migrou para `fat_orcado` + `fat_realizado` + `fat_saldo`. Ao mexer em fluxo de dados, preferir as tabelas v3 e tratar referências a `fat_lancamento`/`plano_orcamentario` como legado a ser migrado, não como padrão.

## Redesign de UX em andamento (v2 — proposta)

Há uma proposta de repaginação (tema dark moderno) e reorganização da navegação **por modo de interação**, em protótipos HTML standalone na raiz da pasta (`planorc-v2-*.html`): Dashboard, Orçamento, DRE e um Mapa de Navegação. Princípio: separar **escrita** (orçar — editor, importação de planilha, formulário de drivers, posto de trabalho/folha) de **leitura** (acompanhar — dashboards, DRE, análises), sendo o **realizado sempre vindo do ERP** (nunca digitado). É só proposta visual; não altera o código atual.

## Convenções de código

- Estilos: mistura de objetos `S` inline e classes Tailwind. Seguir o padrão já presente em cada arquivo.
- Sem biblioteca de componentes — tudo à mão.
- Tipos TypeScript locais por arquivo (não há pasta `types/`).
- Sem testes automatizados.
- Dados: `supabase.from(...)` / `supabase.rpc(...)` direto nos componentes (sem React Query).

## Como rodar

```bash
# Frontend
cd frontend
npm install
npm run dev   # http://localhost:5173

# Backend (raramente necessário)
cd backend
source .venv/bin/activate
uvicorn main:app --reload
```
