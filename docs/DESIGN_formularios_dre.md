# Planorc — Desenho: Formulários, "Aplicar" e DRE

Proposta consolidada a partir das telas do LeverPro. **Nada implementado ainda** — documento para validação.

## 1. Visão geral do fluxo

```
                 ESTRUTURA (definida 1x)              VALORES (por empresa/versão/período)
                 ─────────────────────────            ──────────────────────────────────────
FORMULÁRIO   →   template (tipo FORMULARIO)      +    fat_orcado (linha_id = linhas do formulário)
                 linha_template (cod, fórmula,           • valor manual  ou
                  conta_destino na linha-resultado)      • fórmula de célula (fat_orcado.expressao)

   │  "APLICAR"  (resolve conta destino → linha do DRE via conta_linha, materializa o resultado)
   ▼
DRE (relatório)  →  template (tipo DRE)           +    ORÇADO:    fat_orcado (linha_id = linha do DRE)
                    linha_template (SOMAR_FILHOS,           • manual digitado na linha, ou
                     INDICADOR, FORMULA)                    • postado pelo "aplicar" do formulário
                    view_config (abas 1..5)          +    REALIZADO: fat_realizado (cru do ERP)
                                                             • por conta/CC/funcionário/projeto
                                                             • resolvido p/ linha via conta_linha NA CONSULTA
```

Dois lados se encontram na **linha do DRE**: orçado já chega na linha (manual ou materializado); realizado é agregado por `conta_linha` no momento de montar o relatório.

## 1.1 Modelo de entidades (DECISÃO: separar por comportamento — sem `tipo` fixo)

O `template` polimórfico com `tipo` (DRE/FORMULARIO/DASHBOARD) é **substituído** por 3 entidades por comportamento. DRE/BP/DFC/DVA/DMPL deixam de ser enum e viram **categoria configurável** dentro de Relatório.

**1. Formulário** (memória de cálculo)
- `formulario` — config (cabeçalho).
- `formulario_linha` — linhas, fórmulas, `conta_destino_id` (linha-resultado), `formato`/`casas_decimais`.
- `formulario_valor` — fato: valor por linha/empresa/[filial]/cenário/ano/mês; `valor` digitado **ou** `expressao` (fórmula de célula).

**2. Relatório** (DRE, BP, DFC, … via `categoria`)
- `relatorio` — config + `categoria_id` (→ `categoria_relatorio`, configurável por tenant; nada hardcoded).
- `relatorio_linha` — hierarquia, `tipo_linha` (SOMAR_FILHOS/ANALITICA/FORMULA/INDICADOR/ESPACO), `expressao`, `formato`.
- `fat_orcado` — orçado na `relatorio_linha`: **manual** (`origem=MANUAL`) + **calculado por formulário** (`origem=FORMULARIO`, via Aplicar).
- `fat_realizado` — cru do ERP (por conta/CC/dims), resolvido p/ `relatorio_linha` via `conta_linha` na consulta.

**3. Dashboard** — `dashboard` (widgets/gráficos); modelo detalhado depois.

**Compartilhado em código** (não em tabela): engine de fórmulas, seletor de período, lógica de views. `view_config` existe por entidade (formulário e relatório têm abas). `conta_linha` referencia só `relatorio_linha`.

**Aplicar**: `formulario_valor` (computado) → linha com `conta_destino_id` → `conta_linha` → `relatorio_linha` → upsert em `fat_orcado` (`origem=FORMULARIO`, `origem_formulario_linha_id`).

**Mapeamento de nomes** (as seções abaixo usam os nomes antigos; equivalência):
| antigo | novo |
|---|---|
| `template` (tipo FORMULARIO) | `formulario` |
| `template` (tipo DRE/BP/…) | `relatorio` (+ `categoria`) |
| `linha_template` (no formulário) | `formulario_linha` |
| `linha_template` (no relatório) | `relatorio_linha` |
| `fat_orcado` (valores do formulário) | `formulario_valor` |
| `fat_orcado` (orçado do relatório) | `fat_orcado` (mantém) |
| `template.tipo` (enum) | entidade separada + `relatorio.categoria` |

