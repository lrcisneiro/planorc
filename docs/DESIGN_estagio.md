# Estágio — regime próprio (BR-ESTAGIO)

> Status: **desenho**, nov/2026. Não implementado.
> Pedido do Ricardo: "tem funcionários que são estagiário. É outro modelo e você
> está calculando como CLT."

## O defeito, medido

Os três postos de estágio estão cadastrados como **`BR-CLT`**, então o motor
roda neles a cascata inteira de encargos trabalhistas:

| posto | nome | bolsa | admissão |
|---|---|---|---|
| 2002-000036 | Amanda Karen Silva Palmeira | 1.300,00 | 08/09/2026 |
| 2003-000034 | Luiza da Silva Rodrigues | 1.300,00 | 20/07/2026 |
| 2005-VG01 | (vaga) Estagiária | 1.500,00 | — |

A cascata `BR-CLT` soma **60,04%** sobre a base, e nenhum desses itens é devido
no estágio:

```
  A48 INSS empresa          20,0000%
  A50 RAT                    1,0000%
  A49 Terceiros (Sistema S)  5,8000%
  A09 FGTS                   8,0000%
  A30 provisão de férias     8,3333%
  A90 1/3 das férias         2,7775%
  A36 provisão de 13º        8,3333%
  A31 INSS s/ férias         2,2333%
  A37 INSS s/ 13º            2,2333%
  A32 FGTS s/ férias         0,6667%
  A38 FGTS s/ 13º            0,6667%
  ────────────────────────────────────
                            60,0441%   →  R$ 2.461,80/mês  ·  R$ 29.541,60/ano
```

Mais as verbas `RESC_*`, que entram no mês de saída, e a **PLR**: o seed de
17/nov alcançou dois dos três (R$ 703,50 + R$ 1.055,25 = **R$ 1.758,75**),
porque a regra dele é `regime = 'BR-CLT'` e eles estão marcados assim.

Total orçado a mais, em 2027: **≈ R$ 31.300,00** sobre uma base de R$ 49.200,00
— o custo do estagiário está **64% inflado**.

### O realizado já dizia isso

A folha de out/26 dos dois estagiários tem quatro verbas, e nenhuma é encargo:

```
  075   bolsa-auxílio        1.300,00 cada     ← não é a verba 001 do salário CLT
  624   diferença de prêmio    350,00
  643   (não catalogada)       350,00
  D50   multibenefícios        350,00 (desconto)
```

Nem `A48`, nem `A09`, nem `A30`, nem `A36`. **A conciliação Orçado × Folha
mostraria isso como divergência permanente** — e mostra, só que ninguém olhou
três linhas num quadro de 570.

## A lei

**Lei 11.788/2008**, que substituiu a 6.494/77.

**Art. 3º — não há vínculo empregatício.** É daí que decorre tudo: sem vínculo,
não há INSS patronal, FGTS, 13º, férias + 1/3, aviso prévio nem multa de 40%.
O estagiário é segurado **facultativo** do INSS (contribui se quiser, por conta
própria) — a empresa não recolhe nada por ele.

**Art. 9º, IV — seguro contra acidentes pessoais é OBRIGATÓRIO**, por conta da
parte concedente. É o único encargo que o estágio cria e que o CLT não tem em
separado (no CLT ele está embutido no RAT). Apólice de mercado: R$ 100 a R$ 120
por ano por estagiário.

**Art. 12 — bolsa e auxílio-transporte são COMPULSÓRIOS no estágio não
obrigatório.** ⚠ E o transporte **não pode ser descontado** do estagiário — ao
contrário do CLT, onde se desconta até 6% do salário. O valor inteiro é custo
da empresa.

**Art. 13 — recesso de 30 dias remunerado** a cada 12 meses de estágio,
proporcional se o contrato for menor. É o análogo das férias, **sem o 1/3
constitucional**. É a única provisão que o modelo de estágio tem.

**Art. 11 — duração máxima de 2 anos** na mesma parte concedente (salvo PcD).

**Art. 10 — jornada de 6h/dia e 30h/semana** (4h/20h para educação especial e
anos finais do fundamental), com redução pela metade em período de provas.

**Art. 5º, §2º — o agente de integração não pode cobrar do estudante.** Se há
CIEE, IEL ou equivalente, a taxa é **custo da empresa** e precisa estar no
orçado.

**IRRF**: a bolsa é rendimento tributável do estagiário, retido na fonte acima
da faixa de isenção. Não é custo da empresa — mesma situação da PLR.

**Art. 17 — quota** de 10% a 20% do quadro conforme o porte. Não é matéria de
orçamento; fica de fora.

⚠ **Art. 3º, §2º — descaracterização.** Estágio fora da lei (jornada acima do
limite, sem termo de compromisso, sem supervisão, sem relação com o curso) vira
vínculo empregatício **com efeito retroativo**, e aí todos os encargos passam a
ser devidos. É risco jurídico, não linha de orçamento — mas é a razão de o
modelo não poder ser "CLT com desconto".

## O modelo proposto

**Um regime novo, `BR-ESTAGIO`.** O motor **não muda** — `verbasDoRegime()`
(`lib/motorFolha.ts`) já filtra as verbas pela lista de regimes de cada uma, e
não há nenhum `'BR-CLT'` escrito no motor. Era exatamente para isto.

