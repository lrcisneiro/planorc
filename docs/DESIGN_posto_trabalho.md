# DESIGN — Posto de Trabalho (orçamento de folha) · F5

> Status: **em discussão** (jul/2026). Decisões tomadas com Ricardo em 09/jul;
> seção «Import de folha e remunerações confidenciais» fechada em 28/jul.
> Referências de mercado: position-based workforce planning (Workday Adaptive,
> Oracle EPM Workforce), payroll reconciliation, variâncias tipificadas
> (attrition/timing/compensação — Visier, headcount365).

## Problema

Orçar folha de pagamento por **posto de trabalho** (estrutura de cargos →
nível de funcionário nominal × verbas) e acompanhar o realizado ao longo do
ano, absorvendo demissões, contratações e transferências sem perder a
referência do orçamento aprovado.

## Decisões estruturais (fechadas)

1. **Grão híbrido** — funcionários nominais (importados do RH, salário real)
   + postos/vagas planejadas (cargo, CC, mês de início). Padrão Workday/Oracle.
2. **Realizado oficial continua contábil** (conta×CC via `fat_realizado`).
   A folha analítica por pessoa entra em **tabela paralela** (`fat_folha`)
   usada para conciliação contabilizado × folha e análise por pessoa.
   Nunca alimenta a DRE.
3. **Eventos + forecast** — baseline congelada na versão aprovada;
   movimentações (admissão/desligamento/transferência/reajuste) são eventos
   datados que recalculam uma versão FORECAST separada.
4. **Cadastro `verba` reestruturado** — era o de verbas do ERP (nunca usado);
   vira o catálogo central: regra de cálculo + conta orçamentária de destino
   + de-para da folha analítica.
5. **Rescisão = provisão contínua** (regra % sobre a base, como encargos).
6. **Dissídio por sindicato/empresa** — cadastro de sindicato com data-base;
   % de reajuste é premissa por versão × sindicato.

## Modelo de dados (novas tabelas / reestruturas)

```
cargo            id, tenant_id, codigo, nome, salario_ref numeric,
                 ativo bool                              -- catálogo simples

sindicato        id, tenant_id, codigo, nome, mes_database int (1-12)

verba (REESTRUTURADA)
                 id, tenant_id, codigo (ERP), descricao,
                 tipo_calculo: BASE          -- o próprio salário
                             | PCT_BASE      -- % sobre salário (INSS, FGTS, rescisão…)
                             | PCT_VERBA     -- % sobre outra verba (encargo s/ provisão)
                             | PROVISAO_1_12 -- 1/12 da base × fator (13º=1; férias=1,3333)
                             | VALOR_FIXO    -- benefício per capita/mês
                             | INFORMATIVA   -- só de-para da folha (não orça)
                 parametro numeric,          -- % / fator / valor
                 verba_ref_id (para PCT_VERBA),
                 conta_destino_id → conta_orcamentaria,   -- Aplicar + conciliação
                 incide_encargos bool,       -- entra na base de PCT_BASE?
                 ordem int, ativo bool

-- AJUSTES 09/jul (dados reais da folha):
--  · posto.regime: CLT | PRESTADOR | PROLABORE — o regime define QUAIS verbas
--    o motor aplica ao posto. SEM regra por código de matrícula: cada modelo
--    tem suas próprias verbas no ERP, e é a VERBA que direciona a conta
--    orçamentária (CLT→20101/20201; prestador→20301 Terceiros, sem encargos).
--  · verba.regime: a que regime a regra se aplica (encargos/provisões = CLT).
--  · verba.aglutina_em: código ERP → verba orçamentária AGREGADA (ex.: bônus/
--    comissões/prêmios → VAR "Remuneração variável"; horas faturáveis/prestação
--    → PREST). Orçamento limpo nas agregadas; realizado abre por código e a
--    conciliação usa o de-para. Verbas de conciliação = tipo INFORMATIVA.

posto            id, tenant_id, codigo, cargo_id, empresa_id, filial_id, cc_id,
                 sindicato_id (null = herda empresa? v1: obrigatório informar),
                 funcionario_id (null = VAGA planejada),
                 salario_base numeric,       -- real (nominal) ou faixa (vaga)
                 ini_ano int, ini_mes int,   -- vigência no orçamento
                 fim_ano int, fim_mes int,   -- null = até dez
                 fte numeric default 1,      -- meio período etc.
                 obs text

posto_evento     id, tenant_id, posto_id, versao_id,      -- eventos SÓ em versões forecast
                 tipo: ADMISSAO | DESLIGAMENTO | TRANSFERENCIA | REAJUSTE | PROMOCAO,
                 ano int, mes int,
                 payload jsonb               -- {cc_id novo, salario novo, %…}

premissa_dissidio  versao_id, sindicato_id, pct numeric   -- % por versão×sindicato
                                                          -- (aplica a partir do mes_database)

fat_folha        id, tenant_id, empresa_id, filial_id, cc_id,
                 funcionario_id (ou matricula texto p/ não-cadastrados),
                 posto_id (resolvido no import — ver §Import de folha),
                 verba_id (resolvida por codigo), ano, mes, valor,
                 ratear bool,                -- flag `rateio` do template (S=true)
                 lote/origem import          -- ERP | CONF (confidencial via XLSX)
```