> Implicação: migração não é só aditiva — envolve **dividir** `template`/`linha_template` em formulário×relatório. As seções 2.x abaixo descrevem os campos; aplicam-se à entidade correspondente pelo mapa acima.

## 2. Campos por entidade (antes "mudanças de schema")

### 2.1 `linha_template`
| coluna nova | tipo | uso |
|---|---|---|
| `conta_destino_id` | uuid FK → conta_contabil (null) | marca a **linha-resultado** de um formulário e a conta para onde o "aplicar" posta |
| `formato` | text default `'NUMERO'` | `NUMERO` \| `PERCENTUAL` \| `MOEDA` — **só exibição** |
| `casas_decimais` | int default 0 | nº de casas na exibição |

> Linha com `conta_destino_id` preenchido = resultado que vai pro relatório. Sem isso, é cálculo/insumo interno.

> **`template.tipo`**: ampliar o enum p/ cobrir as demonstrações (BP, DFC, DVA, DMPL, NOTAS) além de DRE/FORMULARIO/DASHBOARD. A estrutura de `linha_template` (hierarquia + fórmulas) já serve a todas.

### 2.2 `fat_orcado`
| coluna nova | tipo | uso |
|---|---|---|
| `origem` | text default `'MANUAL'` | `MANUAL` \| `FORMULARIO` — o "aplicar" só sobrescreve linhas `FORMULARIO`, preservando o que foi digitado |
| `origem_linha_id` | uuid FK → linha_template (null) | rastreio: qual linha de formulário gerou este valor (para "Detalhes") |

`fat_orcado.expressao` (fórmula de célula) **já existe** — passa a ser usada.

### 2.3 `fat_realizado` — decisão (b) + grão de lançamento (razão)
A tela "Detalhes do Razão" mostra que o realizado precisa ser guardado **no grão do lançamento** (para permitir o drill), não agregado. `fat_realizado` passa a ser a **tabela do razão realizado**.

- Tornar `linha_id` **nullable** (deixa de ser resolvido no import).
- Keyed por `conta_id` + `cc_id` + `dims` (funcionário/projeto/…) + período + empresa/filial.
- A linha do DRE é resolvida **na consulta** via `conta_linha`.

Colunas novas (grão de lançamento, vistas em "Detalhes do Razão"):
| coluna nova | tipo | uso |
|---|---|---|
| `documento` | text | nº do Doc |
| `data` | date | data cheia do lançamento (ano/mes seguem para filtro rápido) |
| `historico` | text | descrição/histórico (inclui fornecedor/parceiro) |
| `debito` | numeric(18,2) | valor a débito |
| `credito` | numeric(18,2) | valor a crédito |
| `dc` | char(1) | `'D'` \| `'C'` |

`valor` (já existe) = **movimentação** (valor com sinal usado no relatório). `debito`/`credito`/`dc` ficam para fidelidade e para o drill.

```sql
ALTER TABLE fat_realizado ALTER COLUMN linha_id DROP NOT NULL;  -- conta_id é a chave de mapeamento
ALTER TABLE fat_realizado
  ADD COLUMN documento text,
  ADD COLUMN data      date,
  ADD COLUMN historico text,
  ADD COLUMN debito    numeric(18,2),
  ADD COLUMN credito   numeric(18,2),
  ADD COLUMN dc        char(1) CHECK (dc IN ('D','C'));
```

> Fornecedor/parceiro: por ora vai no `historico`. Se virar filtro/dimensão, promover a uma key em `dims` numa fase posterior.

### 2.4 Notas por célula (do menu "Editar Nota")
Tabela nova, enxuta:
```sql
CREATE TABLE nota_celula (
  id          uuid PK default gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant,
  linha_id    uuid NOT NULL REFERENCES linha_template,
  empresa_id  uuid REFERENCES empresa,
  versao_id   uuid REFERENCES versao_orcamento,  -- null = nota de realizado
  ano int, mes int,
  texto       text,
  UNIQUE (linha_id, empresa_id, versao_id, ano, mes)
);
```

