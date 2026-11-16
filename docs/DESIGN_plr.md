# PLR no orçamento de folha — desenho

> Escrito antes de codar. Decisões com o Ricardo em 17/nov/2026.
> **Premissa que manda em tudo: orçado é orçado, não precisa ser exato.**

## 1. O que a lei dá de graça (Lei 10.101/2000)

A PLR **não tem natureza salarial**, e por isso **não incide**: INSS (patronal
e empregado), FGTS, 13º, férias/1/3, aviso prévio nem multa rescisória. Só
IRRF, em **tabela exclusiva** — e o IRRF é retido **do funcionário**, não é
custo da empresa, então **fica fora do modelo**.

No motor isso é **um checkbox**, não código: `custoMes` acumula `baseEncargos`
só com as verbas marcadas `incide_encargos`, e é sobre ela que `PCT_BASE`
(INSS, FGTS) e `PROVISAO_1_12` (13º, férias) calculam. `incide_encargos =
false` cobre a isenção inteira.

Duas regras de forma, que o cadastro deve impedir de violar — descumpri-las
**descaracteriza a PLR** e a transforma em salário, com INSS retroativo:

- **no máximo 2 pagamentos** no mesmo ano civil (art. 3º, §2º);
- **intervalo mínimo de 1 trimestre civil** (era semestre até a reforma de 2020).

⚠ Medido no `srd`: em 2026 as parcelas foram **março e junho** — exatamente o
mínimo legal. Em 2024 e 2025 foram março e setembro. O calendário muda de ano
para ano, e é por isso que ele tem de ser **configurável**, não constante.

## 2. O modelo

Uma verba só:

```
verba PLR
  tipo_calculo     PARCELAS          ← o que falta no motor
  incide_encargos  false             ← a isenção inteira
  regime           BR-CLT            ← já existe
  calendário       "3:50;6:50"       ← mês:% da parcela, configurável
```

- **Valor por pessoa, por ano**, em `posto_verba.valor` — tabela que já existe
  e já é editável na tela do posto. A planilha do RH entra ali como seed.
- **O calendário vive na VERBA**, não na pessoa: "quando a empresa paga PLR" é
  decisão da empresa. Mudar de 50/50 para 40/60, ou de março/junho para
  março/setembro, é cadastro.
- No motor, `PARCELAS` devolve `valor × percentual` no mês listado e **zero nos
  demais** — mesma mecânica que as `RESC_*` já usam para valer só no mês da
  saída. O precedente existe; falta generalizar.

**Validações que o cadastro deve fazer** (a lei paga por elas): no máximo 2
parcelas, pelo menos 3 meses entre elas, percentuais somando 100%.

## 3. O que fica DE FORA, de propósito

⚠ Esta seção existe para ninguém "corrigir" isto depois achando que é defeito.

- **IRRF, contribuição negocial (`639`) e desconto da 1ª parcela (`559`)** —
  todos **descontos do empregado**. Não são custo da empresa.
- **A diferença entre as parcelas.** Medido no realizado de 2026: março teve 86
  pessoas e 146.583,72; junho, 54 e 89.995,64 — 61/39. A diferença vem do
  desconto do sindicato e da proporcionalidade aos meses trabalhados desde o
  início do ano anterior. **Nada disso entra no motor**: o valor por pessoa já
  chega pronto do RH, e o rateio entre as parcelas é o percentual do
  calendário.
- **Elegibilidade por parcela.** No realizado há quem receba só numa das duas.
  O orçado distribui o valor da pessoa pelas duas parcelas. É aproximação
  consciente: **orçado é orçado**.

**A consequência de aceitar isso, dita de uma vez:** a conciliação Orçado ×
Folha **não vai casar pessoa a pessoa** nos meses de PLR, e nem no total de
cada parcela. Vai casar no ano. Quem for conferir precisa saber disso antes de
procurar defeito.

## 4. Duas consequências de tela

⚠ **O "custo/mês" salta nos meses de parcela.** A coluna mostra o *último mês
vigente*, não a média, e a grade já marca com asterisco quando
`custo/mês × 12 ≠ custo ano` (reajuste, afastamento, rescisão). PLR entra nessa
família: sem o asterisco, parece erro de conta.

⚠ **A PLR não aparece hoje na conciliação Contábil × Folha** porque
`fat_folha` só tem as competências carregadas (mai, ago, set, out/26) e as
parcelas caíram em março e junho. Não é defeito do modelo — é cobertura de
carga. Se a conciliação da PLR importar, os meses das parcelas precisam ser
importados.

## 5. O que precisa ser construído

| | |
|---|---|
| 1 | `tipo_calculo = 'PARCELAS'` no motor (`custoMes`) + coluna de calendário em `verba_folha` |
| 2 | validações do cadastro da verba (2 parcelas · 3 meses · 100%) |
| 3 | a verba PLR no catálogo, com `incide_encargos = false` e `regime = BR-CLT` |
| 4 | seed do valor por pessoa, a partir da planilha do RH |
| 5 | asterisco do "custo/mês" reconhecendo PLR |