`fat_orcado` não muda: o Aplicar grava `dims = {posto, funcionario, verba}` e
`origem = 'FORMULARIO'` (ou nova origem 'POSTO' — decidir; nova origem facilita
limpar/reaplicar sem colidir com formulários).

## Motor de cálculo (record-based, separado do engine linha×mês)

Para cada versão × empresa:

```
para cada posto vigente na versão (aplicando eventos da versão por mês):
  para mes = 1..12 dentro da vigência:
    base(mes) = salario_base × fte
                × (1 + dissidio% se mes >= mes_database do sindicato)
                (eventos REAJUSTE/PROMOCAO/TRANSFERENCIA sobrepõem a partir do mês)
    para cada verba ativa (ordem):
      BASE          → base(mes)
      PCT_BASE      → base(mes) × %          (encargos, rescisão-provisão)
      PROVISAO_1_12 → base(mes) × fator / 12 (13º, férias+1/3)
      PCT_VERBA     → valor(verba_ref, mes) × %
      VALOR_FIXO    → valor
    acumula por (verba.conta_destino, empresa, filial, cc, mes)
Aplicar: delete escopo (versão×empresa×origem) + insert fat_orcado
         com dims={posto, funcionario, verba}
```

Desligamento (evento): custo até o mês; a rescisão já está provisionada
mensalmente (decisão 5) — sem one-off no v1.

## Telas (padrão split, rotas novas)

- `/postos` — hub por empresa: grade de postos (cargo, CC, ocupante/vaga,
  salário, vigência, custo anual calculado) + totais headcount/FTE/custo.
  Escopo ORÇAR por empresa (F2). Import de funcionários→postos.
- `/postos/regras` — estrutura (admin): catálogo de verbas/regras (ordem,
  tipo, %, conta destino), cargos, sindicatos + premissas de dissídio.
  Gate capacidade «estrutura».
- `/postos/eventos` (P3) — timeline de movimentações da versão forecast.
- `/folha` (P2) — import da folha analítica + tela de conciliação:
  fat_folha agregada por conta (via verba.conta_destino) × fat_realizado
  (conta×CC×mês) com coluna de diferença; drill por pessoa.
- Variâncias (P3): plano×folha por pessoa → attrition / timing / compensação.

Capacidades novas em `CAPACIDADES`: `menu.postos`, `menu.folha`,
`postos.estrutura` (ou reusar «estrutura»).

## Rateio (CSC — decisões de 09/jul)

Custos de um funcionário/posto/cargo (ou CC inteiro) podem ser rateados para
outras empresas/CCs por percentual — caso típico: Centro de Serviços
Compartilhado. Decisões: o realizado **já vem rateado do ERP** (O×R fecha por
destino); percentuais **fixos por versão** no orçado (variação mensal só
existe no realizado, que chega pronto); alcance = folha primeiro, mas o
conceito serve a outras despesas (ex.: marketing) → **motor genérico e
independente**, que processa qualquer fonte e grava o resultado rateado em
`fat_orcado`.

```
rateio_regra    id, tenant_id, escopo_tipo (FUNCIONARIO|POSTO|CARGO|CC),
                escopo_id, versao_id (null = todas), mes_ini/mes_fim (null = ano),
                ativo
rateio_destino  regra_id, empresa_id, filial_id (null), cc_id, pct
                -- soma = 100% (validação na tela; sem regra = 100% na origem)
```