### 2.5 `view_config` — período flexível
Sem coluna nova: o período entra no `filtros` (jsonb) já existente.
```json
{
  "periodo": {
    "granularidade": "MENSAL",          // ANUAL | SEMESTRAL | TRIMESTRAL | MENSAL | PERSONALIZADO
    "inicio": {"ano": 2018, "mes": 1},  // intervalo contínuo (horizontal)
    "fim":    {"ano": 2020, "mes": 4},
    "periodos": [{"ano":2018,"mes":1}, {"ano":2019,"mes":1}]  // OU lista avulsa (vertical/personalizado)
  },
  "filial": [...], "cc": [...], "dims": {...}
}
```

**Filtros do relatório** (tela de filtros do DRE) — todos persistem no `filtros`:
- *Padrão*: Funções (`funcao` da view), Cenários (`cenarios`), Base (base de agregação, ex.: Unidade).
- *Personalizados* (multi-select com Selecionar/Desmarcar Todos + busca): Empresa/Grupo, **Unidade de Negócio**, Filial, Centro de Custo. Aplicados no botão "Atualizar".

> **Unidade de Negócio** não existe como entidade nossa — provável agrupador de filial ou atributo do CC (`centro_custo.area`). *A confirmar.*

**ACM + granularidade (requisito de visualização).** A visualização precisa de:
- **ACM (acumulado do exercício / YTD)** como coluna de primeira classe, junto dos períodos (funções `MENSAL_ACM` = ACM + períodos, e `ACM` isolado). Calculado no grão mensal e acumulado, independente da granularidade.
- **Granularidade flexível do período**: mensal, **trimestral (quarter)**, semestral, anual ou personalizado — cada balde agrega os meses correspondentes (somas para linhas aditivas; recálculo para INDICADOR/FORMULA com ANTERIOR).

**Cenários = versões.** Cenário não é conceito novo: Orç. 2021, Orç 2021R (revisão), Forecast = linhas de `versao_orcamento`; Realizado é o caso especial. `view_config.cenarios` seleciona quais (uuids + `'REALIZADO'`). O "tipo" da versão (Orçado/Revisão/Forecast) **não vira enum** — é nome/código (coerente com a decisão de não ter tipos fixos); categoria livre só se necessário.
- **Forecast**: pode ser versão **composta** (realizado nos meses passados + orçado/projeção nos futuros) — comportamento opcional, não estrutura nova.
- **Casas decimais** também podem ser ajustadas no nível do relatório/view (override do `formato`/`casas_decimais` por linha).

## 3. Como o "Aplicar" funciona (materialização)

Para um formulário, empresa, versão, ano:
1. Roda o engine sobre as linhas do formulário (insumos + fórmulas de célula + fórmulas de linha) → valores por linha/mês.
2. Para cada linha com `conta_destino_id`:
   - resolve `conta_destino_id` → linha(s) do DRE via `conta_linha` (aplicando `sinal`);
   - faz `upsert` em `fat_orcado` com `linha_id` = linha do DRE, `valor` = resultado, `origem='FORMULARIO'`, `origem_linha_id` = linha do formulário.
3. Linhas `origem='FORMULARIO'` antigas daquele formulário que não foram regeradas são limpas (re-aplicar é idempotente).

O DRE continua lendo orçado por `linha_id` (sem mudança no consumo). Manual e formulário convivem porque `origem` os separa.

## 4. Como o Realizado entra no DRE (decisão b)

