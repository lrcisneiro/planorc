-- ============================================================
-- v3_153 — Compartilhar preset com PESSOAS, não só com "todos"
--
-- O modelo era binário: `owner_id` preenchido = só eu, nulo = o tenant inteiro.
-- Com 14 presets compartilhados, quem entra para validar a própria área recebe
-- quatorze cartões na cara — e "compartilhar com todos" deixou de ser o que
-- alguém quer dizer na maioria das vezes.
--
-- A mudança é ADITIVA, para não mexer no que já existe:
--   sem linhas em `dashboard_card_acesso` → comportamento de hoje, intacto
--     (owner_id nulo = todos · owner_id preenchido = só o dono);
--   com linhas → o dono E as pessoas listadas, e mais ninguém.
-- Os 14 cards atuais seguem exatamente como estão até alguém restringir um.
--
-- ⚠ A visibilidade vai na POLÍTICA e não só na tela. Esconder no frontend
-- deixaria o preset — e os filtros dele, que dizem que áreas existem — a um
-- `select` de distância. Foi a lição da ACS-02.
--
-- Quem restringe: o dono do card ou admin. Mesma regra de quem já pode
-- apagá-lo, porque restringir é menos destrutivo que apagar.
--
-- Termina em SELECT.
-- ============================================================

CREATE TABLE IF NOT EXISTS dashboard_card_acesso (
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  card_id   uuid NOT NULL REFERENCES dashboard_card(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  PRIMARY KEY (card_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_dca_user ON dashboard_card_acesso (user_id);

ALTER TABLE dashboard_card_acesso ENABLE ROW LEVEL SECURITY;

-- Ler: quem enxerga o card enxerga a lista dele. Saber com quem um painel é
-- compartilhado não é segredo, e esconder impediria a própria tela de edição.
DROP POLICY IF EXISTS dca_sel ON dashboard_card_acesso;
CREATE POLICY dca_sel ON dashboard_card_acesso FOR SELECT TO authenticated
  USING (tenant_id = (SELECT current_tenant_id()));

-- Escrever: dono do card ou admin.
DROP POLICY IF EXISTS dca_ins ON dashboard_card_acesso;
CREATE POLICY dca_ins ON dashboard_card_acesso FOR INSERT TO authenticated
  WITH CHECK (tenant_id = (SELECT current_tenant_id()) AND EXISTS (
    SELECT 1 FROM dashboard_card c WHERE c.id = card_id
      AND (c.owner_id = (SELECT auth.uid()) OR (SELECT eh_admin()))));
DROP POLICY IF EXISTS dca_del ON dashboard_card_acesso;
CREATE POLICY dca_del ON dashboard_card_acesso FOR DELETE TO authenticated
  USING (tenant_id = (SELECT current_tenant_id()) AND EXISTS (
    SELECT 1 FROM dashboard_card c WHERE c.id = card_id
      AND (c.owner_id = (SELECT auth.uid()) OR (SELECT eh_admin()))));

-- A política de leitura do card ganha o terceiro caso. `EXISTS` sobre a
-- restrição vem ANTES do `owner_id IS NULL`: ter lista é o que torna o card
-- dirigido, e aí "todos" deixa de valer.
DROP POLICY IF EXISTS dashboard_card_sel ON dashboard_card;
CREATE POLICY dashboard_card_sel ON dashboard_card FOR SELECT TO authenticated
  USING (
    tenant_id = (SELECT current_tenant_id())
    AND (
      owner_id = (SELECT auth.uid())                                   -- dono, sempre
      OR EXISTS (SELECT 1 FROM dashboard_card_acesso a                 -- dirigido a mim
                  WHERE a.card_id = dashboard_card.id AND a.user_id = (SELECT auth.uid()))
      OR (owner_id IS NULL                                             -- "todos", só quando
          AND NOT EXISTS (SELECT 1 FROM dashboard_card_acesso a        -- não há lista
                           WHERE a.card_id = dashboard_card.id))
    )
  );

SELECT 'tabela dashboard_card_acesso' AS secao,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables
                          WHERE table_name='dashboard_card_acesso') THEN 'criada' ELSE '⛔ não' END AS resultado
UNION ALL
SELECT 'política de leitura do card cita a lista?',
       CASE WHEN (SELECT qual::text FROM pg_policies
                   WHERE tablename='dashboard_card' AND policyname='dashboard_card_sel')
                 LIKE '%dashboard_card_acesso%' THEN 'sim' ELSE '⛔ não' END
UNION ALL
SELECT 'cards hoje (nenhum deve ficar restrito agora)',
       count(*)::text || ' no total · ' ||
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM dashboard_card_acesso a WHERE a.card_id = c.id))::text
       || ' com lista'
  FROM dashboard_card c;
