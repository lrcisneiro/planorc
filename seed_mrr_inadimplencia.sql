-- ============================================================
-- MRR: parâmetro de INADIMPLÊNCIA.
--
-- ───────── POR QUE NÃO DÁ PARA EMBUTIR, COMO SE FEZ NO NR ─────────
-- No NR o RECNR é FLUXO: multiplicá-lo por (1 − INADIMP/100) desconta uma vez
-- e acabou. Aqui as três linhas que gravam são ESTOQUE e se auto-referenciam:
--
--   MRRBASE = (ANTERIOR() + [BASE]) * (1 + [CORR]/100) * (1 - [CHURN]/100)
--
-- Pôr o fator aí dentro faria o desconto de janeiro entrar no ANTERIOR() de
-- fevereiro e ser descontado DE NOVO, e outra vez em março. A inadimplência
-- viraria churn composto: 3% ao mês acumulariam ~30% de perda no ano, quando
-- o correto é 3%. Churn tira o cliente da carteira para sempre — inadimplência
-- é uma cobrança que não entrou naquele mês, e não reduz a carteira.
--
-- ───────── O DESENHO ─────────
-- Linha própria e negativa, na mesma conta — exatamente o padrão que a
-- POSTERGAÇÃO já usa aqui:
--
--   INADVL = -([MRRBASE] + [MRRNOVO] + [POSTERGVL]) * [INADIMP] / 100
--
-- A carteira fica BRUTA (nada a contamina), a DRE soma os quatro lançamentos e
-- chega no líquido, e no drill dá para ver quanto da projeção é inadimplência —
-- que é onde a calibragem acontece. Bônus de não ter sido embutida: trocar o
-- percentual não exige recalcular estoque nenhum.
--
-- ⚠ A soma é EXPLÍCITA e não `-[MRR] * [INADIMP]/100`. Como o MRR passa a
-- incluir o INADVL, referenciá-lo criaria um ciclo: o motor convergiria para
-- MRR = bruto/(1+i), que não é o que se quer e depende da ordem das linhas.
--
-- ───────── SEGURO POR CONSTRUÇÃO ─────────
-- Com INADIMP vazio o INADVL é zero e o MRR dá EXATAMENTE o de hoje. Rodar
-- este seed não muda número nenhum — e, por não tocar na carteira, o MRRBASE
-- permanece idêntico com ou sem inadimplência, em qualquer percentual.
--
-- ───────── VERIFICADO CONTRA O MOTOR (29/out) ─────────
-- Cenário: BASE 1.000.000 em janeiro, META 40k/mês, CHURN 0,95%, CORR 0,4%,
-- REP 18,5%, METADEZ em jan e fev.
--   · com INADIMP vazio, o total gravado é 12.142.327,26 — o MESMO valor de
--     referência que o seed da postergação registrou, mês a mês idêntico;
--   · a carteira (MRRBASE) de dezembro fica em 935.531,28 com INADIMP de 0%,
--     3% e 10% — INTACTA, que é o ponto do desenho;
--   · o desconto é o percentual exato da receita: 1% → 121.423,27,
--     3% → 364.269,82, 5% → 607.116,36.
--
-- E a medida do erro evitado: embutindo o fator na carteira, 3% ao mês deixam
-- a carteira de DEZEMBRO 30,6% menor — composto, quando o que se queria era
-- descontar 3% da receita.
--
-- Idempotente.
-- ============================================================

DO $$
DECLARE
  v_form  uuid;
  v_conta uuid;
