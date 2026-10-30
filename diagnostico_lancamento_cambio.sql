-- ============================================================
-- UM lançamento de +12.857.665,55 na conta contábil 1304 (RESULTADO POR
-- DIFERENCIA DE CAMBIO) responde sozinho pelo Resultado Financeiro invertido
-- de 2026 — e por consequência pelo Resultado Líquido.
--
-- A conta irmã 0805, de mesmo nome, tem 87 lançamentos somando 67 mil. Um
-- lançamento 190× maior com 1/87 dos lançamentos não é operação: é carga.
--
-- HIPÓTESE: valor em GUARANI gravado como se fosse real. A ~1.300 PYG/BRL,
-- 12.857.665 PYG ≈ 9.900 BRL — a ordem de grandeza dos lançamentos da 0805.
--
-- Esta consulta identifica o lançamento: empresa, filial, lote, data e
-- histórico. Com isso dá para decidir entre corrigir a carga, ignorar o lote
-- ou converter.
--
-- ⚠ NÃO corrige nada. Só leitura.
-- ============================================================
select fr.ano, fr.mes,
       e.codigo  || ' · ' || e.descricao  as empresa,
       coalesce(f.codigo || ' · ' || f.descricao, '(sem filial)') as filial,
       coalesce(cc.codigo || ' · ' || cc.descricao, '(sem CC)')   as centro_custo,
       cco.codigo || ' · ' || cco.descricao as conta_contabil,
       to_char(fr.valor, 'FM999G999G990D00') as valor,
       fr.origem,
       coalesce(fr.lote, '—')    as lote,
       coalesce(fr.sublote, '—') as sublote,
       coalesce(left(fr.dims->>'historico', 90), '—') as historico,
       fr.importado_em
  from fat_realizado fr
  join conta_contabil cco on cco.id = fr.conta_id
  left join empresa e      on e.id  = fr.empresa_id
  left join filial f       on f.id  = fr.filial_id
  left join centro_custo cc on cc.id = fr.cc_id
 where cco.codigo in ('1304', '0805')     -- as duas contas de diferença de câmbio
 order by abs(fr.valor) desc
 limit 30;
