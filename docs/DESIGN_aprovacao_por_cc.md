# Aprovação de postos por CENTRO DE CUSTO — desenho

> Escrito antes de codar, como os outros. Origem: muitos gerentes analisam a
> própria área e há **um aprovador só**; hoje o cenário de postos é um só por
> ano e o fechamento é tudo-ou-nada. Unidade de aprovação decidida com o
> Ricardo em 10/nov/2026: **o CC inteiro, atravessando empresas** — não
> (CC × empresa), não a área funcional.

## 1. O que trava hoje — medido, não suposto

`Orçado2027` tem **15 decisões de posto, todas no CC 111**, espalhadas por 5
empresas (01: 6 · 05: 4 · YY: 3 · 06: 1 · ZZ: 1). Todas pendentes.

Três camadas distintas, e confundi-las é o erro fácil:

| camada | onde | o que acontece |
|---|---|---|
| **vista** | `CenarioDiffModal` | recebe `postos` (lista inteira), de propósito |
| **aprovação** | `aprovar_cenario` | exige **zero pendentes na VERSÃO**: *"Faltam vereditos: N de posto"* |
| **aplicação** | `Aplicar no orçado` | reescreve todo `fat_orcado` origem POSTO da versão |

A camada 1 já foi resolvida (chave *"ver só o recorte da tela"*, padrão
continua sendo o cenário inteiro). **A camada 2 é a que impede o aprovador de
fechar a área do João enquanto a Maria ainda mexe.**

## 2. Por que não copiar "um cenário por área" do orçamento

O orçamento resolveu isso na `v3_171` fazendo a **versão ser da área**
(`origem_versao_id`), e o próprio doc registra que aquilo *"resolve de graça o
escopo da aprovação que ficou em aberto nos postos"*. Em postos **não cabe**:
o `Aplicar` escreve em `fat_orcado`, e cada célula tem **uma** `versao_id`.
Partir postos em N versões espalharia o custo de folha por N versões e a DRE lê
uma só. Não é omissão — a saída colide com o modelo.

## 3. O desenho — carimbo por CC, aplicação continua da versão

A boa notícia veio do código existente: **o `Aplicar` já resolve posto a
posto** — `ov?.aprovado === true ? resolvePosto(p, ov) : p`. Posto não aprovado
entra com o valor do **cadastro**. A única coisa tudo-ou-nada é o carimbo.

Então **o Aplicar não muda de forma**: continua reescrevendo a versão inteira.
Muda só a condição de resolução.

```sql
cenario_cc_aprovacao
  versao_id   uuid
  cc_id       uuid        -- o CC inteiro; empresa NÃO entra na chave
  aprovado_em timestamptz
  aprovado_por uuid
  nota        text
  UNIQUE (versao_id, cc_id)
```

- `aprovar_cc(p_versao, p_cc, p_nota)` — guarda `pode_aprovar_cenario()`;
  exige **zero pendentes entre os postos daquele CC** naquela versão; carimba.
- `reabrir_cc(p_versao, p_cc)` — tira o carimbo. Reversível, como o de hoje.
- **Resolução no Aplicar:** usa o cenário onde `aprovado = true` **E** o CC do
  posto está carimbado. Sem carimbo, o CC inteiro entra com o cadastro —
  exatamente o que já acontece hoje com posto não aprovado, então não há
  comportamento novo a explicar para quem usa.

### Armadilhas que o desenho precisa respeitar

⚠ **O CC do rateio não serve de filtro.** `fat_orcado` guarda o CC de
**destino**; o posto mora no CC de **origem**. "Aplicar só o CC 111" não se
escreve como `delete ... where cc_id = 111`. É por isso que o Aplicar continua
sendo da versão inteira — e, se um dia precisar recortar, a saída está em
`dims`, que para origem POSTO carrega `posto_id` e `cc_origem` (medido).

⚠ **O gatilho que derruba o carimbo passa a derrubar o do CC.** Hoje ele zera
`versao_orcamento.aprovado_em` a qualquer alteração de decisão. Passa a zerar a
linha do CC daquele posto — e o CC vem de `posto`, então o gatilho precisa do
join. Continua sendo **de comando**, com tabela de transição: um lote de 50
decisões é uma escrita, não 50.

⚠ **`aprovar_cenario` é COMPARTILHADA com o orçamento** desde a `v3_172`, e
conta pendências dos dois lados. Se postos ganham carimbo próprio, ela deve
**parar de contar postos** — senão o aprovador do orçamento fica travado por
postos de outra área, que é o mesmo problema mudado de lugar. O carimbo da
versão continua existindo **para as linhas de orçamento**.

⚠ **Posto sem CC** (`cc_id IS NULL`) precisa de resposta explícita: ou um
"lote sem CC" que alguém carimba, ou fica sempre com o cadastro. Não pode cair
no silêncio — é a pergunta "nulo é lacuna ou significado?" da v3_163.

⚠ **Decisão que troca o posto de CC** muda a qual carimbo ele responde. O
veredito é do posto, o carimbo é do CC: ao mudar `cc_id` no cenário, vale o CC
do **cadastro** (é o CC de quem propôs e de quem aprova), e a mudança aparece
como decisão normal.

## 4. Tela

- No comparativo, agrupar por CC e dar um **selo por CC** (pendente ·
  aprovado por fulano em dd/mm). O botão de fechar vira *"Fechar o CC 111"*,
  habilitado quando aquele CC não tem pendência.
- O `Aplicar` diz, na confirmação, **quantos CCs estão carimbados e quantos
  postos entram com o cadastro** — a divergência deliberada da v3_169 continua
  valendo e precisa estar à vista nos três lugares (grade, comparativo,
  confirmação).

## 5. Fases

| | |
|---|---|
| **A1** | ✅ chave *"ver só o recorte"* no comparativo (10/nov/2026) |
| **A2** | `cenario_cc_aprovacao` + `aprovar_cc`/`reabrir_cc` + gatilho por CC + `aprovar_cenario` deixa de contar postos |
| **A3** | Aplicar resolve por carimbo de CC; confirmação diz o que fica de fora |
| **A4** | selo por CC na tela e agrupamento do comparativo |

## 6. Fora de escopo, de propósito

- **Alçada por valor** e **mais de um aprovador** — continuam na fila do F4.
- **Escopo de DADOS por CC para o gerente** já existe (`user_acesso_regra`) e
  não é isto: ele diz o que a pessoa **vê**; o carimbo diz o que está
  **decidido**. Um não substitui o outro.
