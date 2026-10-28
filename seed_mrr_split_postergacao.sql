-- ============================================================
-- MRR: separa base × nova e calibra a POSTERGAÇÃO de início
--
-- Três coisas, numa conta só (10201 · Receita Recorrente, a que já está lá) —
-- mas com GRAVAÇÃO SEPARADA: base, receita nova e postergação viram três
-- lançamentos no fat_orcado, não um só. A DRE soma e o total é o mesmo; o que
-- se ganha é distinguir as três no drill, que é onde a calibragem acontece.
--
-- Isso exigiu mudar o Aplicar: ele somava linhas que apontavam para a mesma
-- conta ("evita colisão de chave"). A chave única do fat_orcado inclui `dims`,
-- então agora cada linha carimba o próprio código ali e as três coexistem.
--
-- 1) BASE × NOVA. Hoje o `MRR` mistura a carteira que evolui com a receita
--    nova que se acumula, e depois do 2º mês não dá mais para distinguir.
--    Dois estoques separados resolvem, e a soma é IDÊNTICA à de hoje:
--      MRRBASE = (ANTERIOR() + [BASE]) * fatores
--      MRRNOVO =  ANTERIOR()           * fatores + [RECNOVA]
--
-- 2) O CICLO DE FATURAMENTO É DE 2 MESES. A TOTVS fatura no mês da meta, o
--    vencimento cai no mês seguinte e o pagamento no mês depois do vencimento:
--    meta em m → comissão em m+2. Por isso `ANTERIOR([META],2)`, e não o
--    `ANTERIOR([META])` de 1 mês que havia antes.
--
--    ⚠ Consequência em JANEIRO e FEVEREIRO: a receita deles vem da meta de
--    NOV e DEZ do ano anterior, e `ANTERIOR()` não atravessa o ano (devolve 0).
--    Sem `METADEZ` preenchido nos DOIS meses, o ano começa com dois meses de
--    receita nova zerada — medido: −165.328 num exemplo de meta 40k/mês, 1,4%
--    do MRR anual. Com ele preenchido, o resultado é IDÊNTICO ao da defasagem
--    de 1 mês: o ciclo desloca, não destrói.
--
--    ⚠ E no fim do ano: a meta de NOV e DEZ/2027 só vira receita em 2028. São
--    dois meses de venda que não aparecem no orçamento do ano — correto, não é
--    erro, mas surpreende quem compara meta com receita.
--
-- 3) POSTERGAÇÃO. `POST1`/`POST2` são o atraso ALÉM do ciclo de 2 meses (m+3 e
--    m+4), e incidem só sobre a META do ano corrente (futuro incerto), nunca
--    sobre o `METADEZ` (passado que o estudo já conhece mês a mês).
--
--    A perda NÃO se recupera: cada safra entra mais tarde no estoque e o buraco
--    se arrasta até dezembro. Medido com meta 40k/mês, base 1mi, repasse 18,5%:
--      POST1=20% POST2= 0%  →  −2,8% da receita nova do ano
--      POST1=30% POST2=10%  →  −6,9%
--      POST1=50% POST2=20%  →  −12,4%
--
-- 4) `METADEZ` já servia para qualquer mês — a fórmula lê a célula do mês
--    CORRENTE, não só janeiro. Só a descrição induzia ao erro. O estudo pode
--    preencher jan, fev, mar… com o que sabe exatamente que vai entrar.
--
-- SEGURO POR CONSTRUÇÃO: com `POST1` e `POST2` vazios (= 0), o `MRR` dá
-- EXATAMENTE o mesmo de hoje — verificado contra o motor, 12.142.327,26 nos
-- dois. Rodar este seed não muda o orçado de ninguém; só muda quando você
-- preencher os índices.
--
-- Idempotente: re-rodar ATUALIZA fórmula, descrição e ordem.
-- ============================================================

-- ---------- 1 · drivers novos (preencher; vazio = 0 = sem atraso) ----------
INSERT INTO formulario_linha
  (formulario_id, codigo, descricao, ordem, nivel, tipo_linha, expressao, natureza, formato, casas_decimais, conta_destino_id)
SELECT f.id, v.codigo, v.descricao, v.ordem, 1, 'ANALITICA', NULL, 'NEUTRO', 'PERCENTUAL', 2, NULL
FROM formulario f
CROSS JOIN (VALUES
  ('POST1', '% da venda que começa 1 mês depois do previsto', 52),
  ('POST2', '% da venda que começa 2 meses depois do previsto', 54)
) AS v(codigo, descricao, ordem)
WHERE f.nome ILIKE '%recorrente%' AND f.nome NOT ILIKE '%não recorrente%'
ON CONFLICT (formulario_id, codigo) DO UPDATE
  SET descricao = EXCLUDED.descricao, ordem = EXCLUDED.ordem,
      tipo_linha = EXCLUDED.tipo_linha, natureza = EXCLUDED.natureza,
      formato = EXCLUDED.formato, casas_decimais = EXCLUDED.casas_decimais;

-- ---------- 2 · linhas de cálculo ----------
-- `vai_orcado` marca as TRÊS que gravam: elas herdam a conta que o MRR já usa.
-- As de apoio (RECNOVAR, MRRNOVOR) ficam sem conta — são passo intermediário.
INSERT INTO formulario_linha
  (formulario_id, codigo, descricao, ordem, nivel, tipo_linha, expressao, natureza, formato, casas_decimais, conta_destino_id)
