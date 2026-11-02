-- ============================================================
-- v3_149 — CPF como identidade da pessoa, e o importador como padrão
--
-- POR QUE: o headcount errava nos DOIS sentidos. `matricula` é reusada entre
-- filiais — a `900008` pertence a 7 CPFs diferentes — então contar matrícula
-- distinta FUNDIA pessoas (a grade mostrava 181 onde há 304). E quem tem
-- pró-labore em várias empresas tem várias matrículas, então também
-- MULTIPLICAVA (2 diretores virando 7 no CC 411). Só o CPF resolve os dois.
--
-- ⚠ ESTA MIGRATION NÃO CONTÉM NENHUM CPF. Só o esquema e a função. O dado entra
-- pela tela (Cadastros → Funcionários → Importar), lido no navegador e enviado
-- direto ao banco. Gerar um .sql com 513 CPFs o colocaria no git, isto é, num
-- histórico público e permanente — foi o caminho que eu ia tomar e que o
-- classificador barrou, com razão.
--
-- ⚠ CPF é DADO PESSOAL: a coluna nasce com `SELECT` revogado para
-- `authenticated`. Serve de CHAVE, não de informação de tela — nenhuma tela lê.
-- Se um dia precisar aparecer, o caminho é view mascarada como `posto_v`.
--
-- O CASAMENTO, em duas passadas e no servidor:
--   1ª por (filial, matrícula) — único par que identifica; a matrícula sozinha
--      não serve. `filial.codigo` = código da empresa + da filial, com zero à
--      esquerda ("20"+"01" = "2001"), que é o formato desta instalação.
--   2ª por NOME, só nos que sobraram — a série 8000xx é pró-labore e não existe
--      no export do RH, embora a pessoa exista. Restrita a nome que aponta para
--      UM único CPF: homônimo fica de fora, porque errar identidade é pior que
--      deixar em branco.
--
-- `p_simular` faz a mesma conta sem gravar: a tela mostra o que vai acontecer
-- antes de acontecer. Importação que não tem prévia é importação que se
-- descobre pelo estrago.
--
-- ⚠ A regra de montar `filial.codigo` é desta instalação do Protheus. Quando
-- entrar outro ERP, ela vira perfil — por isso chega pronta do cliente, em
-- `filial_cod`, em vez de ser remontada aqui.
--
-- Termina em SELECT.
-- ============================================================

ALTER TABLE funcionario ADD COLUMN IF NOT EXISTS cpf text;

DO $$ BEGIN
  ALTER TABLE funcionario ADD CONSTRAINT funcionario_cpf_uq UNIQUE (tenant_id, cpf);
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; END $$;

REVOKE SELECT (cpf) ON funcionario FROM authenticated;

CREATE OR REPLACE FUNCTION importar_funcionarios(p_linhas jsonb, p_simular boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid := current_tenant_id();
  v_pessoas int; v_novas int; v_chave int; v_nome int; v_sem int; v_sobra jsonb;
BEGIN
  -- Importar identidade de pessoa é ação de administração, não de operação.
  IF NOT eh_admin() THEN
    RAISE EXCEPTION 'Só administrador importa a relação de funcionários.';
  END IF;

  CREATE TEMP TABLE _imp ON COMMIT DROP AS
  SELECT regexp_replace(x->>'cpf', '\D', '', 'g')              AS cpf,
         upper(regexp_replace(trim(x->>'nome'), '\s+', ' ', 'g')) AS nome,
         trim(x->>'filial_cod')                                 AS filial_cod,
         trim(x->>'matricula')                                  AS matricula
    FROM jsonb_array_elements(p_linhas) x;

  DELETE FROM _imp WHERE length(cpf) <> 11 OR nome = '';

  -- Uma linha por pessoa. O nome usado é o da primeira ocorrência do CPF.
  CREATE TEMP TABLE _pessoa ON COMMIT DROP AS
  SELECT DISTINCT ON (cpf) cpf, nome FROM _imp ORDER BY cpf, nome;
  SELECT count(*) INTO v_pessoas FROM _pessoa;

  SELECT count(*) INTO v_novas
    FROM _pessoa p WHERE NOT EXISTS (
      SELECT 1 FROM funcionario f WHERE f.tenant_id = v_tenant AND f.cpf = p.cpf);

  -- Quem o de-para alcança, por chave e por nome. Calculado ANTES de gravar,
  -- para que a prévia e a execução respondam o mesmo.
  CREATE TEMP TABLE _alvo ON COMMIT DROP AS
  SELECT p.id AS posto_id, d.cpf, 'chave'::text AS via
    FROM posto p
    JOIN filial f ON f.id = p.filial_id
    JOIN _imp  d ON d.filial_cod = f.codigo AND d.matricula = trim(p.matricula)
   WHERE p.tenant_id = v_tenant
   GROUP BY p.id, d.cpf;

  -- 2ª passada: nome que aponta para um CPF só, e posto que a 1ª não alcançou.
  INSERT INTO _alvo
  SELECT p.id, u.cpf, 'nome'
    FROM posto p
    JOIN (SELECT nome, min(cpf) AS cpf FROM _pessoa GROUP BY nome HAVING count(*) = 1) u
      ON u.nome = upper(regexp_replace(trim(p.nome), '\s+', ' ', 'g'))
   WHERE p.tenant_id = v_tenant
     AND nullif(trim(p.nome), '') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM _alvo a WHERE a.posto_id = p.id);

  SELECT count(*) FILTER (WHERE via = 'chave'), count(*) FILTER (WHERE via = 'nome')
    INTO v_chave, v_nome FROM _alvo;

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

    UPDATE posto p SET funcionario_id = f.id
      FROM _alvo a JOIN funcionario f ON f.cpf = a.cpf AND f.tenant_id = v_tenant
     WHERE p.id = a.posto_id AND p.funcionario_id IS DISTINCT FROM f.id;
  END IF;

  RETURN jsonb_build_object(
    'simulado',        p_simular,
    'linhas',          (SELECT count(*) FROM _imp),
    'pessoas',         v_pessoas,
    'pessoas_novas',   v_novas,
    'postos_chave',    v_chave,
    'postos_nome',     v_nome,
    'postos_sem',      v_sem,
    'sem_detalhe',     coalesce(v_sobra, '[]'::jsonb));
END $$;

REVOKE ALL ON FUNCTION importar_funcionarios(jsonb, boolean) FROM public;
GRANT EXECUTE ON FUNCTION importar_funcionarios(jsonb, boolean) TO authenticated;

SELECT 'coluna cpf' AS secao,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_name='funcionario' AND column_name='cpf')
            THEN 'criada' ELSE '⛔ não' END AS resultado
UNION ALL
SELECT 'cpf legível por authenticated?',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.column_privileges
                          WHERE table_name='funcionario' AND column_name='cpf'
                            AND grantee='authenticated' AND privilege_type='SELECT')
            THEN '⛔ sim — revogar' ELSE 'não (correto)' END
UNION ALL
SELECT 'função importar_funcionarios',
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname='importar_funcionarios')
            THEN 'criada' ELSE '⛔ não' END;