Motor de rateio (etapa final de qualquer Aplicar):
- entrada: parcelas (verba/linha, empresa, filial, cc, mes, valor) + contexto
  (funcionario, posto, cargo);
- precedência da regra: FUNCIONARIO → POSTO → CARGO → CC (a mais específica);
- saída: N parcelas com empresa/cc de DESTINO e
  `dims = {..., cc_origem, rateio_pct}` — drill mostra a origem.
- Fontes: (1) motor de postos (P1); (2) futuro: pós-processamento de orçado
  por CC (despesas do CSC lançadas na grade/formulários → redistribuídas por
  regra escopo CC; exige origem própria p/ reprocessar idempotente).
- Conciliação da folha (P2): fat_folha está no CC físico da pessoa; para
  bater com o contábil (já rateado), a conciliação aplica as mesmas regras
  antes do confronto.

## Import de folha e remunerações confidenciais (P2 — decisões de 28/jul)

**Contexto.** Diretores/sócios foram retirados da folha convencional do ERP
para restringir quem vê remunerações. O razão contábil **já contempla** os
valores pagos e rateados (lançados em CCs restritos, rateio feito no próprio
ERP) — `fat_realizado` e o orçado (CCs restritos + escopo de dados F2) ficam
íntegros. O gap é **só na `fat_folha`**: o export da folha do ERP não traz
essas pessoas, o que furaria a conciliação contabilizado × folha.

**Princípio** (prática de mercado — Workday Adaptive, FP&A): nunca excluir o
dado; base completa, visão restrita por permissão.

### Template único de import de folha (2 colunas novas)

O template de import da folha analítica ganha duas colunas, válidas tanto
para o export do ERP quanto para o arquivo confidencial:

1. **`posto_codigo`** — opcional, com precedência: se preenchido, amarra a
   linha direto ao posto; se vazio, cai no fallback atual filial+matrícula.
   Validação no import: posto inexistente ou fora de vigência, ou empresa/
   filial incoerente com o cadastro → **erro na linha** (rejeita na carga).
   Necessário para confidenciais (sem matrícula na folha), prestadores,
   pró-labore, transferências no meio do mês e reuso de matrícula.
2. **`rateio`** — define se o **import** expande a linha pelos destinos do posto:
   - **branco ou `N` = NÃO ratear** (default): a linha **já está rateada** — o
     CC/empresa da linha é o destino final, como a contabilidade lançou;
   - **`S` = ratear no import** pelo cadastro do posto (`rateio_regra`/
     `rateio_destino`, precedência FUNCIONARIO → POSTO → CARGO → CC): a linha é
     **materializada** em N linhas rateadas no `fat_folha` (valor × pct por
     destino), como o próprio ERP já faz com o redirect ITEM_CONTABIL.

   > **Revisão 28/jul (decidida na prática):** o rateio é feito no **import**
   > (materializa), NÃO como flag consumido na conciliação. Assim `fat_folha`
   > já guarda o realizado final e não há coluna `ratear` (a v3_066 que a
   > criava foi revertida pela v3_067). Trade-off aceito: é um *snapshot* —
   > se a regra de rateio mudar, reimporta (consistente com o ERP, que também
   > espalha na origem). A expansão **já está implementada** no import da folha
   > (`FolhaRealizadaPage`): `S` roda `cascataRateio` do posto e grava N linhas
   > (valor × pct por destino). Hoje o realizado real vem todo com `N` (já
   > rateado via ITEM_CONTABIL), então na prática não há expansão; a coluna
   > `rateio` é a chave para o caso de um ERP que não pré-rateie. Sem aviso de
   > "posto com regra veio sem `S`" — `N` é o esperado, não exceção.

### Import confidencial (lote CONF)

- Mesmo template; entra como **lote próprio** (`origem = CONF`) — reimport/
  estorno independente do export do ERP via mecanismo de lotes; as duas
  fontes **somam** na mesma competência.
- Linhas **nominais** (decisão 28/jul): `fat_folha` é paralela e restrita,
  não alimenta DRE nem dashboards. Como o contábil desses postos já chega
  rateado, o arquivo confidencial normalmente vem já aberto por CC de
  destino com `rateio` em branco (não ratear de novo).
