-- ============================================================
-- 113 — Quem recebe por hora (posto.recebe_hora)
--
-- O integrador do apontamento (OEFOLM02.PRW) só gera verba de hora para quem
-- tem roteiro AUT — `RA_CATFUNC = 'A'` no cadastro da folha. Gerente de projeto
-- e coordenador APONTAM horas, mas não são pagos por elas: entram no extrato e
-- nunca aparecem nas verbas 222/223.
--
-- Sem esse recorte a conciliação Apontamento × Folha acusa ~25 pessoas como
-- "sem folha" todo mês, e a lista de divergências fica grande demais para ser
-- lida — que é o mesmo que não ter conciliação.
--
-- Por que uma coluna nova e não `regime`: regime é derivado da matrícula
-- (0=CLT, 9=PRESTADOR) e do cargo, e não diz nada sobre a forma de pagamento.
-- São perguntas diferentes: um PRESTADOR pode ser coordenador e não receber por
-- hora, e é exatamente esse o caso que estoura a tela.
--
-- Três estados, e o NULL é significativo:
--   true  — roteiro AUT: o apontamento dele vira verba de hora, entra na conferência
--   false — não recebe por hora: aponta para dizer onde o custo cai, e só
--   NULL  — não sabemos ainda; a tela trata como "entra", para não esconder
--           silenciosamente quem talvez devesse estar lá
--
-- Preenchimento: o import do cadastro quando o export trouxer `RA_CATFUNC`
-- (é a fonte de verdade); até lá, marcação na própria tela de conciliação.
-- Quando o campo vier do ERP, ele sobrescreve a marcação manual — o cadastro da
-- folha é quem decide, não quem confere.
--
-- Idempotente.
-- ============================================================

ALTER TABLE posto
  ADD COLUMN IF NOT EXISTS recebe_hora boolean;

COMMENT ON COLUMN posto.recebe_hora IS
  'Roteiro AUT (RA_CATFUNC=''A''): o apontamento vira verba de hora na folha. false = aponta mas recebe salário (gerente/coordenador). NULL = desconhecido, entra na conferência.';

-- a conciliação varre por isto junto com o recurso
CREATE INDEX IF NOT EXISTS ix_posto_recebe_hora ON posto (tenant_id, recebe_hora);
