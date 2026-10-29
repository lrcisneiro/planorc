-- ============================================================
-- v3_124 — IMPOSTOS SOBRE FATURAMENTO, calculados a partir da receita orçada.
--
-- ───────── POR QUE CALCULAR, E NÃO DIGITAR ─────────
-- O imposto não é dado novo: é a receita orçada (já no fat_orcado, por empresa
-- × filial × cc × mês) vezes a alíquota (já em filial.imp_fat). Um formulário
-- ou uma importação na grade exigiriam REDIGITAR a receita por filial só para
-- multiplicar por um número que o sistema já tem — e a cópia envelheceria
-- calada: recalibrar o MRR e reaplicar deixaria o imposto com a receita velha,
-- sem nada na tela denunciar.
--
-- ───────── POR QUE NÃO UMA FÓRMULA NO RELATÓRIO ─────────
-- Foi considerado, e tem a seu favor nunca envelhecer. Três coisas derrubam:
--   1. a alíquota é POR FILIAL e a DRE é consolidada — `=[RECEITA] × taxa`
--      opera sobre o total já somado entre filiais, e só acertaria filtrando
--      uma filial por vez;
--   2. não existiria no fat_orcado, então dashboards, comparativo anual, CAGR
--      e cubos — que leem as RPCs sobre o fato — mostrariam EBITDA sem imposto;
--   3. linha FORMULA não recebe realizado. O realizado do imposto vem do razão
--      (a 13001 tem contas contábeis amarradas), e a comparação Orçado ×
--      Realizado só acontece se os dois lados caírem na MESMA conta mestre.
--      Com fórmula, a linha de imposto nunca teria as duas pontas.
--
-- A flag `redutora` do relatorio_linha ("Redutora de receita (imposto)", que
-- separa bruta de líquida) já pressupõe uma linha de DADOS, não de fórmula.
--
-- ───────── O QUE A BASE INCLUI, E O QUE NÃO ─────────
-- Toda conta de natureza RECEITA com orçado na versão/ano, EXCETO:
--
--   · a própria conta de imposto — senão o imposto tributaria a si mesmo;
--   · o efeito da INADIMPLÊNCIA (linha INADVL do formulário de MRR).
--     Inadimplência é faturar e não receber: o imposto é devido do mesmo jeito.
--     Descontá-la da base subestimaria o imposto. Já a POSTERGAÇÃO fica DENTRO
--     da base, e corretamente: venda postergada não foi faturada, então não
--     gera imposto.
--
-- ⚠ Há contas de natureza RECEITA que talvez não sejam faturamento — reembolso
-- de despesas (111xx, 11020), repasses entre unidades (19901), despesas
-- recuperadas (12101), estornos (122xx). Elas ENTRAM na base hoje, por decisão
-- de "toda a receita da filial". A conferência no fim lista a base conta a
-- conta justamente para isso ser revisto olhando, não assumido.
--
-- ───────── OPERAÇÃO ─────────
-- `origem = 'IMPOSTO'` identifica o que esta rotina gravou — e só isso é
-- apagado numa re-rodada. Lançamento manual na mesma conta sobrevive.
-- Re-rodar DEPOIS de cada mudança de receita (Aplicar de formulário ou posto).
--
-- A rotina é uma RPC para que um botão na tela custe só a interface depois.
-- IDEMPOTENTE. Não toca em receita nenhuma.
-- ============================================================

-- ---------- 1 · o imposto é o quarto produtor do fat_orcado ----------
DO $$ BEGIN
  ALTER TABLE fat_orcado DROP CONSTRAINT IF EXISTS fat_orcado_origem_check;
  ALTER TABLE fat_orcado ADD CONSTRAINT fat_orcado_origem_check
    CHECK (origem IN ('MANUAL','FORMULARIO','POSTO','IMPOSTO'));
END $$;

-- ---------- 2 · a rotina ----------
CREATE OR REPLACE FUNCTION aplicar_impostos_faturamento(
  p_versao uuid,
  p_ano    int,
  p_conta  text DEFAULT '13001'     -- conta orçamentária que recebe o imposto
) RETURNS TABLE(
  empresa text, filial text, aliquota numeric,
  base numeric, imposto numeric, meses int
)
LANGUAGE plpgsql
SET statement_timeout = '120s'
AS $$
DECLARE
  v_conta  uuid;
  v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM versao_orcamento WHERE id = p_versao;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Versão % não encontrada', p_versao; END IF;

  SELECT id INTO v_conta FROM conta_orcamentaria
   WHERE codigo = p_conta AND tenant_id = v_tenant;
  IF v_conta IS NULL THEN
    RAISE EXCEPTION 'Conta orçamentária % não encontrada', p_conta;
  END IF;

  -- apaga só o que ESTA rotina gravou; manual na mesma conta sobrevive
  DELETE FROM fat_orcado
   WHERE tenant_id = v_tenant AND versao_id = p_versao AND ano = p_ano
     AND linha_id = v_conta AND origem = 'IMPOSTO';

  INSERT INTO fat_orcado
    (tenant_id, versao_id, linha_id, empresa_id, filial_id, cc_id, ano, mes,
     valor, expressao, origem, dims)
  SELECT fo.tenant_id, fo.versao_id, v_conta, fo.empresa_id, fo.filial_id, fo.cc_id,
         fo.ano, fo.mes,
         -- NEGATIVO: é redutora de receita, mesma convenção do POSTERGVL/INADVL
         -round(sum(fo.valor) * f.imp_fat / 100, 2),
         NULL, 'IMPOSTO',
         jsonb_build_object(
           'calc',     'IMPOSTO_FAT',
           'aliquota', f.imp_fat,
           'base',     round(sum(fo.valor), 2),
           'historico', 'Imposto s/ faturamento: ' || f.imp_fat || '% sobre '
                        || to_char(sum(fo.valor), 'FM999G999G990D00')
                        || ' de receita (filial ' || f.codigo || ')')
    FROM fat_orcado fo
    JOIN conta_orcamentaria co ON co.id = fo.linha_id
    JOIN filial f              ON f.id  = fo.filial_id
   WHERE fo.tenant_id = v_tenant AND fo.versao_id = p_versao AND fo.ano = p_ano
     AND co.natureza = 'RECEITA'
     AND co.id <> v_conta                              -- não tributa o próprio imposto
     AND coalesce(fo.dims->>'linha', '') <> 'INADVL'   -- inadimplência não reduz a base
     AND f.imp_fat IS NOT NULL AND f.imp_fat <> 0
   GROUP BY fo.tenant_id, fo.versao_id, fo.empresa_id, fo.filial_id, fo.cc_id,
            fo.ano, fo.mes, f.imp_fat, f.codigo
  HAVING sum(fo.valor) <> 0;

  RETURN QUERY
  SELECT e.codigo, f.codigo, f.imp_fat,
         round(sum((fo.dims->>'base')::numeric), 2),
         round(sum(fo.valor), 2),
         count(DISTINCT fo.mes)::int
    FROM fat_orcado fo
    JOIN empresa e ON e.id = fo.empresa_id
    JOIN filial  f ON f.id = fo.filial_id
   WHERE fo.tenant_id = v_tenant AND fo.versao_id = p_versao AND fo.ano = p_ano
     AND fo.linha_id = v_conta AND fo.origem = 'IMPOSTO'
   GROUP BY e.codigo, f.codigo, f.imp_fat
   ORDER BY e.codigo, f.codigo;
END $$;
