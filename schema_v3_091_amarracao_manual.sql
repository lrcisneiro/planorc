-- ============================================================
-- 091 — Amarração manual do terceiro: o apelido
--
-- O de-para do ERP não cobre tudo e nunca vai cobrir. "SERVICOS PRESTADOS INC CP
-- RBKS TECNOLOGI" não casa com ninguém porque RBKS é o nome da empresa do
-- prestador, não o dele — quem sabe que RBKS é o Kairof é o gestor, não o
-- Protheus. Achar isso na conferência e não poder gravar significa reencontrar
-- o mesmo lançamento todo mês.
--
-- APELIDO: um texto extra que aponta para a mesma pessoa. Fica em coluna
-- própria, separado dos campos que vêm do ERP (nome_fantasia, nome_sra,
-- RD0_NOME), para que a reimportação do de-para não o sobrescreva nem o
-- apague. E é procurado nos DOIS caminhos do casamento — com participante no
-- histórico e sem — porque o texto que ficou órfão tanto pode estar de um lado
-- do traço quanto do outro.
--
-- ORIGEM: 'ERP' para o que veio do export, 'MANUAL' para o que o gestor
-- amarrou. O import em "substituir tudo" passa a apagar só o que é ERP — sem
-- isso, a primeira reimportação levaria embora todo o trabalho de conferência,
-- e em silêncio.
-- ============================================================

ALTER TABLE posto_fornecedor ADD COLUMN IF NOT EXISTS apelido text;
ALTER TABLE posto_fornecedor ADD COLUMN IF NOT EXISTS apelido_norm text
  GENERATED ALWAYS AS (planorc_norm_txt(apelido)) STORED;
ALTER TABLE posto_fornecedor ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'ERP'
  CHECK (origem IN ('ERP', 'MANUAL'));
ALTER TABLE posto_fornecedor ADD COLUMN IF NOT EXISTS criado_por uuid;

CREATE INDEX IF NOT EXISTS ix_posto_fornecedor_apelido ON posto_fornecedor (tenant_id, apelido_norm);

-- o fornecedor deixa de ser obrigatório: a amarração manual costuma ser
-- "este texto é esta pessoa", sem que se saiba (ou importe) o código do SA2
ALTER TABLE posto_fornecedor ALTER COLUMN fornecedor_cod SET DEFAULT '';
UPDATE posto_fornecedor SET fornecedor_cod = '' WHERE fornecedor_cod IS NULL;

-- ── Casamento de UM histórico, agora com o apelido ──
-- Ordem inalterada no resto: havendo participante depois do "-", é ele quem
-- decide e o fornecedor nem é consultado (senão a cooperativa engole todo
-- mundo). O apelido entra ANTES dos campos do ERP nos dois caminhos: foi posto
-- à mão justamente porque o que veio do ERP não resolvia.
DROP FUNCTION IF EXISTS planorc_pj_casa(text);

