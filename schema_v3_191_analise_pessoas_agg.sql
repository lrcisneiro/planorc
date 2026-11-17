-- ============================================================
-- v3_191 — agregação da aba "Análise Pessoas"
--
-- POR QUE EXISTE: a aba responde "quanto cada área custa de gente, quantas
-- pessoas são e quanto isso pesa na despesa". O dado está em `fat_orcado`, mas
-- são **16.500 linhas** de origem POSTO por versão/ano, e trazê-las cruas para
-- somar no navegador é o caminho que o projeto já descartou ("agregação pesada
-- é feita no banco", CLAUDE.md).
--
-- ⚠ `SECURITY INVOKER`, como `relatorio_orcado_agg` e `dashboard_cc_agg`.
-- Não é descuido: assim o **RLS de `fat_orcado` aplica sozinho** e quem não
-- alcança um CC não soma o custo dele. `SECURITY DEFINER` aqui obrigaria a
-- repetir o recorte no `WHERE` — e aí seriam duas regras para divergir.
--
-- ⚠⚠ A UNIDADE É A PESSOA, NÃO O POSTO (decisão do Ricardo, 17/nov). Posto
-- duplica: o pró-labore é pago por empresa do grupo e a matrícula é por
-- empresa, então quem recebe em quatro ganha quatro postos — a Diretoria tem
-- 11 postos e 6 pessoas. A função devolve o grão (área, regime, pessoa) e
-- quem conta pessoa distinta é o `count(DISTINCT)` de quem consome.
-- ⚠ A chave da pessoa é o NOME do `dims`, mesma precedência de
-- `lib/pessoaChave.ts`. Homônimo conta como um — erro conhecido, menor e na
-- direção oposta à de inflar; o conserto real é popular `funcionario_id`.
--
-- ⚠ DUAS COISAS NUMA CHAMADA, e é de propósito: `tipo='PESSOA'` traz o custo
-- de gente e `tipo='DESPESA'` o total operacional da área. Separar em duas
-- RPCs deixaria as porcentagens serem calculadas sobre denominadores lidos em
-- momentos diferentes — e é exatamente num denominador que ninguém repara.
--
-- ⚠ DESPESA É SÓ A OPERACIONAL (bloco `2` do plano). Ficam de fora o resultado
-- financeiro (bloco `3`), os impostos sobre faturamento (`13001`, que moram no
-- bloco da receita por serem dedução dela) e a receita. Decisão do Ricardo —
-- e a diferença entre os denominadores é de 72,6% para 65,5%, pequena o
-- bastante para ninguém notar e grande o bastante para ninguém reproduzir.
--
-- ⚠⚠ DUAS LINHAS DE `WHERE` DECIDEM 46× DE DESEMPENHO, e a primeira versão
-- desta função não tinha nenhuma das duas — ela estourava o `statement timeout`
-- na tela. Medido: a mesma consulta roda em **80 ms solta** e **3.698 ms dentro
-- da função**.
--   1. `tenant_id = current_tenant_id()` — o índice útil é
--      `(tenant_id, versao_id, ano)`, e sem a **chave líder** ele não serve.
--   2. `empresa_id = ANY(p_empresas)` SEM o `IS NULL OR` — o padrão
--      `(p IS NULL OR col = ANY(p))` impede o uso de índice em qualquer caso,
--      porque o predicado depende de um parâmetro que pode ser nulo. Por isso
--      a empresa virou **obrigatória**, como em `relatorio_orcado_agg`; filial
--      e CC seguem opcionais, que é como a RPC que já funciona faz.
-- ⚠ O engano foi medir como DONO: pelo CLI eu ignoro RLS e as duas metades
-- pareciam rápidas. O que estava lento era a **função com parâmetros**, e só
-- chamá-la de verdade mostrou isso. Medir a peça não é medir o conjunto.
--
-- Re-executável. Termina em SELECT.
-- ============================================================

DROP FUNCTION IF EXISTS analise_pessoas_agg(uuid, integer, uuid[], uuid[], uuid[]);
DROP FUNCTION IF EXISTS teste_agg(uuid, integer, uuid[], uuid[], uuid[]);
CREATE FUNCTION analise_pessoas_agg(
  p_versao   uuid,
  p_ano      integer,
  p_empresas uuid[],              -- obrigatório: ver a nota de desempenho acima
  p_filiais  uuid[]   DEFAULT NULL,
  p_ccs      uuid[]   DEFAULT NULL
) RETURNS TABLE (
  tipo      text,
  area_cod  text,
  area_nome text,
  regime    text,
  pessoa    text,
  valor     numeric
) LANGUAGE sql STABLE AS $$
  -- custo de GENTE, no grão (área, regime, pessoa)
  SELECT 'PESSOA'::text,
         cc.area_cod,
         coalesce(cc.area_nome, '(sem área)'),
         coalesce(p.regime, '(sem regime)'),
         -- mesma precedência do lib/pessoaChave.ts: nome → matrícula → posto
         coalesce(nullif(upper(trim(f.dims->>'nome')), ''),
                  nullif(trim(f.dims->>'matricula'), ''),
                  f.dims->>'posto'),
         sum(-f.valor)
    FROM fat_orcado f
    LEFT JOIN centro_custo cc ON cc.id = f.cc_id
    LEFT JOIN posto p ON p.codigo = f.dims->>'posto' AND p.tenant_id = f.tenant_id
   WHERE f.tenant_id = current_tenant_id()
     AND f.versao_id = p_versao AND f.ano = p_ano AND f.origem = 'POSTO'
     AND f.empresa_id = ANY (p_empresas)
     AND (p_filiais IS NULL OR f.filial_id = ANY (p_filiais))
     AND (p_ccs     IS NULL OR f.cc_id     = ANY (p_ccs))
   GROUP BY 1, 2, 3, 4, 5

  UNION ALL

  -- despesa OPERACIONAL da área (todas as origens, só o bloco 2)
  SELECT 'DESPESA'::text,
         cc.area_cod,
         coalesce(cc.area_nome, '(sem área)'),
         NULL, NULL,
         sum(-f.valor)
    FROM fat_orcado f
    JOIN conta_orcamentaria co ON co.id = f.linha_id
    LEFT JOIN centro_custo cc ON cc.id = f.cc_id
   WHERE f.tenant_id = current_tenant_id()
     AND f.versao_id = p_versao AND f.ano = p_ano
     AND co.codigo LIKE '2%'
     AND f.empresa_id = ANY (p_empresas)
     AND (p_filiais IS NULL OR f.filial_id = ANY (p_filiais))
     AND (p_ccs     IS NULL OR f.cc_id     = ANY (p_ccs))
   GROUP BY 1, 2, 3
$$;

COMMENT ON FUNCTION analise_pessoas_agg IS
  'Aba Análise Pessoas: custo por (área, regime, pessoa) + despesa operacional por área. SECURITY INVOKER — o RLS de fat_orcado recorta.';

GRANT EXECUTE ON FUNCTION analise_pessoas_agg(uuid, integer, uuid[], uuid[], uuid[]) TO authenticated;

-- ---------------- conferência ----------------
-- ⚠ 301, não 305: a FOTO conta quem CUSTA, o cadastro conta quem existe. Os 7
-- postos de salário zero não geram linha no Aplicar e ficam de fora. A primeira
-- versão desta asserção cobrava 305 — o número do cadastro — e teria mandado
-- alguém investigar uma função que estava certa. É a lição da
-- `prova_escopo_pessoas.sql`: a asserção afirma o MÍNIMO necessário, e contra a
-- referência certa.
SELECT 'pessoas distintas na foto (301 — veja a nota)' AS secao,
       (SELECT count(DISTINCT pessoa)::text
          FROM analise_pessoas_agg(
            (SELECT id FROM versao_orcamento WHERE codigo = 'Orçado2027'), 2027,
            (SELECT array_agg(id) FROM empresa))
         WHERE tipo = 'PESSOA') AS resultado
UNION ALL
SELECT 'custo de pessoal',
       (SELECT 'R$ ' || round(sum(valor), 0)::text
          FROM analise_pessoas_agg(
            (SELECT id FROM versao_orcamento WHERE codigo = 'Orçado2027'), 2027,
            (SELECT array_agg(id) FROM empresa))
         WHERE tipo = 'PESSOA')
UNION ALL
SELECT 'despesa operacional',
       (SELECT 'R$ ' || round(sum(valor), 0)::text
          FROM analise_pessoas_agg(
            (SELECT id FROM versao_orcamento WHERE codigo = 'Orçado2027'), 2027,
            (SELECT array_agg(id) FROM empresa))
         WHERE tipo = 'DESPESA')
UNION ALL
SELECT 'pessoal ÷ despesa (deve dar 72,6%)',
       (SELECT round(sum(valor) FILTER (WHERE tipo='PESSOA')
                   / nullif(sum(valor) FILTER (WHERE tipo='DESPESA'), 0) * 100, 1)::text || '%'
          FROM analise_pessoas_agg(
            (SELECT id FROM versao_orcamento WHERE codigo = 'Orçado2027'), 2027,
            (SELECT array_agg(id) FROM empresa)))
UNION ALL
SELECT 'alguém com custo em mais de uma área?',
       (SELECT CASE WHEN count(*) = 0 THEN 'não — a soma por área fecha'
                    ELSE '⚠ ' || count(*)::text || ' pessoa(s)' END
          FROM (SELECT pessoa FROM analise_pessoas_agg(
                  (SELECT id FROM versao_orcamento WHERE codigo = 'Orçado2027'), 2027,
            (SELECT array_agg(id) FROM empresa))
                 WHERE tipo = 'PESSOA'
                 GROUP BY pessoa HAVING count(DISTINCT area_nome) > 1) x);
