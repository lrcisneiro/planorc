-- ============================================================
-- 114 — Função do apontamento (quem recebe por hora)
--
-- O que decide se uma pessoa é conferida contra as verbas de hora da folha é a
-- FUNÇÃO que ela exerce no projeto — não a categoria da folha (RA_CATFUNC, que
-- só separa PJ de CLT, coisa que `posto.regime` já faz) e não o cargo do
-- cadastro (medido: 214 de 303 que apontam têm o mesmo cargo genérico
-- "ANAL. NEGOCIO III", e só 3 são "GESTOR DE PROJETOS").
--
-- A função vem na coluna `Cargo` do Extrato de Horas Apontadas, e o dado se
-- comporta como atributo da PESSOA no mês: medido em jun e jul/2026, ZERO de
-- 172 pessoas aparecem com duas funções. São 9 funções — marcar 9 linhas uma
-- vez, em vez de 25 pessoas todo mês, e o gestor novo já entra classificado.
--
-- Gestão em jul/2026: GESTOR DE PROJETOS (15 pessoas · 1.364,6 h) e
-- GERENTE DE SERVICOS (1 · 14 h). Eles apontam horas e recebem salário.
--
-- Precedência de quem recebe por hora:
--    posto.recebe_hora (exceção por pessoa, migration 113)
--      > apontamento_funcao.recebe_hora (o padrão, aqui)
--        > true (entra na conferência — não esconder por omissão)
--
-- Idempotente.
-- ============================================================

-- ---------- a função na linha do apontamento ----------
ALTER TABLE fat_apontamento
  ADD COLUMN IF NOT EXISTS funcao text;

COMMENT ON COLUMN fat_apontamento.funcao IS
  'Função no projeto (coluna Cargo do extrato): CONSULTOR(A), GESTOR DE PROJETOS… É o que decide se a pessoa é conferida contra as verbas de hora da folha.';

CREATE INDEX IF NOT EXISTS ix_apont_funcao ON fat_apontamento (tenant_id, funcao);

-- ---------- catálogo de funções ----------
-- Preenchido pela própria importação (a função é descoberta, não cadastrada):
-- função nova entra com recebe_hora = true e aparece na tela para ser marcada.
-- Entrar como true é deliberado — uma função desconhecida que some da conferência
-- em silêncio é pior do que uma que aparece indevidamente e é corrigida.
CREATE TABLE IF NOT EXISTS apontamento_funcao (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant ON DELETE CASCADE,
  funcao      text NOT NULL,
  recebe_hora boolean NOT NULL DEFAULT true,
  obs         text,
  criado_em   timestamptz DEFAULT now(),
  UNIQUE (tenant_id, funcao)
);

COMMENT ON TABLE apontamento_funcao IS
  'Funções do apontamento e se o ERP paga por hora quem as exerce. Descobertas na importação do extrato; a marcação é de quem confere.';

ALTER TABLE apontamento_funcao ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "apontamento_funcao_rls" ON apontamento_funcao;
CREATE POLICY "apontamento_funcao_rls" ON apontamento_funcao FOR ALL
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

-- ---------- posto.recebe_hora é EXCEÇÃO, não o padrão ----------
-- Criada na 113 pensando em RA_CATFUNC, que não era o campo certo. O comentário
-- passa a dizer o que ela é de fato: o override de uma pessoa sobre a função.
COMMENT ON COLUMN posto.recebe_hora IS
  'Exceção por pessoa sobre apontamento_funcao.recebe_hora. NULL = herda da função (o normal). Use só quando a pessoa foge do padrão da função dela.';
