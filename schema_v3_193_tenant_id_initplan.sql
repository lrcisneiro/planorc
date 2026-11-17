-- ============================================================
-- v3_193 — `current_tenant_id()` nos agregados: uma vez, não por linha
--
-- SINTOMA: *Orçamento — análise* abria em 40 s; depois de cortar 66 chamadas
-- supérfluas no frontend, ainda 20 s.
--
-- ⚠⚠ A MEDIÇÃO QUE DECIDIU. Mesma consulta, mesmo índice, mesmo plano:
--     dono, tenant literal .................   36 ms
--     personificado, `current_tenant_id()` .. 1.119 ms
--     personificado, `(SELECT current_tenant_id())` ..  54 ms
-- Não era índice e não era a política de RLS — a política JÁ está escrita
-- certo, com `(SELECT escopo_*())`, e o plano mostra InitPlan nos quatro
-- escopos. Quem estava cru era o **`WHERE` da própria função**:
-- `fo.tenant_id = current_tenant_id()` vira chamada **por linha** — 24.398
-- chamadas a ~44 µs. É a armadilha nº 2 da v3_129, que todo mundo aprendeu a
-- evitar DENTRO da policy e ninguém aplicou FORA dela.
--
-- ⚠ `STABLE` não é cache. Promete o mesmo valor durante a instrução; não
-- promete que o Postgres o reaproveite. Quem transforma em avaliação única é a
-- subconsulta escalar, que o planner materializa como InitPlan.
--
-- A TRANSFORMAÇÃO É MECÂNICA e preserva tudo o mais: parte de
-- `pg_get_functiondef`, troca só o padrão `= current_tenant_id()` e
-- re-executa. Assinatura, volatilidade, SECURITY e GRANTs ficam como estavam
-- (CREATE OR REPLACE não mexe em privilégio).
-- ⚠ Não pega `:= current_tenant_id()` (atribuição em plpgsql, roda uma vez só)
-- nem o que já está embrulhado.
--
-- ESCOPO: só os agregados do caminho de LEITURA, que varrem os fatos. As
-- outras ~55 funções têm a mesma chamada crua e devem ser revistas — mas
-- quase todas escrevem, ou leem pouca linha, e uma por vez é mais barato que
-- um lote que ninguém mede.
--
-- Re-executável. Não muda resultado nenhum. Termina em SELECT.
-- ============================================================

DO $$
DECLARE
  f    record;
  nova text;
  n    int := 0;
BEGIN
  FOR f IN
    SELECT p.oid, p.proname, pg_get_functiondef(p.oid) AS def
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.proname = ANY (ARRAY[
             'relatorio_orcado_agg', 'relatorio_realizado_agg',
             'relatorio_orcado_anual', 'relatorio_realizado_anual',
             'relatorio_saldo_agg', 'relatorio_empresa_agg',
             'relatorio_empresa_mes_agg', 'relatorio_linha_empresa_agg',
             'dashboard_cc_agg', 'analise_pessoas_agg', 'contas_com_movimento'])
  LOOP
    -- `([^:])` protege a atribuição `:=` do plpgsql; `[[:space:]]*` cobre o
    -- espaçamento variado entre as funções.
    nova := regexp_replace(f.def, '([^:])=[[:space:]]*current_tenant_id\(\)',
                           '\1= (SELECT current_tenant_id())', 'g');
    IF nova <> f.def THEN
      EXECUTE nova;
      n := n + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'funções reescritas: %', n;
END $$;

-- ---------------- conferência ----------------
SELECT 'ainda com chamada CRUA (esperado: nenhuma)' AS secao,
       coalesce(string_agg(p.proname, ' · ' ORDER BY p.proname), 'nenhuma — ok') AS resultado
  FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
 WHERE ns.nspname = 'public'
   AND p.proname = ANY (ARRAY[
         'relatorio_orcado_agg', 'relatorio_realizado_agg',
         'relatorio_orcado_anual', 'relatorio_realizado_anual',
         'relatorio_saldo_agg', 'relatorio_empresa_agg',
         'relatorio_empresa_mes_agg', 'relatorio_linha_empresa_agg',
         'dashboard_cc_agg', 'analise_pessoas_agg', 'contas_com_movimento'])
   AND p.prosrc ~ '[^(][[:space:]]*=[[:space:]]*current_tenant_id\(\)'
UNION ALL
SELECT 'agora com InitPlan',
       count(*)::text || ' função(ões)'
  FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
 WHERE ns.nspname = 'public'
   AND p.prosrc LIKE '%(SELECT current_tenant_id())%'
UNION ALL
SELECT 'resto do banco, para revisar depois',
       count(*)::text || ' função(ões) ainda com a chamada crua'
  FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
 WHERE ns.nspname = 'public'
   AND p.prosrc ~ '[^(][[:space:]]*=[[:space:]]*current_tenant_id\(\)'
   AND p.prosrc !~ 'SELECT current_tenant_id';
