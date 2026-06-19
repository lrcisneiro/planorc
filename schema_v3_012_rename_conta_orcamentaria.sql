-- ============================================================
-- Renomeia a estrutura compartilhada para o nome correto do conceito:
-- "conta orçamentária" (o hub gerencial). FKs e índices acompanham
-- a tabela automaticamente. Rode junto com o deploy do código novo.
-- ============================================================
ALTER TABLE linha_orcamentaria RENAME TO conta_orcamentaria;