O que muda é cadastro, mais três linhas de tela:

```
  pages/postos/PostosGradePage.tsx:81   REGIMES          + 'BR-ESTAGIO'
  pages/postos/PostosGradePage.tsx:135  cor da etiqueta  + um case
  pages/postos/PostosGradePage.tsx:141  REGIMES_LABEL    + 'BR · Estágio'
  pages/postos/PostosRegrasPage.tsx:62  options do select + a mesma entrada
```

### Verbas do regime

| cód | descrição | cálculo | parâmetro | encargos |
|---|---|---|---|---|
| `075` | Bolsa-auxílio | `BASE` | — | **true** |
| `A13E` | Recesso remunerado (30d/ano) | `PROVISAO_1_12` | 1 | false |
| `A15E` | Auxílio-transporte (estágio) | `VALOR_FIXO` | por posto | false |
| `A52E` | Seguro de acidentes pessoais | `VALOR_FIXO` | ~10,00/mês | false |
| `A60E` | Taxa do agente de integração | `VALOR_FIXO` | por posto | false |
| `D50` | Multibenefícios | `VALOR_FIXO` | por posto | false |

Três decisões dentro dessa tabela:

**`075` é a BASE, e não se reusa a `001`.** A folha paga a bolsa na verba 075 e
o salário CLT na 001. Se o orçado chamasse a base de "001", a conciliação
Contábil × Folha compararia códigos diferentes e acusaria divergência nos dois
sentidos ao mesmo tempo. O código tem de ser o que o ERP paga.

**O recesso é `PROVISAO_1_12` com parâmetro 1** — mesma forma do 13º, sem o 1/3.
⚠ É provisão, não pagamento: o estagiário só tem direito depois de 12 meses, e
os dois de hoje entraram em jul e set/26. Provisionar desde o primeiro mês é o
tratamento conservador e correto — o direito se forma mês a mês, e quem sai
antes de um ano recebe proporcional (art. 13, §2º).

**`D50` ganha `BR-ESTAGIO` na lista de regimes.** Os estagiários recebem de
fato — R$ 350/mês cada no realizado de outubro. ⚠ Esquecer isso tira R$ 4.200/ano
do orçado **sem erro nenhum**: a verba simplesmente não se aplica ao regime e
some da cascata. É o modo de falha desse desenho, e vale para qualquer verba
compartilhada: **ao criar regime novo, varrer o catálogo procurando o que ele
também deveria herdar**, não só o que precisa de verba nova.

### Migração dos três postos

1. `regime = 'BR-ESTAGIO'` nos três.
2. **Apagar as duas linhas de `posto_verba` da PLR.** Trocar o regime já as torna
   inertes (o filtro as descarta), mas linha morta em tabela de valor é a coisa
   que volta a viver quando alguém reclassifica o posto meses depois.
3. Anexar `A15E` / `A52E` / `A60E` com os valores reais.

## Em aberto — precisa do Ricardo ou do RH

1. **A empresa paga vale-transporte aos estagiários?** É obrigatório no estágio
   não obrigatório (art. 12) e **não pode ser descontado**, mas não aparece na
   folha deles — o que pode significar que não se paga, que se paga por fora da
   folha, ou que os estágios são obrigatórios (curricular).
2. **Há agente de integração (CIEE, IEL)?** Se há, a taxa é custo da empresa e
   hoje não está em lugar nenhum do orçado.
3. **Quem paga o seguro de acidentes pessoais, e quanto?** É obrigatório.
4. **O que é a verba `643`?** R$ 350,00 para um estagiário em out/26, e ela
   **não existe no catálogo** `verba_folha`. A `624` ("diferença de prêmio")
   também é R$ 350,00 para o outro — parecem ser as duas pontas de um mesmo
   acerto com a `D50`.
5. **Os 15 postos `ESTAGIARIO(A)` inativos** têm salário zero e nenhum histórico
   de folha ligado. São cadastro velho? Podem ser inativados de vez.
6. **Duas pessoas com bolsa 075 perderam o vínculo com o posto** (Amanda Beatriz
   Lontra e Beatriz Bezerra) — vítimas do "Substituir escopo" de 05/nov.

## Limites conhecidos, declarados

⚠ **A conversão estágio → CLT não é orçável hoje.** É o evento que mais muda o
número (o custo salta ~60% mais benefícios) e o modelo não sabe dizer "vira CLT
em março". Hoje se resolve com dois postos, um terminando e outro começando —
funciona, dá o número certo, e é manual. Mecanizar isso é outro trabalho.

⚠ **O teto de 2 anos não é verificado.** Posto de estágio sem fim de vigência é
orçado para sempre, e a lei diz que não pode. Uma validação na tela (avisar
quando `admissao + 2 anos` cair dentro do ano orçado) resolveria — mas o produto
não tem nenhuma regra de prazo hoje, e esta seria a primeira.

⚠ **Nada impede marcar um estagiário como `BR-CLT` de novo** — e é assim que o
defeito nasceu. A proteção real seria derivar o regime da verba da folha, como
já se faz com prestador × CLT no `converter_funcionarios.py`: quem recebe `075`
é estágio. **É a mesma lição da v3_163 e do regime do Rafael** — a origem sabe,
e perguntar a ela é mais barato que manter a mão.
