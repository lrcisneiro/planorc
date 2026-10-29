-- ============================================================
-- NR: conserta a RAMPA da virada de ano, e separa os dois papéis do METADEZ.
--
-- ───────── O QUE ESTAVA ERRADO ─────────
-- A fórmula do RECNR espalhava o METADEZ em 6 parcelas:
--   ((ANTERIOR([METANR],1)+…+ANTERIOR([METANR],6))/6
--    + ([METADEZ]+ANTERIOR([METADEZ],1)+…+ANTERIOR([METADEZ],5))/6) × [REPNR]/100 + [PREVNR]
--
-- Em JANEIRO todo ANTERIOR devolve 0 (o motor não atravessa o ano), então sobra
-- [METADEZ]/6 — UMA safra de seis. Fevereiro duas, março três… cheio só em
-- junho. Média do 1º semestre: 21/36 = 58,3% do regime.
--
-- Mas em janeiro/27 deveriam estar parcelando as safras de JUL a DEZ/26, seis
-- vendas diferentes, não só a de dezembro. Nenhum arranjo de um único número
-- resolve isso: são seis valores que só o histórico conhece.
--
-- ───────── O CONSERTO ─────────
-- Mesmo padrão que o MRR adotou em 28/out: o estudo entrega o valor MÊS A MÊS
-- já apurado, em vez de o formulário tentar reconstruí-lo por fórmula.
--
--   PARCANT = soma das parcelas de safras ANTERIORES que entram NESTE mês,
--             em R$ BRUTO (o [REPNR] incide sobre ela, como sobre a METANR).
--
-- O estudo preenche jan…jun com o que sobra de jul…dez do ano anterior. A
-- partir de julho a METANR do próprio ano já cobre as seis safras e PARCANT
-- fica vazia.
--
-- ───────── OS DOIS PAPÉIS DO METADEZ ─────────
-- Ele fazia duas coisas que são números DIFERENTES:
--   (a) na rampa, representava PARCELAS entrando  → agora é a PARCANT
--   (b) na MENSNOVA, representa a VENDA de dezembro, que gera mensalidade nova
--       a partir de janeiro: =(ANTERIOR([METANR]) + [METADEZ]) * [PMENS]/100
-- O papel (b) está CERTO e fica. Só o rótulo muda, para ninguém preencher
-- parcelas onde se espera venda.
--
-- ───────── POR QUE O MRRNR NÃO TEM "BASE" (e não é bug) ─────────
--   MRRNR = ANTERIOR() * (1+[CORRNR]/100) * (1-[CHURNNR]/100) + [MENSNOVA]
-- Em janeiro ANTERIOR() é 0, e parece que a carteira de mensalidades acumulada
-- até dez/26 se perde. Não se perde: a conta 10201 recebe TODA comissão
-- recorrente, qualquer que seja a origem, então essas mensalidades antigas já
-- estão no [BASE] do formulário de MRR. Pôr um BASENR aqui contaria a carteira
-- histórica DUAS VEZES. Este formulário projeta só a mensalidade NOVA, gerada
-- pelas vendas NR do próprio ano — e é isso que o MRR não tem, porque as metas
-- de Recorrente, NR e Serviços são separadas, uma por formulário.
--
-- ⚠ NÃO É NEUTRO como o seed de postergação foi. Depois de rodar:
--    1. preencher PARCANT em jan…jun (do estudo) — senão a receita NR do 1º
--       semestre fica MENOR que antes, porque o METADEZ/6 saiu da rampa;
--    2. conferir que METADEZ tem a meta BRUTA de dez do ano anterior;
--    3. re-Aplicar. Até aplicar, o fat_orcado segue com os números velhos (o
--       editor avisa "alterações não aplicadas").
--
-- Idempotente: re-rodar ATUALIZA fórmula, descrição e ordem.
-- ============================================================

-- ---------- 1 · driver novo: parcelas de safras anteriores ----------
INSERT INTO formulario_linha
  (formulario_id, codigo, descricao, ordem, nivel, tipo_linha, expressao,
   natureza, formato, casas_decimais, conta_destino_id)
SELECT f.id, 'PARCANT',
       'Parcelas de safras ANTERIORES que entram NESTE mês (R$ bruto — do estudo)',
       22, 1, 'ANALITICA', NULL, 'RECEITA', 'MOEDA', 2, NULL
FROM formulario f
WHERE f.codigo = 'VENDAS_NR'
ON CONFLICT (formulario_id, codigo) DO UPDATE
  SET descricao = EXCLUDED.descricao, ordem = EXCLUDED.ordem,
      tipo_linha = EXCLUDED.tipo_linha, natureza = EXCLUDED.natureza,
      formato = EXCLUDED.formato, casas_decimais = EXCLUDED.casas_decimais;

-- ---------- 2 · a rampa passa a ler a PARCANT, sem dividir por 6 ----------
-- O estudo já fez a conta do parcelamento; o formulário não tenta refazer.
UPDATE formulario_linha l
   SET expressao = '=((ANTERIOR([METANR],1) + ANTERIOR([METANR],2) + ANTERIOR([METANR],3)'
                || ' + ANTERIOR([METANR],4) + ANTERIOR([METANR],5) + ANTERIOR([METANR],6)) / 6'
                || ' + [PARCANT]) * [REPNR] / 100 + [PREVNR]',
       descricao = 'Receita NR (safras do ano parceladas em 6 meses + safras anteriores) × repasse'
  FROM formulario f
 WHERE f.id = l.formulario_id AND f.codigo = 'VENDAS_NR' AND l.codigo = 'RECNR';

-- ---------- 3 · METADEZ fica só com o papel da mensalidade ----------
UPDATE formulario_linha l
   SET descricao = 'Meta NR de DEZEMBRO do ano anterior (R$ bruto — só gera mensalidade; digitar em JANEIRO)'
  FROM formulario f
 WHERE f.id = l.formulario_id AND f.codigo = 'VENDAS_NR' AND l.codigo = 'METADEZ';

-- ---------- 4 · deixa explícito na tela por que o MRRNR nasce do zero ----------
UPDATE formulario_linha l
   SET descricao = 'Carteira de mensalidades NOVAS do ano (a histórica está no BASE do MRR) — apoio'
  FROM formulario f
 WHERE f.id = l.formulario_id AND f.codigo = 'VENDAS_NR' AND l.codigo = 'MRRNR';

-- ---------- conferência ----------
SELECT l.ordem, l.codigo, l.descricao,
       l.tipo_linha || ' · ' || COALESCE(l.natureza,'—') || ' · ' || l.formato AS tipo,
       COALESCE(l.expressao, '— preencher —') AS formula,
       CASE WHEN l.conta_destino_id IS NULL THEN 'apoio' ELSE '→ ORÇADO' END AS destino,
       (SELECT count(*) FROM formulario_valor v WHERE v.linha_id = l.id) AS n_valores
  FROM formulario f
  JOIN formulario_linha l ON l.formulario_id = f.id
 WHERE f.codigo = 'VENDAS_NR'
 ORDER BY l.ordem;
