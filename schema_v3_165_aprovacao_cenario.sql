-- ============================================================
-- v3_165 — Aprovação do cenário de postos
--
-- O gerente de área decide no cenário (v3_164 + `posto.cenario.decidir`); o
-- controller aprova; só então o quadro vira dinheiro no orçamento. A aprovação
-- é da VERSÃO e não do posto: o cenário é a unidade de negociação, e aprovar
-- linha a linha transferiria ao aprovador a responsabilidade que é de quem
-- propôs.
--
-- ⚠ A REGRA QUE IMPEDE O CARIMBO DE APODRECER: qualquer alteração nas decisões
-- DERRUBA a aprovação. Sem isso aprova-se um cenário, alteram-se três postos
-- depois, e o carimbo continua lá dizendo que está aprovado — mentira silenciosa
-- e exatamente o tipo de defeito que ninguém descobre até precisar.
-- **Tem de ser gatilho, não regra de tela:** a tela não é a única coisa que
-- escreve em `posto_versao` (API, import, carga futura).
--
-- ⚠ `pode_aprovar_cenario()` é a SEGUNDA repetição deliberada do catálogo de
-- capacidades em SQL — a primeira é `pode_ver_folha()` (v3_142), e a razão é a
-- mesma: decisão de autoridade tem de valer no banco, e o catálogo do frontend
-- não existe lá. Sem ela, um `member` aprova o próprio cenário pela API e o
-- controle vira teatro. Custo aceito: mudar o padrão em `lib/capacidades.ts`
-- exige mudar aqui junto.
--
-- NÃO detecta aprovação desatualizada por mudança no MESTRE, de propósito: a
-- importação mensal do RH toca todos os postos e marcaria toda aprovação como
-- velha, inclusive de quem o cenário não decide. `aprovado_em` fica à vista e
-- quem lê julga.
--
-- `bloqueada` continua sendo outra coisa: aprovar libera o Aplicar; bloquear
-- congela a versão depois.
--
-- Termina em SELECT.
-- ============================================================

ALTER TABLE versao_orcamento ADD COLUMN IF NOT EXISTS aprovado_em   timestamptz;
ALTER TABLE versao_orcamento ADD COLUMN IF NOT EXISTS aprovado_por  uuid;
ALTER TABLE versao_orcamento ADD COLUMN IF NOT EXISTS aprovacao_nota text;

CREATE OR REPLACE FUNCTION pode_aprovar_cenario() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT eh_admin() OR coalesce(
    (SELECT f.permitido FROM user_acesso_funcao f
      WHERE f.user_id = auth.uid() AND f.capacidade = 'cenario.aprovar' LIMIT 1),
    false)   -- sem override: só admin. Espelha o padrão de lib/capacidades.ts.
$$;
REVOKE ALL ON FUNCTION pode_aprovar_cenario() FROM public;
GRANT EXECUTE ON FUNCTION pode_aprovar_cenario() TO authenticated;

-- Carimbar e descarimbar passam por aqui: a tela só chama, quem decide é o banco.
CREATE OR REPLACE FUNCTION aprovar_cenario(p_versao uuid, p_nota text DEFAULT NULL)
RETURNS TABLE(aprovado_em timestamptz, aprovado_por uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT pode_aprovar_cenario() THEN
    RAISE EXCEPTION 'Você não tem permissão para aprovar cenário.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  UPDATE versao_orcamento v
     SET aprovado_em = now(), aprovado_por = auth.uid(), aprovacao_nota = p_nota
   WHERE v.id = p_versao AND v.tenant_id = current_tenant_id()
  RETURNING v.aprovado_em, v.aprovado_por;
END $$;
REVOKE ALL ON FUNCTION aprovar_cenario(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION aprovar_cenario(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION reprovar_cenario(p_versao uuid, p_nota text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT pode_aprovar_cenario() THEN
    RAISE EXCEPTION 'Você não tem permissão para reprovar cenário.' USING ERRCODE = '42501';
  END IF;
  UPDATE versao_orcamento
     SET aprovado_em = NULL, aprovado_por = NULL, aprovacao_nota = p_nota
   WHERE id = p_versao AND tenant_id = current_tenant_id();
END $$;
REVOKE ALL ON FUNCTION reprovar_cenario(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION reprovar_cenario(uuid, text) TO authenticated;

-- ── o gatilho que derruba o carimbo ──────────────────────────
CREATE OR REPLACE FUNCTION cenario_alterado_derruba_aprovacao() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v uuid := coalesce(NEW.versao_id, OLD.versao_id);
BEGIN
  -- Só escreve se havia carimbo: num lote de 50 decisões isto vira UMA escrita.
  UPDATE versao_orcamento
     SET aprovado_em = NULL, aprovado_por = NULL,
         aprovacao_nota = coalesce(aprovacao_nota || ' ', '')
                        || '[aprovação derrubada por alteração no cenário em '
                        || to_char(now(), 'DD/MM/YYYY HH24:MI') || ']'
   WHERE id = v AND aprovado_em IS NOT NULL;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_cenario_derruba_aprovacao ON posto_versao;
CREATE TRIGGER trg_cenario_derruba_aprovacao
  AFTER INSERT OR UPDATE OR DELETE ON posto_versao
  FOR EACH ROW EXECUTE FUNCTION cenario_alterado_derruba_aprovacao();

SELECT 'colunas de aprovação' AS secao,
       (SELECT string_agg(column_name, ', ' ORDER BY column_name)
          FROM information_schema.columns WHERE table_name='versao_orcamento'
           AND column_name LIKE 'aprova%') AS resultado
UNION ALL SELECT 'gatilho que derruba o carimbo',
  CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_cenario_derruba_aprovacao')
       THEN 'criado' ELSE '⛔ não' END
UNION ALL SELECT 'funções de aprovação',
  (SELECT string_agg(proname, ', ' ORDER BY proname) FROM pg_proc
    WHERE proname IN ('pode_aprovar_cenario','aprovar_cenario','reprovar_cenario'))
UNION ALL SELECT '⛔ alguma executável por anon (esperado: nenhuma)',
  (SELECT coalesce(string_agg(proname, ', '), 'nenhuma') FROM pg_proc p
    WHERE p.proname IN ('pode_aprovar_cenario','aprovar_cenario','reprovar_cenario')
      AND has_function_privilege('anon', p.oid, 'EXECUTE'))
UNION ALL SELECT 'versões aprovadas hoje (esperado: 0)',
  (SELECT count(*)::text FROM versao_orcamento WHERE aprovado_em IS NOT NULL);