- **Proteção**: tela `/folha` gateada por capacidade (`menu.folha`) **+**
  escopo de dados por CC (`user_acesso_regra` VER) — quem não enxerga o CC
  restrito não vê as linhas nominais, mesmo com acesso à conciliação.

### Conciliação — regras decorrentes

- O motor rateia **só as linhas `S`**; divergência entre o rateio aplicado e
  o contábil aparece como **categoria própria de variância** («rateio»), não
  como erro.
- Fonte das regras para o realizado: `rateio_regra.versao_id = NULL` vale
  para a conciliação (regras versionadas são do orçado). Percentuais das
  regras devem refletir o praticado no ERP.

## Fases

- **P1 — Orçar por posto**: cargo/sindicato/verba reestruturada + posto +
  motor (incluindo etapa de rateio) + telas /postos, /postos/regras e
  cadastro de rateios + Aplicar. Entrega o orçamento.
- **P2 — Folha analítica**: fat_folha + import mensal (template com
  `posto_codigo` e flag `rateio`; lote CONF p/ confidenciais) + conciliação.
- **P3 — Eventos + Forecast**: posto_evento em versão forecast + variâncias
  tipificadas + premissa de dissídio aplicada por evento re-cálculo.
- **P4 — Dashboards**: headcount/FTE, custo médio, turnover, vacancy savings.
- **P5 — Rateio de despesas gerais**: aplicar o motor de rateio como
  pós-processamento do orçado por CC (marketing, TI, aluguéis do CSC).

## Estruturas de encargo por PAÍS (implementado — ago/2026, schema_v3_074)

Encargos/provisões diferem por país (BR: INSS/FGTS/13º/férias; PY: IPS/aguinaldo;
BO: CNS/AFP/aguinaldo/indemnización). O **motor já era país-agnóstico** — os
primitivos (`PCT_BASE`, `PROVISAO_1_12`, `PCT_VERBA`, `VALOR_FIXO`) cobrem os três.
Faltava **particionar o catálogo por país** (antes só filtrava por `regime`).

Solução (Opção A, mínima): dimensão de país em `empresa.pais` e `verba_folha.pais`.
- O posto resolve o país via `empresa_id`; o motor seleciona a verba se
  `verba.pais IS NULL` (compartilhada) **OU** `verba.pais = posto.pais`
  (`paisAplica` em `motorFolha.ts`), cruzado com o regime.
- `verba.pais NULL` = universal. **Ao ir multipaís, marque o país das verbas de
  cada país**; deixe NULL só as genuinamente universais (senão uma NULL vaza p/ todos).
- Editável em Cadastros → Empresas (país da unidade) e /postos/regras (país da verba).
- Retrocompat: tudo NULL = comportamento atual. `PCT_VERBA` resolve códigos DENTRO
  do conjunto já filtrado por país (sem colisão entre países).
- Se os catálogos divergirem muito no futuro: evoluir p/ "plano de folha" por país
  (padrão `plano_contas` multi-ERP) — a Opção A migra sem retrabalho.
- **Limite correlato** (não é de país): base de incidência é um acumulador único
  (`incide_encargos`); encargos com bases distintas usam `PCT_VERBA`. Outros países
  estressam mais isso — considerar base explícita por verba no futuro.

## Afastamento (implementado — out/2026, schema_v3_117)

**Escopo deliberadamente estreito.** Só o caso concreto: a pessoa que **já está
afastada hoje** e seguirá afastada durante o ano que se orça. Dois casos vizinhos
ficaram de fora, de propósito:

- **licença-maternidade prevista** — a empresa paga o salário integral e compensa
  na GPS, então é efeito de **caixa**, não de despesa, e o FGTS continua *sem*
  compensação. Reduzir a despesa ali seria errado;
- **absenteísmo esperado** — é premissa percentual sobre a folha, não cadastro
  por pessoa. Entraria como verba/premissa, não como janela.

**Modelo.** Janela no próprio posto (`afast_ini_ano/mes`, `afast_fim_ano/mes`,
`afast_motivo`), espelhando a vigência que já existia. `afast_fim_*` nulo = sem
previsão de retorno → vale até dezembro. Não há tabela de histórico: o cadastro de
posto descreve o **ano orçado**, não a vida funcional da pessoa — essa é do ERP.

