-- ============================================================
-- v3_152 — A situação vem da FOLHA, não de dedução
--
-- Eu estava deduzindo "afastado" da janela `afast_ini`/`afast_fim` do posto.
-- Funciona para afastamento, e só: **férias** não dá para deduzir de lugar
-- nenhum, e era por isso que pessoa afastada aparecia como ativa.
--
-- O dado existe na origem: a *Relação de Funcionários* traz "Situação da folha
-- do funcionário" com o código de UMA letra do Protheus (`RA_SITFOLH`) —
-- `D` demitido, `A` afastado, `F` férias, vazio/N/A trabalhando. Essa coluna
-- estava no arquivo que já importamos e eu a descartei.
--
-- Guardar no POSTO e não na pessoa: a situação é por VÍNCULO. A relação traz
-- uma linha por (empresa, filial, matrícula), e alguém pode estar demitido numa
-- empresa do grupo e ativo em outra — foi o que o próprio arquivo mostrou.
--
-- A dedução por data continua, como RESERVA: posto que nunca casou com a
-- relação (o Dijan) ou criado à mão não tem `sit_folha`, e aí a janela de
-- afastamento ainda responde. Fonte quando há; dedução quando não há.
--
-- ⚠ Coluna nova em `posto` tem DUAS pontas (v3_147/148): entra em `posto_v`
-- **no fim** (para o REPLACE manter os GRANTs) e ganha `GRANT SELECT` próprio.
--
-- Termina em SELECT.
-- ============================================================

ALTER TABLE posto ADD COLUMN IF NOT EXISTS sit_folha text;
GRANT SELECT (sit_folha) ON posto TO authenticated;

CREATE OR REPLACE VIEW posto_v AS
SELECT p.id, p.tenant_id, p.codigo, p.cargo_id, p.empresa_id, p.filial_id, p.cc_id,
       p.sindicato_id, p.funcionario_id,
       CASE WHEN (SELECT pode_ver_folha()) THEN p.salario_base   END AS salario_base,
       p.ini_ano, p.ini_mes, p.fim_ano, p.fim_mes, p.fte, p.obs, p.ativo, p.regime,
       p.nome, p.matricula, p.recurso_cod, p.recebe_hora, p.reajuste_mes,
       CASE WHEN (SELECT pode_ver_folha()) THEN p.reajuste_pct   END AS reajuste_pct,
       CASE WHEN (SELECT pode_ver_folha()) THEN p.reajuste_valor END AS reajuste_valor,
       p.afast_ini_ano, p.afast_ini_mes, p.afast_fim_ano, p.afast_fim_mes,
       p.afast_motivo, p.admissao,
       p.area_func_id,  -- v3_147
       p.sit_folha      -- v3_152: no FIM, para o REPLACE manter os GRANTs
  FROM posto p
 WHERE p.tenant_id = (SELECT current_tenant_id())
   AND ((SELECT escopo_empresa()) IS NULL
        OR (p.empresa_id IS NOT NULL AND p.empresa_id = ANY((SELECT escopo_empresa())::uuid[])))
   AND ((SELECT escopo_filial()) IS NULL
        OR (p.filial_id IS NOT NULL AND p.filial_id = ANY((SELECT escopo_filial())::uuid[])))
   AND ((SELECT escopo_cc()) IS NULL
        OR (p.cc_id IS NOT NULL AND p.cc_id = ANY((SELECT escopo_cc())::uuid[])));

