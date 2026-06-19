# Design — Estrutura de linhas compartilhada (Nível 1)

## Princípio
Hoje a **linha do relatório** acumula 3 papéis: apresentação, âncora do dado (`fat_orcado.linha_id`) e alvo do mapeamento (`conta_linha.linha_id`). Isso amarra dado+mapeamento a UM relatório, obrigando a copiar tudo para reusar.

O Nível 1 separa **"o que é o dado"** (uma estrutura de linhas compartilhada) de **"como o relatório apresenta"** (layout). Dado e mapeamento passam a ancorar na estrutura compartilhada; o relatório vira uma visão sobre ela.

## Modelo de dados

### Nova tabela: `linha_orcamentaria` (estrutura mestre, compartilhada)
A "plano gerencial" — hierarquia canônica de linhas, reutilizável por vários relatórios.

| coluna | tipo | obs |
|--------|------|-----|
| id | uuid PK | |
| tenant_id | uuid | |
| codigo | text | **único por tenant** — chave de reuso |
| descricao | text | |
| nivel | int | |
| pai_id | uuid → self | hierarquia canônica |
| natureza | text | RECEITA/DESPESA/NEUTRO |
| tipo_linha | text | ANALITICA / SOMAR_FILHOS / FORMULA / INDICADOR / ESPACO |
| expressao | text | fórmula estrutural (ex.: EBITDA) — opcional |
| grupo_folha | bool | |
| formato / casas_decimais | — | defaults (layout pode sobrepor) |

### Mudança de âncora (FKs)
| tabela | hoje | Nível 1 |
|--------|------|---------|
| `fat_orcado.linha_id` | → `relatorio_linha` | **→ `linha_orcamentaria`** |
| `conta_linha.linha_id` | → `relatorio_linha` | **→ `linha_orcamentaria`** |
| `formulario_linha` (conta destino) | → `relatorio_linha` (futuro) | **→ `linha_orcamentaria`** |

### `relatorio_linha` vira camada de apresentação (layout)
Cada linha do relatório passa a ser:
- **(a) referência a uma linha mestre**: `linha_orc_id` → `linha_orcamentaria` (puxa o dado/mapeamento dela), + overrides de apresentação (ordem, negrito, itálico, cor, formato, oculta/desativada **por layout**); ou
- **(b) linha só de apresentação**: `linha_orc_id = null`, com `tipo_linha` SUBTOTAL/INDICADOR/ESPACO/FORMULA e `expressao` própria (subtotais/indicadores específicos daquele relatório).

`relatorio_linha` ganha: `linha_orc_id uuid NULL → linha_orcamentaria`. Mantém `pai_id` (hierarquia do layout), `ordem` e os campos de formatação como **override**. `codigo`/`descricao` podem herdar da mestre (ou sobrepor).

### Não muda
`versao_orcamento`, dimensões do `fat_orcado` (versao/empresa/filial/cc/ano/mes/dims), `fat_realizado` (continua por conta, resolvido via `conta_linha`), `empresa/filial/centro_custo/conta_contabil`, `view_config` (continua por relatório).

## Como fica o seu exemplo
"DRE detalhado" e "DRE consolidado" são **dois layouts** apontando para a **mesma** `linha_orcamentaria` "Receitas" (e filhas/netas). O orçado e o realizado fluem para os dois automaticamente. O consolidado só mostra menos níveis / formatação diferente. Editar uma célula edita o **dado compartilhado** → reflete em todos os layouts. "Duplicar relatório" passa a copiar **só o layout** (os dados já são compartilhados).

## Migração (por código — nada se perde)
1. Criar `linha_orcamentaria`.
2. Popular a partir da **união dos códigos** de todas as `relatorio_linha` existentes (codigo, descricao, nivel, natureza, tipo, expressao; pai resolvido por código). Hoje os códigos já existem → casamento direto.
3. Repontar `fat_orcado.linha_id` e `conta_linha.linha_id`: de `relatorio_linha.id` → `linha_orcamentaria.id`, casando pelo **código** da linha de origem.
4. Em `relatorio_linha`, preencher `linha_orc_id` pelo código.
5. (Limpeza) `relatorio_linha` deixa de ser âncora de dado.

