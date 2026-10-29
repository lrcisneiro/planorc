# Como pedir a geração do arquivo de import do orçado

Existem **dois caminhos** que terminam no mesmo lugar — o arquivo que a tela
*Orçar → Importar Baseline* aceita. Qual deles vale depende de **onde estão os
números**, e é só isso que você precisa dizer.

---

## O pedido mínimo

> **"Gere o import do orçado a partir de `<arquivo>`."**

Com o caminho do arquivo (ou só "está no Downloads"), é suficiente. Eu abro,
reconheço o formato pelas colunas e escolho o caminho certo. Se o formato for
ambíguo, eu pergunto — não chuto, porque os dois produzem arquivos parecidos e
um erro aqui só apareceria no total da DRE.

Vale acrescentar, **quando for diferente do padrão**:

| diga | se |
|---|---|
| "ano 2028" | não for o ano que está nos cabeçalhos do arquivo |
| "não quero a aba X" | alguma aba de dados não deve entrar |
| "a saída chama Y" | o nome do arquivo importa para você |

---

## Caminho A — planilha de ANÁLISE revisada  ·  `scripts/seed_import.py`

**Quando:** você partiu do realizado, gerou a planilha de análise, revisou os
valores com o time e quer levar a revisão ao Planorc.

**Como reconheço:** abas chamadas `Dados ...` (Despesas Admin, Comercial,
Serviços, Diretoria, MKT, RH) com as colunas `Empresa | Unidade | Filial |
Filial nome | Conta | Descrição da conta | CC | Descrição do CC | Classe` e
depois os meses do ano de origem e os do ano proposto.

**O que ele faz:** lê as 12 colunas **verdes** (a proposta já editada), ignora
as de realizado e as de apoio, e escreve o layout enxuto do importador.

> Abas sem as colunas de mês — `Contas rateadas`, `Aluguel 2027`, `Chave de
> rateio` — são **parâmetro**, não dado: o resultado delas já está nas abas
> `Dados`. Eu confiro isso a cada rodada e digo se alguma conta ficou só na
> aba de parâmetro, porque aí seria perda silenciosa.

> Linha **zerada na revisão não entra** no import. É por desenho: zerar é a
> forma de dizer "não quero isso em 2027".

Esta planilha nasce do **passo 1**, `scripts/seed_analise.py`, que monta a
proposta a partir do realizado classificando cada combinação (recorrente,
volátil, irregular, esporádica) e escolhendo a projeção adequada a cada uma.
Se você precisar da análise de novo — outra base, outro ano —, peça
*"monte a planilha de análise do orçado de `<ano>` a partir de `<arquivo>`"*.

---

## Caminho B — export do GoodData  ·  `scripts/converter_orcado_baseline.py`

**Quando:** os números vêm do relatório *"Validação Lançamentos c Histórico"*
do GoodData, já no grão do orçamento.

**Como reconheço:** linha 1 com rótulos de mês (`Jan 2026`…`Dec 2026`) **acima**
do cabeçalho, e linha 2 com `Bk Codorc1, Código da Empresa, …, Bk Codorc3,
HistóricoOrçamento, Orc_ValorOrc` ×12.

**Atenção:** `Area`, `Divisão` e `BU` **não existem na origem**. Vêm de um
`--mapa-cc` — qualquer xlsx no formato de saída, normalmente a conversão
anterior. CC sem mapa sai como `0` e aparece no log. Se o de-para de CC mudou,
diga: *"use `<arquivo>` como mapa de CC"*.

---

## Depois de gerar, sempre

O importador **casa por código**. Código que não existe no Planorc é
**descartado sem aviso**: a linha some, o total fecha menor, e nada na tela
denuncia — você só perceberia comparando o total da DRE com o total que o
script imprimiu.

Por isso, a cada geração eu produzo junto um `diagnostico_contas_do_import.sql`
com os códigos reais daquele arquivo (contas, CCs, empresas, filiais) e a
pergunta: *existe tudo isso no Planorc?* Rode antes de importar. A última linha
responde em uma frase.

Isso vale **ainda mais quando o plano de contas acabou de mudar**, que é
exatamente quando se gera um import novo.

---

## O que eu reporto em toda geração

- linhas lidas → combinações geradas, e o **total do ano**
- quantas linhas zeradas ficaram de fora
- qualquer aba ignorada, **e se o que ela contém já está no resultado**
- o arquivo de conferência de códigos
