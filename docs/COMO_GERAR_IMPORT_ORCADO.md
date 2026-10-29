# Como pedir a geração do arquivo de import do orçado

A **planilha de análise é o artefato vivo** — é nela que o orçamento é
discutido e editado. Gerar o import é só traduzi-la para o layout que a tela
*Orçar → Importar Baseline* aceita.

A planilha foi criada uma vez, a partir do realizado; daí em diante ela é
revisada e versionada por vocês, e cada rodada de carga parte da versão
corrente dela.

---

## O pedido mínimo

> **"Gere o import do orçado a partir de `<arquivo>`."**

Com o caminho do arquivo (ou só "está no Downloads"), é suficiente. Eu abro,
confiro que é a planilha certa pelas colunas, e digo o que encontrei antes de
gerar. Se o arquivo não for o que espero, eu pergunto em vez de adaptar — um
import gerado do arquivo errado parece certo: mesmo formato, total plausível.

Vale acrescentar, **quando for diferente do padrão**:

| diga | se |
|---|---|
| "ano 2028" | não for o ano que está nos cabeçalhos do arquivo |
| "não quero a aba X" | alguma aba de dados não deve entrar |
| "a saída chama Y" | o nome do arquivo importa para você |

---

## Da planilha revisada para o import  ·  `scripts/seed_import.py`

O único passo do processo de hoje: pega a versão corrente da planilha e escreve
o arquivo de import.

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

## Qual versão da planilha?

A planilha vive fora do repositório e ganha versões (`_unica`, `_revisada`,
`_v3`…). **Diga qual arquivo**, ou "o mais recente do Downloads" — eu confirmo
o nome e a data antes de rodar. Gerar o import da versão errada produz um
arquivo que parece certo: mesmo formato, mesma ordem de grandeza, total
plausível. Só o número final denuncia, e tarde.

---

## Dois scripts que não fazem parte do processo de hoje

Estão no repositório e **não devem ser usados sem decisão explícita**:

- **`scripts/seed_analise.py`** — montou a planilha de análise a partir do
  realizado, classificando cada combinação (recorrente, volátil, irregular,
  esporádica) para escolher a projeção. Rodou **uma vez**; a planilha que ele
  gerou é a que vocês editam hoje. Rodá-lo de novo sobre o mesmo ano produziria
  uma planilha nova, **sem as revisões** — útil só para recomeçar do zero, em
  outro ano ou outra base.
- **`scripts/converter_orcado_baseline.py`** — converte o export *"Validação
  Lançamentos c Histórico"* do GoodData. Usado **uma vez, em julho/2026**. Está
  aqui porque os arquivos daquela carga ainda servem de referência.
