-- ============================================================
-- v3_179 — Salário do posto entra por RPC, não pelo upsert
--
-- ⚠ `permission denied for table posto` na importação do Quadro. A causa não
-- é o que parece: `INSERT` e `UPDATE` em `salario_base` ESTÃO concedidos. O
-- que falta é **`SELECT`**, revogado de propósito na v3_143 — e o
-- `ON CONFLICT DO UPDATE SET salario_base = excluded.salario_base` **lê** essa
-- coluna. Pelas regras do Postgres, `DO UPDATE` exige `SELECT` nas colunas que
-- as suas expressões leem; `excluded.x` é uma delas.
--
-- Medido: has_table_privilege('authenticated','posto','SELECT') = false,
-- has_column_privilege(...,'salario_base','SELECT') = false, INSERT e UPDATE
-- na mesma coluna = true. Isto é, **gravar pode; o upsert é que não**.
--
-- Estava assim desde a v3_143 e ninguém tinha batido porque ninguém reimportou
-- postos desde então. A v3_142 dizia "gravar não é ler, então escrever salário
-- continua podendo" — verdade para `UPDATE`, falsa para `UPSERT`, e a diferença
-- não estava anotada em lugar nenhum.
--
-- Conserto: o upsert deixa de mandar a coluna (o import já o fazia para quem
-- vem sem salário) e o valor entra por esta função, que faz `UPDATE` puro.
--
-- ⚠ SECURITY DEFINER não vê RLS, então **o recorte vai explícito no WHERE**,
-- com as mesmas funções da política `posto_upd` — mesma solução e mesmo custo
-- de `posto_v` (v3_142): repete-se a FORMA do predicado, não a regra, que
-- continua só em `escopo_dim()`. Ao mexer no escopo de pessoas, conferir aqui.
--
-- Termina em SELECT.
-- ============================================================

CREATE OR REPLACE FUNCTION atualizar_salario_postos(p_dados jsonb)
RETURNS TABLE(atualizados int, fora_escopo int, nao_encontrados int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t uuid := current_tenant_id();
  n_ok int := 0; n_total int; n_existe int;
BEGIN
  IF NOT pode_escrever() THEN
    RAISE EXCEPTION 'Você não tem permissão para alterar postos.' USING ERRCODE = '42501';
  END IF;

  CREATE TEMP TABLE _sal ON COMMIT DROP AS
  SELECT d.codigo, d.salario::numeric AS salario
    FROM jsonb_to_recordset(p_dados) AS d(codigo text, salario numeric);

  SELECT count(*) INTO n_total FROM _sal;
  SELECT count(*) INTO n_existe
    FROM _sal s JOIN posto p ON p.codigo = s.codigo AND p.tenant_id = t;

  UPDATE posto p
     SET salario_base = s.salario
    FROM _sal s
   WHERE p.codigo = s.codigo
     AND p.tenant_id = t
     -- mesmo predicado da política posto_upd
     AND ((SELECT edit_empresa_pessoas()) IS NULL
          OR (p.empresa_id IS NOT NULL AND p.empresa_id = ANY ((SELECT edit_empresa_pessoas())::uuid[])))
     AND ((SELECT edit_filial_pessoas()) IS NULL
          OR (p.filial_id IS NOT NULL AND p.filial_id = ANY ((SELECT edit_filial_pessoas())::uuid[])))
     AND ((SELECT edit_cc_pessoas()) IS NULL
          OR (p.cc_id IS NOT NULL AND p.cc_id = ANY ((SELECT edit_cc_pessoas())::uuid[])));
  GET DIAGNOSTICS n_ok = ROW_COUNT;

  RETURN QUERY SELECT n_ok, n_existe - n_ok, n_total - n_existe;
END $$;

REVOKE ALL ON FUNCTION atualizar_salario_postos(jsonb) FROM public;
GRANT EXECUTE ON FUNCTION atualizar_salario_postos(jsonb) TO authenticated;

SELECT 'v3_179 aplicada' AS resultado,
       (SELECT count(*) FROM pg_proc WHERE proname='atualizar_salario_postos') AS fn,
       has_column_privilege('authenticated','posto','salario_base','UPDATE') AS pode_gravar,
       has_column_privilege('authenticated','posto','salario_base','SELECT') AS pode_ler;