**Cuidado na migração:** se hoje dois relatórios diferentes têm o mesmo código com `fat_orcado` **distintos**, ao repontar os dois cairiam na mesma linha mestre (conflito na unicidade `versao+linha+empresa+filial+cc+ano+mes+dims`). Na prática há **um** relatório com dado (os outros vazios), então é seguro — mas a migração precisa detectar e avisar duplicidade antes de executar.

## Impacto no código / UX
- **Cadastros**: nova tela "Estrutura Orçamentária / Plano de Linhas" (CRUD + import por código) para gerir `linha_orcamentaria`. O import de "Linhas" passa a alimentar aqui.
- **Editor de Relatório**: a grade continua mostrando `relatorio_linha`, mas:
  - ANALITICA puxa o `raw` de `fat_orcado` por `linha_orc_id`; edição de célula grava por `linha_orc_id` (compartilhado).
  - `conta_linha` (🔗) edita o mapeamento na **linha mestre** → vale para todos os layouts.
  - SOMAR_FILHOS soma os filhos **do layout** (subtotais podem variar por layout).
- **Duplicar relatório**: vira cópia de layout (rápido, sem dados).
- **Copiar versão / Realizado / Razão**: praticamente inalterados (a versão é dimensão do fato; o realizado resolve por conta).
- **engine.ts**: mínimo — continua recebendo lista de linhas; muda só de onde vem o `raw` (por `linha_orc_id`).

## Decisões em aberto (precisamos definir antes de executar)
1. **Hierarquia do layout**: herda da mestre por padrão (mais simples) ou cada layout pode reagrupar livremente? (Reagrupar livre já é meio-caminho pro "Nível 2".)
2. **Onde mora cada fórmula**: estruturais (EBITDA) na mestre; indicadores de apresentação no layout. Permitir os dois?
3. **`codigo`/`descricao`**: herdar sempre da mestre ou permitir override de texto por layout?
4. **Formatação**: default na mestre + override por layout (recomendado).
5. **Edição compartilhada**: confirmar que editar a célula num layout muda em todos (é o objetivo).

## Riscos / custo
- Refactor médio: schema (migração de FKs), `loadValores`, edição de célula, novo CRUD da estrutura, ajuste do duplicar.
- Migração de dados precisa do passo de detecção de duplicidade de código com dados.
- Ganho: fonte única de verdade, múltiplos layouts sobre os mesmos dados, consolidação mais fácil, duplicar trivial.

## Como os Formulários (Fase D) se encaixam

### Modelo mental: 3 camadas
A estrutura compartilhada deixa o sistema em 3 camadas claras:
1. **Estrutura** (`linha_orcamentaria`) — as linhas canônicas.
2. **Fontes que alimentam as linhas** → todas escrevem/resolvem no `fat_orcado`/leitura por **linha mestre**:
   - **MANUAL** — digitação/import direto na célula.
   - **FORMULARIO** — memória de cálculo (Fase D) que materializa um resultado na linha.
   - **REALIZADO** — razão do ERP, resolvido por `conta_linha` (já existe).
3. **Relatórios (layouts)** — só apresentação.

O formulário, então, **não pertence a um relatório**: ele é uma fonte que abastece a **linha compartilhada**. Resultado: você monta o cálculo (ex.: folha = headcount × salário) **uma vez**, ele posta na linha "Despesa com Pessoal" da estrutura, e **todos os layouts** que mostram essa linha refletem — sem amarração a um DRE específico. Isso é mais limpo do que no modelo atual, onde o destino seria a linha de UM relatório (ambíguo se a mesma linha existir em vários).

### O que a Fase D está tentando mudar
Hoje o valor nasce digitado na célula (origem MANUAL). A Fase D permite que o valor **nasça de um cálculo estruturado** (com suas próprias dimensões: funcionário, verba, CC, projeto…) e seja **materializado** na linha via "Aplicar" — gravando `fat_orcado` com `origem = FORMULARIO`. O relatório continua lendo só o fato; muda **de onde** o número veio.