**A regra no motor é uma linha.** Do 16º dia o auxílio por incapacidade é pago
pelo INSS, então a empresa não paga o salário nem nada que incida sobre ele —
INSS patronal, FGTS (suspenso em doença comum B31), 13º e férias. `calcularPosto`
**zera a base** no mês afastado e a cascata inteira cai sozinha, porque toda ela é
% sobre a base. Sobram os `VALOR_FIXO`, que não dependem da base — e aí a regra é
verba a verba, não uma lei só: plano de saúde e seguro de vida continuam devidos
por CCT/contrato; vale-transporte e VA/VR, não (são por dia trabalhado). Daí a
coluna `verba_folha.mantem_afastado`, marcada em Postos → Regras, default `true`
porque o erro conservador no orçamento é sobrar custo.

> **Limite conhecido:** o motor trata todo afastamento como **doença comum
> (B31)**. Em **acidente de trabalho (B91)** o FGTS *continua* devido, e
> `mantem_afastado` não resolve — a verba de FGTS é `PCT_BASE` e segue a base, que
> está zerada. Se o caso aparecer, a saída é uma verba `VALOR_FIXO` de
> FGTS-acidente com o valor da pessoa; se virar rotina, aí sim o afastamento
> precisa de um **tipo** (o catálogo da Tabela 18 do eSocial), que foi justamente
> o que este escopo decidiu não construir ainda.

**Import do RH.** `converter_funcionarios.py` deriva a coluna `afastado_desde` de
`SRA.RA_SITFOLH`, que neste export vem como **código de uma letra**: vazio=ativo,
`D`=demitido, `F`=férias, `A`=afastado (medido no export de out/2026: 304 / 243 /
14 / 2). **`F` fica fora de propósito** — férias a empresa paga, e a provisão 1/12
já cobre o custo; zerar o salário ali erraria duas vezes. O teste por rótulo
(`AFAST`/`LICEN`/`AUXÍLIO`) ficou como *fallback* para instalações que exportam o
texto em vez do código. O conversor imprime a contagem de `SITFOLHA` inteira, para
a próxima carga mostrar se apareceu um código novo. O ERP sabe que a pessoa *está* afastada, não
*até quando* — então o import grava o início e deixa o retorno **em aberto**, que
é o pior caso (12 meses sem salário), e a grade marca cada linha com o chip
`AFASTADO` para a conferência pessoa a pessoa. A coluna entra no upsert **tudo ou
nada**, como `recebe_hora`: sem ela no arquivo, o import não toca na janela — uma
carga de export antigo apagaria o retorno que alguém já previu.

## Rescisão / demissão futura (implementado — out/2026, schema_v3_118)

**A data já existia.** `posto.fim_ano`/`fim_mes` (vigência fim) é a data da
demissão, e `vigencia()` já parava o custo depois dela. O que faltava é que uma
demissão não só para de custar — **custa mais uma vez**, no mês da saída.

**Três `tipo_calculo` novos**, porque cada parcela tem uma *forma de quantidade*
diferente — não é um parâmetro a mais numa fórmula só:

| tipo | conta | `parametro` |
|---|---|---|
| `RESC_AVISO` | `sal × min(90, 30+3×anos)/30 × param` | multiplicador: 1 indenizado, 0,5 acordo (Lei 13.467/17), 0 aviso trabalhado |
| `RESC_PROP` | `sal × meses do ano/12 × param` | fator: 13º = 1, férias+1/3 = 1,3333 |
| `RESC_SALDO_FGTS` | `sal × meses de casa × param%` | 3,2 = 40% × 8% |

Todas valem **zero** fora do mês do fim de vigência. Daí o FGTS sobre as verbas
rescisórias **não** precisar de tipo novo: é um `PCT_VERBA` comum apontando para
`RESC_AVISO,RESC_13`, que rende 8% de zero nos outros onze meses. O **regime**
faz o recorte — as cinco verbas são `BR-CLT`; prestador e pró-labore têm fim de
contrato, não rescisão, e o filtro por regime já existia.

**O mês representativo exclui a rescisão.** No mês da saída o motor roda a
cascata **duas vezes**, com e sem rescisão: `totalMes` (o "custo/mês" da grade)
fica com o recorrente e `rescisaoAno` carrega o evento. Sem isso a coluna diria
que a pessoa custa 7 salários *todo mês*. Rodar duas vezes também resolve o
`PCT_VERBA`, que de outra forma exigiria rastrear a referência transitivamente.
A rescisão **entra** em `porContaMes`, então vai ao `fat_orcado` no mês certo.