Consulta de realizado por linha/período:
```sql
SELECT cl.linha_id, fr.ano, fr.mes, SUM(fr.valor * cl.sinal) AS valor
FROM fat_realizado fr
JOIN conta_linha cl ON cl.conta_id = fr.conta_id
WHERE fr.empresa_id = :emp AND fr.ano = :ano
  -- + filtros da view (filial, cc, dims)
GROUP BY cl.linha_id, fr.ano, fr.mes;
```
Vantagem: mudou o DE-PARA (`conta_linha`), o DRE reflete na hora, sem reprocessar. Custo: join na consulta (mitigável com índices em `conta_id`/`conta_linha`).

**Detalhes do Razão** (drill de uma célula): dada a linha + período + filtros, pega as contas mapeadas (`conta_linha`) e lista os lançamentos crus:
```sql
SELECT fr.conta_id, fr.documento, fr.data, fr.historico, fr.debito, fr.credito, fr.valor, fr.dc
FROM fat_realizado fr
JOIN conta_linha cl ON cl.conta_id = fr.conta_id
WHERE cl.linha_id = :linha AND fr.empresa_id = :emp AND fr.ano = :ano AND fr.mes = :mes
  -- + filtros da view (filial, cc, dims)
ORDER BY fr.data;
-- SUM(valor) = valor da célula no DRE
```

## 5. Engine de fórmulas (dois níveis + funções)

Por período (ponto-fixo, já temos a base):
- **Célula** ANALITICA: usa `fat_orcado.expressao` se houver, senão o `valor` cru.
- **Linha** FORMULA/INDICADOR: usa `linha_template.expressao`.
- **SOMAR_FILHOS**: soma filhos (exclui INDICADOR/ESPACO).

Referências: `[codigo]` no mesmo período; `ANTERIOR()`, `ANTERIOR([cod])`, `ANTERIOR([cod],N)` no tempo. UI exibe "código – nome" ao montar.

Biblioteca de funções (PT → mathjs):
| LeverPro | mathjs |
|---|---|
| ANTERIOR | custom (tempo) |
| MEDIANA | median |
| MEDIA | mean |
| SOMA | sum |
| ARREDONDAR / .PARA.BAIXO / .PARA.CIMA | round / floor / ceil |
| MIN / MAX | min / max |
| SE | ternário |
| CONCATENAR | concat |

**Percentual**: valor guardado é o número puro (IPCA=10), `/100` explícito na fórmula, `formato=PERCENTUAL` só anexa "%". → reverter o ×100 automático que fiz no INDICADOR.

## 5.1 Layout do relatório: níveis e colunas

- **Hierarquia de profundidade livre** via `linha_template.pai_id` + `nivel` (no DRE chega a ~5-6 níveis: CUSTO → CUSTOS DOS SERV. → INFRAESTRUTURA → … → Energia elétrica).
- **Atalhos de nível (1..5)**: controle de UI que expande/colapsa toda a árvore até o `nivel` N. Sem schema novo.
- **Atalho de cenários (1/2 vertical)**: nº de cenários exibidos **lado a lado por período** (1 = um cenário; 2 = dois, ex.: Forecast | Simulação ou Orçado | Realizado). É um atalho do layout período × cenário, não uma view.
- **Layout COMPARATIVO (refinado)**: por período, sub-colunas **Realizado | Orçado | VAR | VAR%**, com seta ▲/▼ colorida por **favorabilidade** (depende de `natureza`: receita abaixo do orçado = desfavorável; despesa abaixo = favorável). Substitui o Δ% simples do COMPARATIVO atual.
- **Estado "NÃO ATUALIZADO"**: indicador de que filtros mudaram e o relatório precisa do "Atualizar".

