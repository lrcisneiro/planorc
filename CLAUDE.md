# Planorc — Planejamento Orçamentário

Sistema de planejamento orçamentário para uma distribuidora TOTVS. Permite lançar orçamento mensal por item do plano orçamentário, comparar com realizado e gerar DRE gerencial.

## Stack

- **Frontend**: React 19 + TypeScript + Vite, em `frontend/`
- **Backend**: FastAPI (Python), em `backend/` — ainda incipiente, toda a lógica de dados vai direto ao Supabase via SDK do cliente
- **Banco**: Supabase (PostgreSQL) — credenciais em `frontend/.env` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`)
- **UI**: Tailwind CSS v4 + estilos inline (misturado). Sem biblioteca de componentes, usa ícones do `lucide-react`
- **Gráficos**: Recharts (instalado, ainda não usado)
- **Roteamento**: React Router v7
- **Dados assíncronos**: React Query v5 (instalado, ainda não usado — dados buscados com `useEffect` + `supabase.from(...)` direto)

## Estrutura de pastas relevante

```
frontend/
  src/
    lib/supabase.ts          # cliente Supabase
    App.tsx                  # layout + rotas
    pages/
      dre/DrePage.tsx        # DRE — atualmente só lista empresas (placeholder)
      orcamento/OrcamentoPage.tsx  # editor de orçamento (funcional)
      cadastros/CadastrosPage.tsx  # cadastros somente leitura (funcional)
backend/
  main.py                    # FastAPI, só /health por enquanto