### "Adicionar ao lançado" vs "Substituir" (ponto-chave de schema)
O usuário quer que o formulário possa **somar ao que já foi lançado** ou **substituir**. Isso depende de como as origens coexistem no fato:
- **Hoje a unicidade do `fat_orcado` NÃO inclui `origem`**: `(versao, linha, empresa, filial, cc, ano, mes, dims)`. Logo, MANUAL e FORMULARIO **não coexistem** na mesma chave — um sobrescreve o outro.
- Para o modo **ADICIONAR** (formulário soma ao manual), precisamos de uma destas mudanças:
  - (a) incluir `origem` na chave única → MANUAL e FORMULARIO viram linhas separadas que **somam** na leitura; ou
  - (b) o formulário gravar com um marcador em `dims` (ex.: `dims.fonte_formulario = <id>`), o que já o torna chave distinta → soma naturalmente.
- Para o modo **SUBSTITUIR** (a linha passa a ser "propriedade" do formulário): no "Aplicar", limpa as linhas daquele destino/versão/escopo e grava só o resultado do formulário.

Recomendação: **modo por linha do formulário** (`modo_aplicacao = ADICIONAR | SUBSTITUIR`) + adotar a opção (b) (marcador em `dims`) para o ADICIONAR — é reversível e não altera a constraint existente.

> ✅ **DECIDIDO:** comportamento **ADICIONAR** (o formulário **soma** ao que já foi lançado), implementado via **marcador em `dims`** (ex.: `dims.fonte_formulario = <id_formulario_linha>`). Assim a célula = MANUAL + FORMULARIO, sem alterar a constraint. (SUBSTITUIR fica como opção futura, se necessário.)

### Destino do formulário: linha direta vs conta
Duas formas de o formulário saber onde postar:
- **Linha direta**: `formulario_linha.linha_destino_id → linha_orcamentaria` (analítica). Simples e sem ambiguidade.
- **Por conta (simétrico com o realizado)**: a linha do formulário tem uma **conta destino**, e o `conta_linha` (já na estrutura compartilhada) roteia para a linha. Elegante (orçado-via-formulário e realizado fluem pelo mesmo DE-PARA), mas herda a ambiguidade se a conta estiver amarrada a >1 linha.

Recomendação: **linha direta** para o destino do formulário (sem ambiguidade); manter `conta_linha` só para o realizado.

> ✅ **DECIDIDO:** destino do formulário por **linha direta** (`formulario_linha.linha_destino_id → linha_orcamentaria`, analítica). O `conta_linha` fica só para resolver o realizado.

### Regras e interações
- **Destino só pode ser linha ANALÍTICA** da estrutura (linhas SOMAR_FILHOS/INDICADOR/ESPAço e linhas só-de-apresentação do layout **não** recebem dado). SOMAR_FILHOS ignora `raw` próprio, então um formulário nunca posta num totalizador.
- **Valores por versão**: o "Aplicar" grava para uma `versao_id` (Orçado, Forecast…). O mesmo formulário pode gerar valores diferentes por versão.
- **Re-aplicar (sync)**: mudou o formulário → reaplica: apaga as linhas `origem=FORMULARIO` daquele destino/versão/escopo e regrava. O MANUAL não é tocado (no modo ADICIONAR).
- **Copiar versão**: como o `copiar_versao_orcado` copia todas as origens, ele já leva junto o que veio de formulário (vira um *snapshot*). Decidir depois se a cópia mantém o vínculo vivo com o formulário ou é só foto.
- **Razão**: o drill da célula já mostra a coluna `origem` e protege linhas FORMULARIO — continua válido, agora sobre a linha compartilhada.

### Conclusão
O Nível 1 **não atrapalha** a Fase D — pelo contrário, deixa o formulário no lugar certo (fonte da camada de dados, não de um relatório). Decidido: a Fase D acrescenta ao schema apenas (1) `formulario_linha.linha_destino_id → linha_orcamentaria` e (2) o "Aplicar" gravando `fat_orcado` com `origem=FORMULARIO` + `dims.fonte_formulario` (modo **ADICIONAR**, soma ao manual). Nada disso conflita com a migração por código do Nível 1.

