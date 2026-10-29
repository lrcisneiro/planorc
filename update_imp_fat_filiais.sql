-- ============================================================
-- Alíquotas de imposto sobre faturamento, por filial (out/2026).
--
-- Casa por `trim(codigo)` de propósito: o export traz "BO  " e "XX  " com
-- espaço à direita — padding do Protheus —, e um `=` literal não casaria.
--
-- ⚠ O código `01` vem DUAS vezes no export (RESULTAR BOLÍVIA e RESULTAR
-- PARAGUAI), mas filial tem UNIQUE (tenant_id, codigo): as duas não coexistem
-- com esse código. Como ambas são 0, o número não muda — a conferência mostra
-- o que de fato casou.
--
-- Zero é alíquota REAL (exterior), não "não cadastrado". Quem não estiver nesta
-- lista fica como está — o UPDATE não apaga nada.
--
-- Só altera a coluna imp_fat. IDEMPOTENTE.
-- ============================================================

UPDATE filial f
   SET imp_fat = v.imp
  FROM (VALUES
    ('01',              0.00),   -- RESULTAR exterior (BOLÍVIA / PARAGUAI)
    ('2001',            5.65),   -- WAYUP SERVICOS-RIO PRETO
    ('2002',            5.65),   -- WAYUP SERVICOS-BAURU
    ('2003',            8.65),   -- WAYUP SERVICOS-MS
    ('2004',            6.65),   -- WAYUP SERVICOS-MARINGA
    ('2005',            5.65),   -- WAYUP SERVICOS-LONDRINA
    ('2006',            6.65),   -- WAYUP SERVICOS-CASCAVEL
    ('2101',            5.65),   -- WAYUP SJRP-RIO PRETO
    ('2102',            5.65),   -- WAYUP SJRP-BAURU
    ('2104',            6.65),   -- WAYUP SERVICOS-MARINGA
    ('2501',            5.65),   -- WAYUP MODA
    ('2801',            6.65),   -- RESULTAR BR
    ('3501',            6.65),   -- AVENTUM
    ('4001',            5.65),   -- TOP PARTICIPACOES S/A
    ('BO',              0.00),   -- BOLIVIA - COMPARTILHADA
    ('BO - INDEFINIDO', 0.00),
    ('XX',              0.00)    -- RESULTAR - COMPARTILHADA
  ) AS v(cod, imp)
 WHERE trim(f.codigo) = v.cod;

-- ---------- conferência ----------
-- Três seções: o que ficou gravado, código do arquivo que não achou filial, e
-- filial ativa que seguiu SEM alíquota (essa daria imposto zero sem avisar).
with lista(cod, imp) as (VALUES
    ('01', 0.00), ('2001', 5.65), ('2002', 5.65), ('2003', 8.65), ('2004', 6.65),
    ('2005', 5.65), ('2006', 6.65), ('2101', 5.65), ('2102', 5.65), ('2104', 6.65),
    ('2501', 5.65), ('2801', 6.65), ('3501', 6.65), ('4001', 5.65),
    ('BO', 0.00), ('BO - INDEFINIDO', 0.00), ('XX', 0.00)
)
select '1 · gravado' as secao,
       trim(f.codigo) as a, f.descricao as b,
       f.imp_fat::text as c,
       case when f.imp_fat = 0 then 'zero (exterior/compartilhada)' else '' end as d
  from filial f join lista l on trim(f.codigo) = l.cod
union all
select '2 · código do arquivo SEM filial', l.cod, '—', l.imp::text,
       '⚠ nenhuma filial com este código'
  from lista l
 where not exists (select 1 from filial f where trim(f.codigo) = l.cod)
union all
select '3 · filial ativa ainda SEM alíquota', trim(f.codigo), f.descricao, '(nulo)',
       '⚠ ficaria com imposto zero sem avisar'
  from filial f
 where f.ativo and f.imp_fat is null
 order by 1, 2;
