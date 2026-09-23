-- ============================================================
-- 095 — O lote da folha, para o confidencial não ser apagado junto
--
-- A folha de uma competência vem de MAIS DE UM arquivo: o export do ERP e a
-- folha confidencial (sócios, pró-labore de diretoria), que não passa pela
-- folha normal e é importada à parte. O import já tinha o modo incremental para
-- empilhar um sobre o outro — mas o modo "substituir competência" apagava a
-- competência INTEIRA.
--
-- Ou seja: no mês em que o ERP corrigisse qualquer coisa e a folha normal fosse
-- reimportada, a confidencial sumiria junto. Sem aviso. E a nota fiscal dessas
-- pessoas voltaria a aparecer como "sem folha" — divergência falsa de
-- R$ 120.800 em ago/2026, que ninguém ligaria à reimportação.
--
-- A coluna lote já existia em fat_folha (v3_062) e nunca foi preenchida. Agora
-- o import a grava, e "substituir" troca só o lote correspondente. Dá para
-- reimportar a folha normal quantas vezes for preciso sem derrubar a
-- confidencial, e para refazer só a confidencial.
--
-- O backfill marca o que já está lá como 'FOLHA': é de onde veio. Sem ele, a
-- primeira substituição não acharia o que apagar e a competência dobraria.
-- ============================================================

UPDATE fat_folha SET lote = 'FOLHA'
 WHERE tipo = 'REALIZADO' AND coalesce(lote, '') = '';

CREATE INDEX IF NOT EXISTS ix_fat_folha_lote
  ON fat_folha (tenant_id, tipo, ano, mes, lote);