**Colunas período × cenário + simulação no relatório** (tela "Criação de Orçamento"):
- Cada período pode **expandir (⊕/⊖)** em sub-colunas por **cenário/versão** (ex.: Orç. 2021 | Forecast lado a lado). Generaliza o COMPARATIVO: coluna = par `{período, cenário}`.
- **Células do relatório também aceitam fórmula** (`fat_orcado.expressao`), não só o formulário — usado para **construir cenário por simulação** (ex.: Forecast, Salário Out = `=ANTERIOR()*1,05`). **Mesmo engine** do formulário roda sobre `fat_orcado` (confirma o engine compartilhado em código).
- Edição mira a **coluna da versão** ativa: grava `fat_orcado` com aquele `versao_id`, ora `valor`, ora `expressao`. `ANTERIOR()` anda no tempo **dentro da mesma versão**.
- *Aberto*: fórmula referenciando **outra versão** (ex.: Forecast = Orç × 1,1) — ainda não visto; possível necessidade futura.
- **"Simulação"** = mais uma `versao_orcamento`, provavelmente **derivada/rascunho** de outra (ex.: Forecast) para what-if. Inicialmente espelha a origem e diverge conforme ajustes.

## 5.2 Classificação: colunas por dimensão (pivô, não filtro)

O relatório pode trocar o **eixo das colunas**: em vez de períodos, as colunas viram **membros de uma dimensão** (Centro de Custo, Empresa, Filial, Projeto, Funcionário…), cada um com seu valor + coluna **TOTAL**. É **agregação por entidade**, não filtro.

Abstração-chave: **uma coluna = um conjunto de filtros → roda o engine do DRE → série de valores da linha.** Período e classificação são dois geradores de coluna sobre a mesma máquina. Indicadores (Margem %) são recalculados por coluna.

`view_config.filtros` ganha:
```json
{
  "eixo": "DIMENSAO",            // TEMPO (períodos) | DIMENSAO (classificação)
  "classificacao": "cc",        // cc | empresa | filial | projeto | funcionario ...
  "cenario": "REALIZADO"        // cenário exibido nas colunas
}
```

Consultas:
- **Realizado**: `GROUP BY` a dimensão (fatos já têm `empresa_id/filial_id/cc_id/dims`) + resolução de linha via `conta_linha`. ✅
- **Orçado**: só quebra por uma dimensão **se foi lançado naquele grão**. Orçado consolidado (`cc_id` null) → só TOTAL / "não classificado". Por empresa sempre funciona (`empresa_id` NOT NULL). **Consequência de projeto**: para orçado por CC, o formulário precisa lançar com CC (ex.: "Folha de Pessoal por Áreas"). `fat_orcado.cc_id` nullable já suporta os dois grãos.
- **⊕ nas colunas**: drill hierárquico (expande CC sintético → analíticos), reaproveitando a hierarquia de `centro_custo`/`conta_contabil`.

**Evolução/Composição (drill gráfico de uma linha)** — sem schema novo, só Recharts (já instalado):
- Barras **Realizado × Orçado por entidade** = usa a `classificacao` da view + saída do engine por membro (contextual: muda conforme a dimensão que quebra as colunas).
- **Rosca (composição)** + **Pareto (barras + % acumulado)** = quebram a linha pelos seus **filhos** (hierarquia do `linha_template`), com ACM%.

## 6. Pontos ainda em aberto (recomendação + a confirmar)

1. **Moeda (BRL/USD)**: "DRE BRL", "FORMULÁRIO DE RECEITA BRL" nomeiam o relatório inteiro. Recomendo `moeda` como atributo de `versao_orcamento` (cenário por moeda) em vez de dimensão por célula. *A confirmar.*
2. **Referência entre formulários** (ex.: Volume → Receita): por ora, refs só dentro do mesmo template; cross-template em fase posterior. *A confirmar.*
3. **Filial no preenchimento**: consolidado (filial null) vs por filial — `fat_orcado.filial_id` já é nullable, suporta os dois; definir a UX.

## 7. Ordem de implementação sugerida