CREATE FUNCTION planorc_pj_casa(p_hist text)
RETURNS TABLE (
  mat_folha text, filial_cod text, matricula text, nome text,
  fornecedor_cod text, fornecedor_loja text, nome_fantasia text, status text
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  f text[]; v_par text; v_frag text; v_alvo text; n int; v_amb boolean := false;
  v_tem_participante boolean;
BEGIN
  f := planorc_pj_frag(p_hist);
  v_tem_participante := length(coalesce(f[2], '')) >= 5;
  -- 'a' = apelido (manual), 's' = nome do SRA, 'n' = nome do RD0, 'f' = fantasia
  FOREACH v_par IN ARRAY CASE WHEN v_tem_participante
                              THEN ARRAY['2a', '2s', '2n']
                              ELSE ARRAY['1a', '1f', '1s', '1n'] END LOOP
    v_frag := f[substr(v_par, 1, 1)::int];
    v_alvo := substr(v_par, 2, 1);
    CONTINUE WHEN v_frag IS NULL OR length(v_frag) < 5;
    -- unicidade da PESSOA, não do fornecedor: numa cooperativa os cooperados
    -- dividem o mesmo fornecedor, e contar fornecedor daria "1" com dois candidatos
    SELECT count(DISTINCT pf.empresa_cod || '|' || pf.filial_cod || '|' || pf.matricula_folha) INTO n
      FROM posto_fornecedor pf
     WHERE pf.tenant_id = current_tenant_id() AND pf.ativo
       AND ((v_alvo = 'a' AND pf.apelido_norm  <> '' AND (pf.apelido_norm  LIKE v_frag || '%' OR v_frag LIKE pf.apelido_norm || '%'))
         OR (v_alvo = 'f' AND pf.fant_norm     <> '' AND (pf.fant_norm     LIKE v_frag || '%' OR v_frag LIKE pf.fant_norm || '%'))
         OR (v_alvo = 's' AND pf.nome_sra_norm <> '' AND (pf.nome_sra_norm LIKE v_frag || '%' OR v_frag LIKE pf.nome_sra_norm || '%'))
         OR (v_alvo = 'n' AND pf.nome_norm     <> '' AND (pf.nome_norm     LIKE v_frag || '%' OR v_frag LIKE pf.nome_norm || '%')));
    IF n = 1 THEN
      SELECT pf.matricula_folha, pf.filial_cod, pf.matricula,
             coalesce(nullif(pf.nome_sra, ''), pf.nome), pf.fornecedor_cod, pf.fornecedor_loja,
             coalesce(nullif(pf.nome_fantasia, ''), pf.apelido), 'CASADO'
        INTO mat_folha, filial_cod, matricula, nome, fornecedor_cod, fornecedor_loja, nome_fantasia, status
        FROM posto_fornecedor pf
       WHERE pf.tenant_id = current_tenant_id() AND pf.ativo
         AND ((v_alvo = 'a' AND pf.apelido_norm  <> '' AND (pf.apelido_norm  LIKE v_frag || '%' OR v_frag LIKE pf.apelido_norm || '%'))
           OR (v_alvo = 'f' AND pf.fant_norm     <> '' AND (pf.fant_norm     LIKE v_frag || '%' OR v_frag LIKE pf.fant_norm || '%'))
           OR (v_alvo = 's' AND pf.nome_sra_norm <> '' AND (pf.nome_sra_norm LIKE v_frag || '%' OR v_frag LIKE pf.nome_sra_norm || '%'))
           OR (v_alvo = 'n' AND pf.nome_norm     <> '' AND (pf.nome_norm     LIKE v_frag || '%' OR v_frag LIKE pf.nome_norm || '%')))
       LIMIT 1;
      RETURN NEXT; RETURN;
    ELSIF n > 1 THEN
      v_amb := true;
    END IF;
  END LOOP;
  mat_folha := NULL; filial_cod := NULL; matricula := NULL; nome := NULL;
  fornecedor_cod := NULL; fornecedor_loja := NULL;
  -- o texto devolvido é o que se procura no ERP, e é o que a tela grava como
  -- apelido quando o gestor diz de quem é
  nome_fantasia := CASE WHEN v_tem_participante THEN f[2] ELSE coalesce(f[1], '') END;
  status := CASE WHEN v_amb THEN 'AMBIGUO' ELSE 'SEM_DEPARA' END;
  RETURN NEXT;
END $$;

-- ── Quem a tela oferece na hora de amarrar ──
-- As pessoas da folha da competência, para o gestor escolher de quem é o texto
-- órfão. Sai daqui e não de um select solto porque precisa do código da filial
-- (a chave é filial + matrícula, nunca a matrícula sozinha: a 900000 é três
-- pessoas diferentes).
CREATE OR REPLACE FUNCTION conciliacao_pessoas_folha(
  p_ano int, p_mes int,
  p_empresas uuid[] DEFAULT NULL, p_filiais uuid[] DEFAULT NULL, p_ccs uuid[] DEFAULT NULL
) RETURNS TABLE (
  filial_id uuid, filial_cod text, empresa_cod text, matricula text, nome text, valor numeric
)
LANGUAGE sql STABLE SET statement_timeout = '60s'
AS $$
  SELECT ff.filial_id, max(fl.codigo), max(e.codigo), ff.matricula, max(ff.nome),
         sum(ff.valor)::numeric
    FROM fat_folha ff
    LEFT JOIN filial  fl ON fl.id = ff.filial_id
    LEFT JOIN empresa e  ON e.id  = ff.empresa_id
   WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
     AND ff.ano = p_ano AND ff.mes = p_mes AND coalesce(ff.matricula, '') <> ''
     AND (p_empresas IS NULL OR ff.empresa_id = ANY(p_empresas))
     AND (p_filiais  IS NULL OR ff.filial_id  = ANY(p_filiais))
     AND (p_ccs      IS NULL OR ff.cc_id      = ANY(p_ccs))
   GROUP BY ff.filial_id, ff.matricula
   ORDER BY 6 DESC;
$$;

-- ── Uma linha por PESSOA, não por caminho de casamento ──
-- O teste da amarração manual expôs um erro que já existia: a nf agrupava por
-- (status, via, filial, matrícula, fornecedor). Quem tinha nota chegando por
-- DOIS caminhos — dois fornecedores, ou o de-para e o nome — virava duas linhas,
-- e o FULL JOIN com a folha casava as duas com a MESMA folha. O valor da pessoa
-- aparecia dobrado no total.
--
-- Foi o apelido que revelou: ao amarrar "RBKS TECNOLOGI" ao Otávio, ele passou a
-- casar também pelo próprio nome, e a folha de R$ 35.551,48 contou duas vezes.
-- O bug não é do apelido — ele só tornou comum o que antes era raro.
--
-- Agora o grão é a pessoa. via e fornecedor viram agregados: min(via) porque
-- 'DEPARA' vem antes de 'NOME' e é a procedência mais forte das duas.
CREATE OR REPLACE FUNCTION conciliacao_terceiros(
  p_ano int, p_mes int, p_relatorio_id uuid,
  p_empresas uuid[] DEFAULT NULL, p_filiais uuid[] DEFAULT NULL, p_ccs uuid[] DEFAULT NULL
) RETURNS TABLE (
  status text, via text, filial_id uuid, matricula text, nome text,
  fornecedor_cod text, nome_fantasia text, cc_cod text,
  lancamentos bigint, razao numeric, folha numeric
)
LANGUAGE sql STABLE SET statement_timeout = '90s'
AS $$
  WITH contas_clt AS MATERIALIZED (SELECT conta_id FROM planorc_concil_contas_clt(p_ano, p_mes)),
  atr AS MATERIALIZED (SELECT * FROM planorc_pj_atribui(p_ano, p_mes, p_relatorio_id, p_empresas, p_filiais, p_ccs)),
  nf AS (
    SELECT a.status, min(a.via) AS via, a.filial_id, a.matricula,
           max(a.fornecedor_cod) AS fornecedor_cod,
           max(a.nome) AS nome, max(a.nome_fantasia) AS nome_fantasia,
           CASE WHEN count(DISTINCT cc.codigo) = 1 THEN max(cc.codigo) END AS cc_cod,
           count(*)::bigint AS lancamentos, sum(a.valor)::numeric AS razao
      FROM atr a LEFT JOIN centro_custo cc ON cc.id = a.cc_id
     -- casado agrupa por PESSOA; o resto, pelo texto que não casou (e nele
     -- filial e matrícula são nulas, então não partem o grupo)
     GROUP BY a.status, a.filial_id, a.matricula,
              CASE WHEN a.status = 'CASADO' THEN '' ELSE coalesce(a.nome_fantasia, '') END
  ),
  fol AS (
    SELECT ff.filial_id, ff.matricula, max(ff.nome) AS nome,
           CASE WHEN count(DISTINCT cc.codigo) = 1 THEN max(cc.codigo) END AS cc_cod,
           sum(ff.valor)::numeric AS folha
      FROM fat_folha ff LEFT JOIN centro_custo cc ON cc.id = ff.cc_id
     WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
       AND ff.ano = p_ano AND ff.mes = p_mes AND ff.conta_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM conta_contabil cc
                    WHERE cc.id = ff.conta_id AND cc.natureza IN ('RECEITA', 'DESPESA'))
       AND ff.conta_id NOT IN (SELECT conta_id FROM contas_clt)
       AND (p_empresas IS NULL OR ff.empresa_id = ANY(p_empresas))
       AND (p_filiais  IS NULL OR ff.filial_id  = ANY(p_filiais))
       AND (p_ccs      IS NULL OR ff.cc_id      = ANY(p_ccs))
     GROUP BY 1, 2
  )
  SELECT CASE WHEN n.status IS NULL                            THEN 'SEM_NF'
              WHEN n.status = 'CASADO' AND f.matricula IS NULL THEN 'SEM_FOLHA'
              ELSE n.status END,
         n.via,
         coalesce(n.filial_id, f.filial_id), coalesce(n.matricula, f.matricula),
         coalesce(n.nome, f.nome), n.fornecedor_cod, n.nome_fantasia,
         coalesce(n.cc_cod, f.cc_cod), coalesce(n.lancamentos, 0),
         coalesce(n.razao, 0)::numeric, coalesce(f.folha, 0)::numeric
    FROM nf n
    FULL JOIN fol f ON n.status = 'CASADO'
                   AND f.matricula = n.matricula
                   AND f.filial_id IS NOT DISTINCT FROM n.filial_id
   ORDER BY 1, greatest(abs(coalesce(n.razao, 0)), abs(coalesce(f.folha, 0))) DESC;
$$;