SELECT f.id, v.codigo, v.descricao, v.ordem, 1, 'FORMULA', v.expressao, 'RECEITA', 'MOEDA', 2,
       -- A conta sai do MRR; mas o passo 3 zera a dele, então numa SEGUNDA
       -- rodada esta subconsulta voltaria NULL e as três perderiam o destino.
       -- Daí o COALESCE: MRR (1ª vez) → MRRBASE (re-rodadas) → a conta pelo código.
       CASE WHEN v.vai_orcado THEN COALESCE(
         (SELECT conta_destino_id FROM formulario_linha WHERE formulario_id = f.id AND codigo = 'MRR'),
         (SELECT conta_destino_id FROM formulario_linha WHERE formulario_id = f.id AND codigo = 'MRRBASE'),
         (SELECT id FROM conta_orcamentaria WHERE codigo = '10201' LIMIT 1)
       ) END
FROM formulario f
CROSS JOIN (VALUES
  -- fluxo REAL da receita nova: parte escorrega 1 ou 2 meses.
  -- [METADEZ] fica FORA do parêntese do atraso — é entrada já conhecida.
  ('RECNOVAR',  'Receita nova REAL (com postergação) — apoio', 62, false,
   '=(ANTERIOR([META],2) * (100 - [POST1] - [POST2])/100 + ANTERIOR([META],3) * [POST1]/100 + ANTERIOR([META],4) * [POST2]/100 + [METADEZ]) * [REP] / 100'),
  -- as TRÊS que gravam, na mesma conta e em lançamentos separados
  ('MRRBASE',   'Receita recorrente — carteira BASE',          72, true,
   '=(ANTERIOR() + [BASE]) * (1 + [CORR]/100) * (1 - [CHURN]/100)'),
  ('MRRNOVO',   'Receita recorrente — NOVA (no prazo)',        74, true,
   '=ANTERIOR() * (1 + [CORR]/100) * (1 - [CHURN]/100) + [RECNOVA]'),
  ('POSTERGVL', 'Receita recorrente — efeito da POSTERGAÇÃO',  78, true,
   '=[MRRNOVOR] - [MRRNOVO]'),
  -- apoio: passo intermediário do estoque real
  ('MRRNOVOR',  'MRR da receita nova, real — apoio',           76, false,
   '=ANTERIOR() * (1 + [CORR]/100) * (1 - [CHURN]/100) + [RECNOVAR]')
) AS v(codigo, descricao, ordem, vai_orcado, expressao)
WHERE f.nome ILIKE '%recorrente%' AND f.nome NOT ILIKE '%não recorrente%'
ON CONFLICT (formulario_id, codigo) DO UPDATE
  SET expressao = EXCLUDED.expressao, descricao = EXCLUDED.descricao,
      ordem = EXCLUDED.ordem, tipo_linha = EXCLUDED.tipo_linha,
      natureza = EXCLUDED.natureza, formato = EXCLUDED.formato,
      casas_decimais = EXCLUDED.casas_decimais,
      conta_destino_id = EXCLUDED.conta_destino_id;

-- ---------- 3 · o MRR vira CONFERÊNCIA e perde a conta ----------
-- Quem grava agora são as três acima. Se o MRR continuasse com a conta, ele e
-- as três gravariam a mesma receita e a DRE contaria tudo em dobro.
-- ATENÇÃO: isto tem de rodar DEPOIS do passo 2, que lê a conta DELE.
UPDATE formulario_linha l
   SET expressao = '=[MRRBASE] + [MRRNOVO] + [POSTERGVL]',
       descricao = 'MRR / Receita projetada (conferência — soma das três acima)',
       conta_destino_id = NULL,
       ordem = 79
  FROM formulario f
 WHERE f.id = l.formulario_id AND l.codigo = 'MRR'
   AND f.nome ILIKE '%recorrente%' AND f.nome NOT ILIKE '%não recorrente%';

-- ---------- 4 · METADEZ: rótulo + o papel que a defasagem de 2 meses lhe dá ----------
UPDATE formulario_linha l
   SET descricao = 'Venda de períodos anteriores que entra NESTE mês (R$ — preencher JAN e FEV)'
  FROM formulario f
 WHERE f.id = l.formulario_id AND l.codigo = 'METADEZ'
   AND f.nome ILIKE '%recorrente%' AND f.nome NOT ILIKE '%não recorrente%';

-- ---------- 5 · a RECNOVA (ideal) acompanha a defasagem ----------
-- Se ela ficasse em 1 mês e a RECNOVAR em 2, o POSTERGVL (= real − ideal)
-- acusaria uma postergação que não existe, mesmo com os índices zerados.
UPDATE formulario_linha l
   SET expressao = '=(ANTERIOR([META],2) + [METADEZ]) * [REP] / 100',
       descricao = 'Receita nova (meta de 2 meses atrás × repasse)'
  FROM formulario f
 WHERE f.id = l.formulario_id AND l.codigo = 'RECNOVA'
   AND f.nome ILIKE '%recorrente%' AND f.nome NOT ILIKE '%não recorrente%';

-- ---------- conferência ----------
SELECT l.ordem, l.codigo, l.descricao,
       l.tipo_linha || ' · ' || COALESCE(l.natureza,'—') || ' · ' || l.formato AS tipo,
       COALESCE(l.expressao,'— preencher —') AS formula,
       CASE WHEN l.conta_destino_id IS NULL THEN 'apoio' ELSE '→ ORÇADO' END AS destino
  FROM formulario f
  JOIN formulario_linha l ON l.formulario_id = f.id
 WHERE f.nome ILIKE '%recorrente%' AND f.nome NOT ILIKE '%não recorrente%'
 ORDER BY l.ordem;
