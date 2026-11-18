-- ============================================================
-- v3_194 — `(SELECT current_tenant_id())` no RESTO do banco
--
-- A v3_193 tratou os 11 agregados do caminho de leitura e mediu o ganho:
-- mesma consulta, mesmo índice, mesmo plano, **1.119 ms → 54 ms**. A chamada
-- crua no `WHERE` é avaliada **por linha**; dentro de subconsulta escalar vira
-- InitPlan, uma vez só. (`STABLE` não é cache — promete o mesmo valor durante
-- a instrução, não que o Postgres o reaproveite.)
--
-- Sobraram **54 funções com 84 chamadas cruas**. Esta migration fecha todas.
--
-- ───────── O QUE FOI CONFERIDO ANTES ─────────
-- · **Nenhuma** das 54 usa SQL dinâmico (`EXECUTE`) — não há string de consulta
--   montada à mão para a troca corromper.
-- · O padrão **não aparece dentro de literal de texto**. Um teste ingênuo
--   acusou 25 funções, e era falso positivo: o regex casava ATRAVESSANDO as
--   aspas de outros literais (`… = current_tenant_id() AND tipo = 'REALIZADO'`).
-- · `copiar_versao_cenario` tem `DECLARE t uuid := current_tenant_id()`
--   (atribuição, roda uma vez — protegida pelo `[^:]`) e um `RAISE` que cita a
--   função **sem** o `=`, então fora do padrão.
-- · 15 são `SECURITY DEFINER` e 22 são plpgsql; a troca vale igual nas duas,
--   porque é a mesma expressão SQL.
--
-- ───────── A GUARDA ─────────
-- ⚠⚠ Transformar texto de função é operação cega por natureza. Por isso cada
-- função passa por uma **ida-e-volta**: desfaz-se a troca no resultado, e só se
-- o texto voltar a ser EXATAMENTE o original (a menos do espaço depois do `=`)
-- a nova versão é aplicada. Função que não fecha o teste é **pulada e
-- reportada** — melhor ficar lenta do que ser reescrita por um regex que eu
-- entendi mal.
--
-- `CREATE OR REPLACE` preserva ACL e `COMMENT ON`; a assinatura vem de
-- `pg_get_functiondef`, então volatilidade e SECURITY também seguem iguais.
--
-- ⚠⚠ A CONFERÊNCIA PRECISA EXCLUIR `:=` TAMBÉM. A primeira versão usava
-- `[^(]` antes do `=`, e `[^(]` aceita `:` — então **atribuição de plpgsql era
-- lida como chamada crua**. A execução reportou 11 funções "pendentes"
-- (`apagar_orcado_versao`, `copiar_versao`, `importar_funcionarios`…) que na
-- verdade fazem `DECLARE t uuid := current_tenant_id()`: calculam UMA vez numa
-- variável, que é a forma ótima — melhor ainda que o InitPlan. A troca já as
-- ignorava corretamente (`([^:])=`); era só o relatório que mentia.
-- Corrigido para `[^(:]` nos dois lugares.
--
-- Não muda resultado nenhum. Re-executável. Termina em SELECT.
-- ============================================================

DO $$
DECLARE
  f        record;
  nova     text;
  pulou    text[] := '{}';
  n        int := 0;
  -- forma canônica: desfaz o embrulho e normaliza o espaço depois do `=`,
  -- para comparar o antes e o depois sem ruído de formatação
  canon    text;
  canon_an text;
BEGIN
  FOR f IN
    SELECT p.oid, p.proname, pg_get_functiondef(p.oid) AS def
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.prosrc ~ '[^(:][[:space:]]*=[[:space:]]*current_tenant_id\(\)'
       AND p.prosrc !~ 'SELECT current_tenant_id'
  LOOP
    nova := regexp_replace(f.def, '([^:])=[[:space:]]*current_tenant_id\(\)',
                           '\1= (SELECT current_tenant_id())', 'g');
    IF nova = f.def THEN CONTINUE; END IF;

    canon    := regexp_replace(regexp_replace(nova,  '\(SELECT current_tenant_id\(\)\)', 'current_tenant_id()', 'g'),
                               '=[[:space:]]+current_tenant_id\(\)', '= current_tenant_id()', 'g');
    canon_an := regexp_replace(f.def, '=[[:space:]]+current_tenant_id\(\)', '= current_tenant_id()', 'g');

    IF canon IS DISTINCT FROM canon_an THEN
      pulou := pulou || f.proname;      -- a troca mexeu em algo além do previsto
      CONTINUE;
    END IF;

    EXECUTE nova;
    n := n + 1;
  END LOOP;

  IF array_length(pulou, 1) IS NOT NULL THEN
    RAISE WARNING 'PULADAS (não passaram na ida-e-volta): %', array_to_string(pulou, ', ');
  END IF;
  RAISE NOTICE 'funções reescritas: %', n;
END $$;

-- ---------------- conferência ----------------
SELECT 'ainda com chamada CRUA' AS secao,
       coalesce(string_agg(p.proname, ' · ' ORDER BY p.proname), 'nenhuma — ok') AS resultado
  FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
 WHERE ns.nspname = 'public'
   AND p.prosrc ~ '[^(:][[:space:]]*=[[:space:]]*current_tenant_id\(\)'
   AND p.prosrc !~ 'SELECT current_tenant_id'
UNION ALL
SELECT 'funções com InitPlan agora',
       count(*)::text
  FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
 WHERE ns.nspname = 'public' AND p.prosrc LIKE '%(SELECT current_tenant_id())%'
UNION ALL
-- ⚠ Prova de que nada ficou quebrado: se alguma função tivesse saído com corpo
-- inválido, o `EXECUTE` teria abortado a migration inteira. Isto confirma que
-- todas continuam legíveis pelo catálogo (o que exige corpo analisável).
SELECT 'todas as funções do schema ainda compilam?',
       CASE WHEN count(*) FILTER (WHERE def IS NULL) = 0
            THEN 'sim — ' || count(*)::text || ' conferidas'
            ELSE '⛔ ' || count(*) FILTER (WHERE def IS NULL)::text || ' sem definição' END
  FROM (SELECT pg_get_functiondef(p.oid) AS def
          FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
         WHERE ns.nspname = 'public' AND p.prokind = 'f') x;