**`posto.admissao`** é coluna própria, não a vigência de início: `ini_*` descreve
o ano orçado e é editável na tela, enquanto o aviso prévio progressivo e o saldo
do FGTS precisam da admissão real. Sem ela o motor cai em `ini_*` (que o import
do RH preenche com a admissão) — e aí o aviso vira 30 dias e a multa, zero.

**Conferido contra o catálogo real do tenant (out/2026), três achados:**

- **faltava o INSS sobre o 13º proporcional** (v3_119). O padrão da casa é
  explícito — `A37 INSS s/ prov. 13º` = 26,8% sobre `A36` (20 INSS + 1 RAT + 5,8
  Terceiros). Na rescisão o 13º tem INSS igual; o aviso prévio indenizado **não**
  (não integra o salário de contribuição) e as férias indenizadas também não. Daí
  `RESC_INSS_13` incidir só sobre `RESC_13`, enquanto o FGTS (`RESC_FGTS_V`) pega
  aviso **e** 13º, porque nos dois é devido;
- **colisão de ordem**: `RESC_AVISO` nasceu em 70, igual a `A36`. Não quebrava
  (ninguém referenciava ninguém ali), mas a cascata resolve referência pela ordem
  e empate é bug esperando. Foram para 200–205;
- **não há provisão mensal de rescisão** nesta instalação (`RESC (interna
  Planorc)` está inativa, e confirmado pelo Ricardo). Sem dupla contagem.

As verbas de rescisão do ERP já existiam como `INFORMATIVA` — `057` Aviso Previo
Indeniz, `A28` Fgts Mes Rescisao, `A29` Fgts-Art.22 40% Mult: são o lado
**realizado**. A v3_119 faz as `RESC_*` **herdarem a conta de destino** delas
(com fallback para a provisão mensal equivalente), para orçado e realizado caírem
na mesma linha da DRE, e grava o de-para em `aglutina_em` na direção que a v3_054
definiu (ERP → orçamentária). ⚠ `aglutina_em` hoje é só cadastro: nenhuma tela o
consome.

Medido com o catálogo real (salário 10.000, saída em maio): **10 anos de casa =
7,25 salários; 3 anos = 3,67; 1 ano = 2,69**. A diferença é quase toda a multa do
FGTS.

**Limites, por serem estimativa:**
- a multa de 40% supõe **salário constante** — o saldo real está no extrato do
  FGTS, que o orçamento não tem. Erra para quem ganhava muito menos anos atrás;
  `parametro` é onde calibrar;
- **férias vencidas** não entram: `RESC_PROP` usa os meses do ano, não o período
  aquisitivo. Quem tem período vencido sai subestimado em ~1,33 salário;
- 13º proporcional ignora a regra dos 15 dias e a projeção do aviso indenizado.

**Dupla contagem** é o risco real: se o catálogo já provisionar rescisão mês a mês
(o padrão contábil — a `PY_IND` do Paraguai faz isso), ela e as `RESC_*` se somam.
A migration procura candidatas por descrição e avisa por `RAISE NOTICE`, com os
dois caminhos: ou a provisão mensal, ou o evento no mês da saída.

**Aviso de conta não amarrada.** `porContaMes` só indexa verba com
`conta_destino_id`, então verba sem conta aparece na grade e **não** chega ao
`fat_orcado`. As `RESC_*` nascem sem conta, então o Aplicar passou a listar quem
tem valor e não tem conta. Era perda silenciosa antes também.

**O que ficou de fora, por decisão:** `motivo_fim` (o regime já separa demissão de
fim de contrato) e o botão "Repor" — reposição é cadastro de dois postos e, no
volume atual, se faz à mão.

## Pendências / a discutir

- Origem no fat_orcado: 'FORMULARIO' reuso vs novo valor 'POSTO' (preferir POSTO).
- `funcionario` atual: conferir colunas (matricula? admissao? salario?) e
  enriquecer via import do RH.
- Encargos que variam por empresa (RAT/FAP, Sistema S): v1 usa % único por
  verba; se precisar por empresa, premissa verba×empresa (mesmo padrão 🌐).
- Salário de VAGA: usar salario_ref do cargo como default.
- RLS/escopo: postos respeitam escopo de dados por empresa/CC (F2).
```