supabase_002_plano_orcamentario.sql  # seed do plano orçamentário
```

> Há uma pasta duplicada `frontend/frontend/` — ignorar, é um artefato de criação errada.

## Modelo de dados (Supabase)

### `empresa`
| coluna | tipo | obs |
|--------|------|-----|
| id | uuid PK | |
| codigo | text | ex: `'01'` |
| descricao | text | |
| ativo | bool | |

### `filial`
| coluna | tipo | obs |
|--------|------|-----|
| id | uuid PK | |
| codigo | text | |
| descricao | text | |
| empresa_id | uuid FK → empresa | |
| imp_fat | numeric | alíquota ISS % |

### `plano_orcamentario`
Hierarquia de 3 níveis (N1 → N2 → N3). Apenas N3 aceita lançamento.

| coluna | tipo | obs |
|--------|------|-----|
| id | uuid PK | |
| codigo | text | ex: `'1'`, `'101'`, `'10101'` |
| descricao | text | |
| nivel | int | 1, 2 ou 3 |
| pai_id | uuid FK → self | null para N1 |
| n1_codigo | text | código do ancestral N1 |
| n2_codigo | text | código do ancestral N2 |
| natureza | text | `'RECEITA'`, `'DESPESA'`, `'NEUTRO'` |
| aceita_lancamento | bool | true só em N3 |
| grupo_folha | bool | true = item de folha de pagamento |

**Estrutura N1:**
- `1` — Receita
- `2` — Despesas
- `3` — Resultado Financeiro
- `4` — Custo de Impostos s/Resultado

### `versao_orcamento`
| coluna | tipo | obs |
|--------|------|-----|
| id | uuid PK | |
| codigo | text | ex: `'BASELINE_2026'` |

Versão usada atualmente: `BASELINE_2026`.

### `fat_lancamento`
Tabela fato principal — armazena valores orçados e realizados.

| coluna | tipo | obs |
|--------|------|-----|
| id | uuid PK | |
| versao_id | uuid FK → versao_orcamento | |
| item_orc_id | uuid FK → plano_orcamentario | |
| empresa_id | uuid FK → empresa | |
| ano | int | ex: `2026` |
| mes | int | 1–12 |
| valor | numeric | |
| tipo_lancamento | text | `'ORCADO'` ou `'REALIZADO'` |
| dim_values | jsonb | dimensões extras (vazio por padrão) |

**Constraint de unicidade**: `(versao_id, item_orc_id, empresa_id, ano, mes, tipo_lancamento)`

**dim_values (JSONB)** — modelo cubo para lançamentos com dimensões extras:
```json
{ "verba": "<uuid>", "funcionario": "<uuid>", "centro_custo": "<uuid>", "projeto": "<uuid>" }
```
Chaves são `dimensao.codigo`; valores são UUIDs da tabela referenciada (`tabela_ref`) ou de `dimensao_valor`.

### Tabelas adicionadas em migration 003

| Tabela | Descrição | Import |
|--------|-----------|--------|
| `centro_custo` | CCs hierárquicos com área/divisão/BU | CentroCusto.csv (`CTT_CUSTO_11`) |
| `conta_contabil` | Plano de contas analítico | ContaContabil.csv (`CT1_CONTA_11`, CLASSE=2) |
| `verba_folha` | Rubricas de folha com vínculo conta+item | srv.csv (`RV_COD`) |
| `funcionario` | Matrículas com filial e CC | Funcionarios.csv (`BK_FUNCIONARIO`) |
| `item_conta_contabil` | Amarração item N3 (não-folha) → contas | UI na aba Plano |
| `dimensao` | Catálogo de dimensões configuráveis | Seed + UI |
| `dimensao_valor` | Valores para dimensões sem tabela própria | UI |

## Páginas implementadas

### `OrcamentoPage` ✅ Funcional
- Tabela hierárquica N1/N2/N3 com expand/collapse + coluna sticky
- Colunas redimensionáveis (Jan–Dez + Total), indentação via flex+espaçadores
- N3 editável por clique → input inline → Enter/blur salva via `upsert`
- Totais de N1 e N2 somados recursivamente
- Filtra `tipo_lancamento = 'ORCADO'`, ano 2026, empresa `codigo='01'`
- Selects de versão/empresa no toolbar ainda mockados

### `CadastrosPage` ✅ CRUD completo
- **8 abas**: Empresas, Filiais, Centro de Custo, Conta Contábil, Verbas, Funcionários, Dimensões, Plano Orçamentário
- Todas com CRUD (add/edit/delete) + importação xlsx
- Importação detecta formato TOTVS automaticamente para CC, Conta, Verbas e Funcionários
- Aba Dimensões: catálogo configurável (tabela_ref ou lista própria) + gestão de valores
- Aba Plano: botão 🔗 em N3 não-folha para gerenciar `item_conta_contabil`

### `DrePage` ⚠️ Placeholder
- Atualmente só testa a conexão com Supabase e lista empresas
- Objetivo real: tabela DRE mostrando Orçado × Realizado por mês com variação %

## O que falta implementar

1. **DRE real** — buscar `fat_lancamento` com ambos os tipos (`ORCADO` e `REALIZADO`), consolidar por item/mês, mostrar colunas Orçado | Realizado | Δ% para cada mês ou no acumulado. Gráfico de barras comparativo com Recharts.
2. **Lançamentos Realizados** — tela análoga ao editor de orçamento mas com `tipo_lancamento = 'REALIZADO'`. Pode ser uma aba dentro do próprio editor ou uma nova rota.
3. **Selects funcionais no editor** — trocar empresa e versão de orçamento dinamicamente.
4. **Dashboard** — KPIs resumidos: Receita orçada vs realizada YTD, % execução orçamentária, principais desvios.
5. **CRUD nos Cadastros** — adicionar/editar/excluir empresas e filiais. O plano orçamentário raramente muda então é baixa prioridade.
6. **Configurações** — placeholder, escopo a definir.

## Convenções de código

- Estilos: mistura de objetos `S` inline (padrão na OrcamentoPage) e classes Tailwind (padrão na DrePage). Preferir inline para consistência com o que já existe em cada arquivo.
- Sem biblioteca de componentes — tudo feito à mão.
- Tipos TypeScript definidos localmente em cada arquivo (não há pasta `types/`).
- Sem testes automatizados.

## Como rodar

```bash
# Frontend
cd frontend
npm install
npm run dev   # http://localhost:5173

# Backend (raramente necessário — dados vão direto ao Supabase)
cd backend
source .venv/bin/activate
uvicorn main:app --reload
```