## A "conta orçamentária" como HUB (multi-empresa / multi-ERP)

A motivação central da estrutura compartilhada: a `linha_orcamentaria` é, na verdade, uma **conta orçamentária** — o ponto único onde tudo converge, abstraindo as diferenças de plano de contas, ERP e estrutura de cada empresa.

```
  FONTES (heterogêneas)                CONTA ORÇAMENTÁRIA            ESTRUTURAS (saídas)
  ─────────────────────                ─────────────────            ───────────────────
  Folha (RH)        ─┐                                            ┌─ DRE
  Vendas (planilha) ─┤  orçado         ┌──────────────────┐       ├─ DRE consolidado
  Contratos         ─┼───────────────► │ conta            │ ────► ├─ Balanço (BP)
  Manual            ─┘                 │ orçamentária     │       ├─ DFC
                                       │ (hub gerencial)  │       └─ ...
  Contas contábeis  ─── realizado ───► └──────────────────┘
  (cada ERP/empresa, via conta_linha)
```

- **Entradas de orçado**: cada fonte (folha, vendas, contratos, manual) **direciona** seus valores para uma conta orçamentária → grava `fat_orcado` (origem MANUAL/FORMULARIO). As fontes-módulo são os **formulários** da Fase D.
- **Entrada de realizado**: as **contas contábeis** (diferentes por empresa/ERP) são amarradas à conta orçamentária via `conta_linha` (DE-PARA). Assim o realizado de qualquer ERP "fala a língua" gerencial única.
- **Saídas**: as estruturas (DRE/BP/DFC/consolidado) são **layouts** que referenciam as contas orçamentárias.

**Por que resolve multi-empresa/multi-ERP:** planos contábeis distintos convergem para o MESMO conjunto de contas orçamentárias. O consolidado soma por conta orçamentária across empresas (eliminações intercompany entram depois). Tudo já está traduzido para o gerencial.

### Refinamento de nomenclatura (provável fonte da insatisfação)
Hoje chamamos de `linha_orcamentaria`, mas o conceito é **conta orçamentária**. Vale separar bem:
- **`conta_orcamentaria`** (canônica, o hub) — o que recebe orçado e amarra contas contábeis.
- **linha do relatório** (`relatorio_linha`) — só apresentação: referencia uma conta orçamentária + ordem/format/subtotais.

Renomear `linha_orcamentaria` → `conta_orcamentaria` deixaria o modelo alinhado ao seu mapa mental (e separaria "conta" de "linha de apresentação").

### Pontos de atenção do multi-ERP (a decidir)
1. **Contas contábeis homônimas entre ERPs**: hoje `conta_contabil` é única por (tenant, código). Se dois ERPs usam o mesmo código para coisas diferentes, precisaremos escopar a conta por **empresa/ERP** (ex.: `conta_contabil.empresa_id` ou um `origem_erp`), senão o DE-PARA fica ambíguo.
2. **DE-PARA por empresa**: a mesma conta orçamentária recebe contas contábeis de várias empresas; o `conta_linha` (conta→conta_orcamentaria) já suporta N contas → 1 conta orçamentária. Confirmar se o sinal/tratamento pode variar por empresa.
3. **Fontes como módulos**: folha/vendas/contratos são formulários (Fase D) com destino = conta orçamentária (decisão já tomada: linha direta + modo ADICIONAR).

## Fases sugeridas
- **F1**: criar `linha_orcamentaria` + migração por código (sem mudar UI ainda; `relatorio_linha.linha_orc_id` preenchido).
- **F2**: repontar `fat_orcado`/`conta_linha` e ajustar `loadValores` + edição de célula para usar `linha_orc_id`.
- **F3**: tela de gestão da estrutura compartilhada (Cadastros) + import.
- **F4**: duplicar relatório vira layout-only; layouts de apresentação (subtotais/indicadores próprios).
