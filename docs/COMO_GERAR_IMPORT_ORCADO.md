# Como pedir a geração do arquivo de import do orçado

O processo é uma planilha Excel de duas etapas: uma de **análise**, feita para
ser lida e discutida, e um **arquivo de import**, gerado a partir dela. A tela
que recebe é *Orçar → Importar Baseline*.

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

## Passo 2 — da planilha revisada para o import  ·  `scripts/seed_import.py`

É o que você faz na prática: partiu do realizado, gerou a planilha de análise,
revisou os valores com o time, e agora leva a revisão ao Planorc.

**Como reconheço a planilha:** abas chamadas `Dados ...` (Despesas Admin, Comercial,
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

---

## Passo 1 — a planilha de análise  ·  `scripts/seed_analise.py`

Monta a proposta a partir do realizado, no grão empresa × filial × CC × conta,
com o histórico mês a mês ao lado para quem revisa decidir com o número à
vista. **Classifica cada combinação** e aplica a projeção que cabe a ela:

| classe | critério | projeção |
|---|---|---|
| recorrente | 8+ meses, CV ≤ 60% | média dos 3 últimos fechados |
| volátil | 8+ meses, CV > 60% | média de todos os fechados (dilui o pico) |
| irregular | 5 a 7 meses | média dos fechados |
| esporádica | até 4 meses | **repete o mês**, não a média |

Para refazê-la — outra base, outro ano — peça *"monte a planilha de análise do
orçado de `<ano>` a partir de `<arquivo>`"*.

> A análise **não é** o arquivo de import, de propósito. Separar os papéis evita
> o pior dos dois mundos: uma planilha cheia de colunas técnicas que ninguém
> revisa, ou uma planilha legível que não pode ser importada.

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

---

## Nota histórica — o conversor do GoodData

`scripts/converter_orcado_baseline.py` converte o export *"Validação
Lançamentos c Histórico"* do GoodData para o mesmo formato de import. Foi usado
**uma vez, em julho/2026**, e não faz parte do processo de hoje — que é a
planilha Excel descrita acima. Está no repositório porque os arquivos daquela
carga ainda são referência, não porque seja um caminho alternativo a considerar.