-- A importação passa a carimbar a situação junto com a identidade. Mesma
-- função, mesma prévia: `p_simular` continua não gravando nada.
CREATE OR REPLACE FUNCTION importar_funcionarios(p_linhas jsonb, p_simular boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid := current_tenant_id();
  v_pessoas int; v_novas int; v_chave int; v_nome int; v_sem int; v_sobra jsonb; v_sit jsonb;
BEGIN
  IF NOT eh_admin() THEN
    RAISE EXCEPTION 'Só administrador importa a relação de funcionários.';
  END IF;

  CREATE TEMP TABLE _imp ON COMMIT DROP AS
  SELECT regexp_replace(x->>'cpf', '\D', '', 'g')                 AS cpf,
         upper(regexp_replace(trim(x->>'nome'), '\s+', ' ', 'g'))  AS nome,
         trim(x->>'filial_cod')                                    AS filial_cod,
         trim(x->>'matricula')                                     AS matricula,
         -- uma letra, maiúscula; 'N/A' e vazio viram NULL = trabalhando
         nullif(upper(left(trim(coalesce(x->>'situacao','')), 1)), '') AS sit
    FROM jsonb_array_elements(p_linhas) x;

  DELETE FROM _imp WHERE length(cpf) <> 11 OR nome = '';
  UPDATE _imp SET sit = NULL WHERE sit NOT IN ('D','A','F');

  CREATE TEMP TABLE _pessoa ON COMMIT DROP AS
  SELECT DISTINCT ON (cpf) cpf, nome FROM _imp ORDER BY cpf, nome;
  SELECT count(*) INTO v_pessoas FROM _pessoa;

  SELECT count(*) INTO v_novas
    FROM _pessoa p WHERE NOT EXISTS (
      SELECT 1 FROM funcionario f WHERE f.tenant_id = v_tenant AND f.cpf = p.cpf);

  CREATE TEMP TABLE _alvo ON COMMIT DROP AS
  SELECT p.id AS posto_id, d.cpf, max(d.sit) AS sit, 'chave'::text AS via
    FROM posto p
    JOIN filial f ON f.id = p.filial_id
    JOIN _imp  d ON d.filial_cod = f.codigo AND d.matricula = trim(p.matricula)
   WHERE p.tenant_id = v_tenant
   GROUP BY p.id, d.cpf;

  INSERT INTO _alvo
  SELECT p.id, u.cpf, NULL, 'nome'
    FROM posto p
    JOIN (SELECT nome, min(cpf) AS cpf FROM _pessoa GROUP BY nome HAVING count(*) = 1) u
      ON u.nome = upper(regexp_replace(trim(p.nome), '\s+', ' ', 'g'))
   WHERE p.tenant_id = v_tenant
     AND nullif(trim(p.nome), '') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM _alvo a WHERE a.posto_id = p.id);

  SELECT count(*) FILTER (WHERE via = 'chave'), count(*) FILTER (WHERE via = 'nome')
    INTO v_chave, v_nome FROM _alvo;

  SELECT jsonb_object_agg(coalesce(sit, 'trabalhando'), n) INTO v_sit
    FROM (SELECT sit, count(*) AS n FROM _alvo GROUP BY sit) t;

  SELECT count(*), jsonb_agg(jsonb_build_object('posto', codigo, 'nome', nome) ORDER BY nome)
    INTO v_sem, v_sobra
    FROM posto p
   WHERE p.tenant_id = v_tenant AND p.ativo IS NOT FALSE
     AND nullif(trim(p.nome), '') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM _alvo a WHERE a.posto_id = p.id);

  IF NOT p_simular THEN
    INSERT INTO funcionario (tenant_id, cpf, nome, ativo)
    SELECT v_tenant, cpf, nome, true FROM _pessoa
    ON CONFLICT (tenant_id, cpf) DO UPDATE SET nome = EXCLUDED.nome;

    UPDATE posto p SET funcionario_id = f.id, sit_folha = a.sit
      FROM _alvo a JOIN funcionario f ON f.cpf = a.cpf AND f.tenant_id = v_tenant
     WHERE p.id = a.posto_id;
  END IF;

  RETURN jsonb_build_object(
    'simulado',        p_simular,
    'linhas',          (SELECT count(*) FROM _imp),
    'pessoas',         v_pessoas,
    'pessoas_novas',   v_novas,
    'postos_chave',    v_chave,
    'postos_nome',     v_nome,
    'postos_sem',      v_sem,
    'situacoes',       coalesce(v_sit, '{}'::jsonb),
    'sem_detalhe',     coalesce(v_sobra, '[]'::jsonb));
END $$;

SELECT 'sit_folha em posto_v' AS secao,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_name='posto_v' AND column_name='sit_folha')
            THEN 'sim' ELSE '⛔ não' END AS resultado
UNION ALL
SELECT 'colunas de posto sem SELECT (esperado: as 3 de remuneração)',
       coalesce(string_agg(c.column_name, ', ' ORDER BY c.column_name), '⛔ nenhuma')
  FROM information_schema.columns c
 WHERE c.table_schema='public' AND c.table_name='posto'
   AND NOT EXISTS (SELECT 1 FROM information_schema.column_privileges g
                    WHERE g.table_name='posto' AND g.column_name=c.column_name
                      AND g.grantee='authenticated' AND g.privilege_type='SELECT');
