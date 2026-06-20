-- ============================================================
-- Limpa TODO o realizado (fat_realizado) da tenant, para reimportar
-- do zero. Necessário porque o remap de empresa (07→05, 08→25) faz
-- as empresas 07/08 sumirem do arquivo — então a importação por
-- "Substituir" (por empresa/ano/mês) não removeria os lançamentos
-- antigos dessas empresas. NÃO afeta orçado (fat_orcado) nem
-- balancete (fat_saldo).
-- ============================================================

-- (opcional) conferir antes:
-- select empresa_id, count(*) from fat_realizado group by 1;

DELETE FROM fat_realizado
 WHERE tenant_id = '11111111-1111-1111-1111-111111111111';

-- (opcional) conferir depois (deve voltar 0):
-- select count(*) from fat_realizado;
