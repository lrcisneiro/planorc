-- ============================================================
-- 096 — A lista de amarração passa a incluir quem só existe como POSTO
--
-- Ricardo, olhando a busca de "de quem é este histórico": "você pega
-- provavelmente da folha a lista, mas não do posto, correto? Pois o Kairof foi
-- uma pessoa que incluí no posto e não aparece nesta lista."
--
-- Exato, e o caso é comum justamente quando mais importa: prestador novo, sócio
-- cuja folha vem no arquivo confidencial ainda não importado, matrícula criada
-- à mão para um contrato que o ERP ainda não tem. Em todos eles a pessoa existe
-- como POSTO — foi orçada — mas não tem uma linha de folha na competência.
-- Oferecer só quem tem folha é oferecer só quem já está conciliado.
--
-- A lista passa a ser a união dos dois, com a origem visível: a folha manda
-- quando a pessoa está nos dois lados (traz o valor do mês), e o posto entra
-- sozinho quando ela ainda não apareceu na folha.
--
-- A chave continua sendo filial + matrícula. No posto ela vem do código
-- ('2001-900004'), que é como o import de postos o monta.
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
    -- matrícula do código do posto ('2001-900004'); o nome vem do funcionário
    -- quando há um, senão é vaga e o código serve de rótulo
    SELECT p.filial_id, max(fl.codigo) AS filial_cod, max(e.codigo) AS empresa_cod,
           btrim(split_part(p.codigo, '-', 2)) AS matricula,
           max(coalesce(f.nome, p.codigo)) AS nome
      FROM posto p
      LEFT JOIN filial      fl ON fl.id = p.filial_id
      LEFT JOIN empresa     e  ON e.id  = p.empresa_id
      LEFT JOIN funcionario f  ON f.id  = p.funcionario_id
     WHERE p.tenant_id = current_tenant_id() AND p.ativo
       AND btrim(split_part(p.codigo, '-', 2)) <> ''
       -- vigência: posto que ainda não começou ou já terminou não entra
       AND (p.ini_ano IS NULL OR (p_ano * 100 + p_mes) >= (p.ini_ano * 100 + coalesce(p.ini_mes, 1)))
       AND (p.fim_ano IS NULL OR (p_ano * 100 + p_mes) <= (p.fim_ano * 100 + coalesce(p.fim_mes, 12)))
       AND (p_empresas IS NULL OR p.empresa_id = ANY(p_empresas))
       AND (p_filiais  IS NULL OR p.filial_id  = ANY(p_filiais))
       AND (p_ccs      IS NULL OR p.cc_id      = ANY(p_ccs))
     GROUP BY p.filial_id, btrim(split_part(p.codigo, '-', 2))
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