- **Fase 0** — Migrations: `conta_destino_id`, `formato`/`casas_decimais`, `fat_orcado.origem`/`origem_linha_id`, `fat_realizado.linha_id` nullable, `nota_celula`.
- **Fase 1** — Formato/casas por linha + biblioteca de funções PT + **fórmula de célula** no editor e no engine (torna o formulário utilizável de verdade). Reverter ×100 do INDICADOR.
- **Fase 2** — `conta_destino` no editor de estrutura + ação **Aplicar** (formulário → orçado do DRE).
- **Fase 3** — Import do realizado (ERP) + agregação do DRE por `conta_linha` (decisão b).
- **Fase 4** — Tela de DRE de verdade (orçado × realizado, ACM, indicadores) reusando o engine de views.
- **Fase 5** — Extras do menu: Notas, Detalhes do Razão (rastreio até lançamentos), Exportar XLS, Projeção Estatística, Evolução/Composição.

## 8. Consolidação societária (FUTURO — só reservar o modelo)

Não é escopo agora. Registrado para garantir que encaixa sem retrabalho.

Conceito: consolidar as demonstrações de um **grupo econômico** combinando as empresas conforme participação e método, removendo intercompany.

Entidades previstas (a desenhar quando for a hora):
- `grupo_economico` — agrupa empresas (ex.: "Holding").
- `acionista` — sócio no topo (PF/PJ); empresas também podem ser sócias.
- `participacao` — grafo de propriedade: sócio → empresa investida, `percentual`, **vigência por período** (a % muda no tempo), `metodo` (INTEGRAL / PROPORCIONAL / EQUIVALENCIA).
- `regra_consolidacao` e `eliminacao_config` (BP e DRE) — eliminações intercompany.

Mecânica em colunas (vista no BP consolidado), no eixo de classificação por empresa:
- colunas por **empresa** → **COMBINAÇÃO** (Σ empresas) → **ELIMINAÇÕES** (sub-colunas Crédito/Débito) → **CONSOLIDADO** (= Combinação + Eliminações). São "colunas de função" sobre o pivô por empresa.
- **Eliminações são lançamentos** (têm débito/crédito) — ajustes intercompany armazenados, gerados por regras **separadas para BP e DRE**.

Como pluga:
- Consolidação = **operação sobre o engine**: relatório do grupo = Σ empresas (× % conforme método) − eliminações. Reusa os fatos por `empresa_id`. O filtro "Empresa/Grupo" já é o gancho (entidade isolada vs grupo).
- **Vale p/ todas as demonstrações** (BP, DRE, DFC…) — depende do `template.tipo` ampliado.
- **Moeda**: empresas em moedas distintas → tradução p/ moeda do grupo via `indice_economico` (câmbio). Liga-se ao ponto aberto de moeda (item 1 da seção 6).

## 9. Permissões / escopo de visualização (depende de auth — em parte futuro)

Hoje `TENANT_ID` é fixo (sem login). Quando houver usuários, três níveis de permissão, atribuíveis **por grupo e por usuário** (usuário sobrepõe grupo):

1. **Escopo de dados por dimensão** — quais membros de empresa/filial/CC/projeto/… o usuário enxerga. Filtra **toda consulta** (camada acima do RLS por tenant). `permissao_escopo` (grupo/usuário → dimensão + membros permitidos).
2. **Acesso a relatório** — quais relatórios pode abrir. `permissao_relatorio` (grupo/usuário → `relatorio`, visível).
3. **Visibilidade de linha** — por `relatorio_linha`, Visível Sim/Não (hierárquico). `permissao_linha` (grupo/usuário → `relatorio_linha`, visível).

Entidades: `grupo_usuario`, `usuario_grupo` (associação), + as 3 tabelas acima.

**DECISÃO**: linha sem acesso é **excluída do cálculo** (não só escondida). A linha não-permitida contribui **0** nas somas (SOMAR_FILHOS) e nas referências de fórmula. Consequências:
- Engine **permission-aware**: recebe o conjunto de linhas visíveis e calcula excluindo o resto.
- **Totais por usuário/grupo** (LUCRO BRUTO, EBITDA… variam conforme acesso) → **não dá p/ materializar/cachear totais globalmente**; o cálculo roda sob o perfil de permissão, junto com o escopo de dados por dimensão.

> O schema já acomoda: as permissões de linha/relatório referenciam `relatorio`/`relatorio_linha` que estamos criando.
