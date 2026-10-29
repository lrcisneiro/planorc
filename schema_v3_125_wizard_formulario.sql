-- ============================================================
-- v3_125 — base do WIZARD DE FORMULÁRIOS.
--
-- Desenho em docs/DESIGN_wizard_formularios.md. Um wizard gera um formulário a
-- partir de dado que o sistema já tem — a receita orçada, um campo de cadastro
-- — em vez de pedir que alguém redigite. O primeiro é o de impostos sobre
-- faturamento; o mecanismo existe para o segundo.
--
-- Esta migration traz só o que o BANCO precisa. A receita de cada wizard vive
-- em `frontend/src/lib/wizards.ts`, como o catálogo CAPACIDADES: a receita é
-- código, o resultado é dado.
--
-- Substitui a v3_124 (nunca rodada), que calculava o imposto e gravava direto
-- no fat_orcado. Era opaca — o cálculo vivia no `dims` — e não deixava
-- sobrescrever uma filial com regime especial. A lógica de leitura dela
-- sobrevive aqui, como a fonte ORCADO.
--
-- IDEMPOTENTE. Não altera dado nenhum.
-- ============================================================

-- ---------- 1 · célula gerada ≠ célula digitada ----------
-- É o que permite re-gerar sem atropelar correção manual: o wizard substitui
-- só o que ele mesmo pôs. Sem isso, a segunda geração apaga o ajuste que
-- alguém fez na filial de regime especial — calada.
ALTER TABLE formulario_valor
  ADD COLUMN IF NOT EXISTS gerado boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN formulario_valor.gerado IS
  'true = célula escrita por um wizard; re-gerar substitui. false = digitada ou importada, o wizard não toca.';

-- ---------- 2 · de qual wizard o formulário nasceu ----------
-- Guarda o código do wizard (não a receita inteira): é o que permite o botão
-- "Atualizar a partir do orçado" saber o que re-rodar, e os parâmetros usados
-- ficam registrados para a geração ser repetível.
ALTER TABLE formulario
  ADD COLUMN IF NOT EXISTS wizard        text,
  ADD COLUMN IF NOT EXISTS wizard_params jsonb;

COMMENT ON COLUMN formulario.wizard IS
  'Código do wizard que gerou este formulário (lib/wizards.ts). NULL = criado em branco.';

-- ---------- 3 · fonte ORCADO: soma o orçado por escopo × mês ----------
-- Lê o que o wizard precisa para preencher um driver a partir do orçado.
--
-- ⚠ `p_excluir_contas` e `p_excluir_linhas` NÃO são conveniência: são o que
-- impede o wizard de ler o que ele escreve. No caso do imposto, sem excluir a
-- conta de destino o imposto entraria na própria base na segunda geração e
-- cresceria a cada execução — um erro que aparece devagar e parece premissa.
-- Quem chama tem de passar as contas de destino do próprio formulário.
-- ⚠ DEVOLVE jsonb, não SETOF. O PostgREST corta em 1000 linhas por chamada
-- SEM ERRO, e isso vale também para função que retorna conjunto: 60 escopos ×
-- 12 meses dão 720 — passa hoje e some calado quando a operação crescer. Um
-- agregado jsonb é UMA linha e não tem esse teto. (Mesma armadilha do pageAll
-- documentada no CLAUDE.md.)
--
-- Formato: [{"e":empresa_id,"f":filial_id,"c":cc_id,"m":mes,"v":valor}, …]
-- Chaves curtas de propósito: são 720 objetos trafegando.
DROP FUNCTION IF EXISTS wizard_orcado_por_escopo(uuid, int, text, text[], text[]);
CREATE FUNCTION wizard_orcado_por_escopo(
  p_versao          uuid,
  p_ano             int,
  p_natureza        text   DEFAULT NULL,   -- 'RECEITA' | 'DESPESA' | NULL = todas
  p_excluir_contas  text[] DEFAULT '{}',   -- códigos de conta_orcamentaria
  p_excluir_linhas  text[] DEFAULT '{}'    -- códigos de linha carimbados em dims->>'linha'
) RETURNS jsonb
LANGUAGE sql STABLE SET statement_timeout = '60s'
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'e', t.empresa_id, 'f', t.filial_id, 'c', t.cc_id, 'm', t.mes, 'v', t.v)), '[]'::jsonb)
    FROM (
      SELECT fo.empresa_id, fo.filial_id, fo.cc_id, fo.mes, round(sum(fo.valor), 2) AS v
        FROM fat_orcado fo
        JOIN conta_orcamentaria co ON co.id = fo.linha_id
       WHERE fo.tenant_id = current_tenant_id()
         AND fo.versao_id = p_versao
         AND fo.ano       = p_ano
         AND (p_natureza IS NULL OR co.natureza = p_natureza)
         AND NOT (co.codigo = ANY(p_excluir_contas))
         AND NOT (coalesce(fo.dims->>'linha', '') = ANY(p_excluir_linhas))
       GROUP BY fo.empresa_id, fo.filial_id, fo.cc_id, fo.mes
      HAVING sum(fo.valor) <> 0
    ) t
$$;

-- ---------- conferência ----------
SELECT 'coluna gerado' AS item,
       (SELECT count(*) FROM information_schema.columns
         WHERE table_name = 'formulario_valor' AND column_name = 'gerado')::text AS ok
UNION ALL
SELECT 'colunas wizard no formulario',
       (SELECT count(*) FROM information_schema.columns
         WHERE table_name = 'formulario' AND column_name IN ('wizard','wizard_params'))::text
UNION ALL
SELECT 'função wizard_orcado_por_escopo',
       (SELECT count(*) FROM pg_proc WHERE proname = 'wizard_orcado_por_escopo')::text;
