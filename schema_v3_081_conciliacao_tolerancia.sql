-- ============================================================
-- 081 — Tolerância da conciliação de folha (por TENANT, não por usuário)
--
-- A conciliação contábil × folha tem diferenças de centavos que são rateio e
-- arredondamento, não divergência (o INSS de ago/2026 fechou com −920 em
-- R$ 189 mil). Abaixo de um limite a linha conta como conciliada.
--
-- Fica no tenant de propósito: tolerância é política de controladoria. Guardada
-- por usuário, dois analistas veriam status diferentes no mesmo mês e a
-- conciliação deixaria de ser um fato comum.
-- ============================================================

ALTER TABLE tenant
  ADD COLUMN IF NOT EXISTS conciliacao_tolerancia numeric(12,2) NOT NULL DEFAULT 1.00;

COMMENT ON COLUMN tenant.conciliacao_tolerancia IS
  'Diferença absoluta (R$) abaixo da qual uma verba conta como conciliada na tela Conciliação → Contábil × Folha.';