BEGIN
  SELECT id INTO v_form FROM formulario WHERE codigo = 'MRR';
  IF v_form IS NULL THEN RAISE EXCEPTION 'Formulário MRR não encontrado'; END IF;

  -- a conta sai de quem já grava; MRRBASE é a mais estável das três
  SELECT COALESCE(
           (SELECT conta_destino_id FROM formulario_linha WHERE formulario_id = v_form AND codigo = 'MRRBASE'),
           (SELECT conta_destino_id FROM formulario_linha WHERE formulario_id = v_form AND codigo = 'MRRNOVO'),
           (SELECT id FROM conta_orcamentaria WHERE codigo = '10201' LIMIT 1)
         ) INTO v_conta;
  IF v_conta IS NULL THEN
    RAISE EXCEPTION 'Não achei a conta de destino do MRR — o INADVL herdaria NULL e não gravaria.';
  END IF;

  -- ---- driver ----
  INSERT INTO formulario_linha
    (formulario_id, codigo, descricao, ordem, nivel, tipo_linha, expressao,
     natureza, formato, casas_decimais, conta_destino_id)
  VALUES
    (v_form, 'INADIMP', '% de inadimplência sobre a receita do mês', 56, 1,
     'ANALITICA', NULL, 'NEUTRO', 'PERCENTUAL', 2, NULL)
  ON CONFLICT (formulario_id, codigo) DO UPDATE
    SET descricao = EXCLUDED.descricao, ordem = EXCLUDED.ordem,
        tipo_linha = EXCLUDED.tipo_linha, natureza = EXCLUDED.natureza,
        formato = EXCLUDED.formato, casas_decimais = EXCLUDED.casas_decimais;

  -- ---- o efeito, negativo, na mesma conta ----
  INSERT INTO formulario_linha
    (formulario_id, codigo, descricao, ordem, nivel, tipo_linha, expressao,
     natureza, formato, casas_decimais, conta_destino_id)
  VALUES
    (v_form, 'INADVL', 'Receita recorrente — efeito da INADIMPLÊNCIA', 78, 1,
     'FORMULA',
     '=-([MRRBASE] + [MRRNOVO] + [POSTERGVL]) * [INADIMP] / 100',
     'RECEITA', 'MOEDA', 2, v_conta)
  ON CONFLICT (formulario_id, codigo) DO UPDATE
    SET descricao = EXCLUDED.descricao, ordem = EXCLUDED.ordem,
        tipo_linha = EXCLUDED.tipo_linha, expressao = EXCLUDED.expressao,
        natureza = EXCLUDED.natureza, formato = EXCLUDED.formato,
        casas_decimais = EXCLUDED.casas_decimais,
        conta_destino_id = COALESCE(formulario_linha.conta_destino_id,
                                    EXCLUDED.conta_destino_id);

  -- ---- desempata a ordem com a POSTERGAÇÃO ----
  -- As duas nasceram em 78 e `ordem` é int, sem meio-termo: empate deixa a
  -- posição das duas na tela indefinida. A postergação recua um, e a ordem de
  -- leitura fica carteira → nova → apoio → postergação → inadimplência →
  -- conferência.
  UPDATE formulario_linha SET ordem = 77
   WHERE formulario_id = v_form AND codigo = 'POSTERGVL';

  -- ---- a linha de conferência passa a somar as QUATRO ----
  -- Sem isto ela mostraria o bruto enquanto a DRE mostra o líquido, e a
  -- diferença seria lida como erro de carga.
  UPDATE formulario_linha
     SET expressao = '=[MRRBASE] + [MRRNOVO] + [POSTERGVL] + [INADVL]',
         descricao = 'MRR / Receita projetada (conferência — soma das quatro acima)'
   WHERE formulario_id = v_form AND codigo = 'MRR';
END $$;

-- ---------- conferência ----------
SELECT l.ordem, l.codigo, l.descricao,
       COALESCE(l.expressao, '— preencher —') AS formula,
       CASE WHEN l.conta_destino_id IS NULL THEN 'apoio' ELSE '→ ORÇADO' END AS destino,
       (SELECT count(*) FROM formulario_valor v WHERE v.linha_id = l.id) AS n_valores
  FROM formulario f
  JOIN formulario_linha l ON l.formulario_id = f.id
 WHERE f.codigo = 'MRR'
 ORDER BY l.ordem;
