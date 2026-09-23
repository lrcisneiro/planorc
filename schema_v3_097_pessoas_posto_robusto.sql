-- ============================================================
-- 097 — A pessoa do posto: usar as colunas certas e não sumir por filtro
--
-- A v3_096 trouxe o posto para a lista de amarração, e mesmo assim o Kairof não
-- apareceu. Três motivos, e os três são meus:
--
-- 1. Eu quebrava o CÓDIGO do posto ('2001-800001') para achar a matrícula. Mas
--    posto tem colunas nome e matricula próprias, que é o que a tela de Postos
--    preenche. E quando o posto é uma VAGA o código é '2001-VG01' — o pedaço
--    depois do traço não é matrícula nenhuma, e virava uma pessoa fantasma.
--
-- 2. O filtro de escopo derrubava posto SEM centro de custo. Com um filtro de CC
--    ativo (o caso normal: conferindo uma unidade), p.cc_id = ANY(...) com
--    cc_id nulo dá NULL, e a linha some. Posto recém-criado costuma estar
--    justamente assim, sem CC ainda.
--
-- 3. Vaga sem matrícula não pode ser alvo de amarração — a chave do de-para é
--    filial + matrícula. Ela sai da lista, mas por regra explícita e não por
--    acidente de string.
--
-- O padrão dos três é o mesmo que venho repetindo: o dado não estava errado, o
-- recorte é que o excluía em silêncio.
-- ============================================================

DROP FUNCTION IF EXISTS conciliacao_pessoas_folha(int, int, uuid[], uuid[], uuid[]);

CREATE FUNCTION conciliacao_pessoas_folha(
  p_ano int, p_mes int,
  p_empresas uuid[] DEFAULT NULL, p_filiais uuid[] DEFAULT NULL, p_ccs uuid[] DEFAULT NULL
) RETURNS TABLE (
  filial_id uuid, filial_cod text, empresa_cod text, matricula text, nome text,
  origem text, valor numeric
)
LANGUAGE sql STABLE SET statement_timeout = '60s'
AS $$
  WITH da_folha AS (
    SELECT ff.filial_id, max(fl.codigo) AS filial_cod, max(e.codigo) AS empresa_cod,
           ff.matricula, max(ff.nome) AS nome, sum(ff.valor)::numeric AS valor
      FROM fat_folha ff
      LEFT JOIN filial  fl ON fl.id = ff.filial_id
      LEFT JOIN empresa e  ON e.id  = ff.empresa_id
     WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
       AND ff.ano = p_ano AND ff.mes = p_mes AND coalesce(ff.matricula, '') <> ''
       AND (p_empresas IS NULL OR ff.empresa_id = ANY(p_empresas))
       AND (p_filiais  IS NULL OR ff.filial_id  = ANY(p_filiais))
       AND (p_ccs      IS NULL OR ff.cc_id      = ANY(p_ccs))
     GROUP BY ff.filial_id, ff.matricula
  ),
  do_posto AS (
    SELECT p.filial_id, max(fl.codigo) AS filial_cod, max(e.codigo) AS empresa_cod,
           btrim(p.matricula) AS matricula,
           max(coalesce(nullif(btrim(p.nome), ''), f.nome, p.codigo)) AS nome
      FROM posto p
      LEFT JOIN filial      fl ON fl.id = p.filial_id
      LEFT JOIN empresa     e  ON e.id  = p.empresa_id
      LEFT JOIN funcionario f  ON f.id  = p.funcionario_id
     WHERE p.tenant_id = current_tenant_id() AND p.ativo
       -- vaga não tem matrícula e não pode ser alvo de amarração: a chave do
       -- de-para é filial + matrícula
       AND coalesce(btrim(p.matricula), '') <> ''
       AND (p.ini_ano IS NULL OR (p_ano * 100 + p_mes) >= (p.ini_ano * 100 + coalesce(p.ini_mes, 1)))
       AND (p.fim_ano IS NULL OR (p_ano * 100 + p_mes) <= (p.fim_ano * 100 + coalesce(p.fim_mes, 12)))
       -- o "IS NULL OR" no lado do posto é de propósito: posto recém-criado
       -- costuma não ter CC nem filial ainda, e some justamente quando se está
       -- conferindo uma unidade — que é quando a busca é usada
       AND (p_empresas IS NULL OR p.empresa_id = ANY(p_empresas) OR p.empresa_id IS NULL)
       AND (p_filiais  IS NULL OR p.filial_id  = ANY(p_filiais)  OR p.filial_id  IS NULL)
       AND (p_ccs      IS NULL OR p.cc_id      = ANY(p_ccs)      OR p.cc_id      IS NULL)
     GROUP BY p.filial_id, btrim(p.matricula)
  )
  SELECT coalesce(f.filial_id, p.filial_id),
         coalesce(f.filial_cod, p.filial_cod),
         coalesce(f.empresa_cod, p.empresa_cod),
         coalesce(f.matricula, p.matricula),
         coalesce(f.nome, p.nome),
         CASE WHEN f.matricula IS NULL THEN 'POSTO' ELSE 'FOLHA' END,
         coalesce(f.valor, 0)::numeric
    FROM da_folha f
    FULL JOIN do_posto p ON p.matricula = f.matricula
                        AND p.filial_id IS NOT DISTINCT FROM f.filial_id
   ORDER BY 7 DESC, 5;
$$;
