-- ============================================================
-- O que o seed2027_import_v3_1.xlsx traz existe no Planorc?
-- (924 combinações · total 2027 -21.066.423,57)
--
-- O importador casa por CÓDIGO. Código inexistente é DESCARTADO SEM AVISO:
-- a linha some, o total fecha menor, e nada na tela denuncia.
--
-- 53 contas · 42 centros de custo · 10 empresas · 10 filiais.
-- Só leitura. Uma consulta só.
-- ============================================================
with conta_arq(c) as (VALUES
    ('20401'),
    ('20501'),
    ('20601'),
    ('20602'),
    ('20603'),
    ('20604'),
    ('20605'),
    ('20606'),
    ('20701'),
    ('22001'),
    ('22002'),
    ('22003'),
    ('22004'),
    ('22005'),
    ('22006'),
    ('22007'),
    ('22008'),
    ('22009'),
    ('22010'),
    ('22011'),
    ('22012'),
    ('22014'),
    ('22015'),
    ('22016'),
    ('22017'),
    ('22018'),
    ('22019'),
    ('22020'),
    ('22021'),
    ('22022'),
    ('22023'),
    ('22024'),
    ('22025'),
    ('22026'),
    ('22027'),
    ('22028'),
    ('22029'),
    ('22031'),
    ('22032'),
    ('22033'),
    ('22035'),
    ('22036'),
    ('22037'),
    ('22038'),
    ('22039'),
    ('22040'),
    ('22041'),
    ('22042'),
    ('22043'),
    ('22044'),
    ('22045'),
    ('23001'),
    ('23002')
), cc_arq(c) as (VALUES
    ('111'),
    ('121'),
    ('122'),
    ('123'),
    ('124'),
    ('131'),
    ('141'),
    ('200'),
    ('210'),
    ('211'),
    ('212'),
    ('214'),
    ('215'),
    ('216'),
    ('220'),
    ('221'),
    ('222'),
    ('224'),
    ('225'),
    ('226'),
    ('310'),
    ('311'),
    ('313'),
    ('314'),
    ('316'),
    ('317'),
    ('320'),
    ('321'),
    ('323'),
    ('324'),
    ('326'),
    ('327'),
    ('328'),
    ('411'),
    ('511'),
    ('512'),
    ('514'),
    ('516'),
    ('521'),
    ('522'),
    ('524'),
    ('526')
), emp_arq(c) as (VALUES
    ('01'),
    ('05'),
    ('06'),
    ('25'),
    ('28'),
    ('40'),
    ('YY'),
    ('ZZ'),
    ('yy'),
    ('zz')
), fil_arq(c) as (VALUES
    ('2001'),
    ('2002'),
    ('2003'),
    ('2005'),
    ('2006'),
    ('2101'),
    ('2102'),
    ('2501'),
    ('2801'),
    ('4001')
)
select '1 · CONTA sem conta_orcamentaria' as secao, a.c as codigo, '⚠ linha descartada' as situacao
  from conta_arq a where not exists (select 1 from conta_orcamentaria o where trim(o.codigo) = a.c)
union all
select '2 · CENTRO DE CUSTO sem cadastro', a.c, '⚠ linha descartada'
  from cc_arq a where not exists (select 1 from centro_custo x where trim(x.codigo) = a.c)
union all
select '3 · EMPRESA sem cadastro', a.c, '⚠ linha descartada'
  from emp_arq a where not exists (select 1 from empresa x where trim(x.codigo) = a.c)
union all
select '4 · FILIAL sem cadastro', a.c, '⚠ linha descartada'
  from fil_arq a where not exists (select 1 from filial x where trim(x.codigo) = a.c)
union all
select '5 · resultado', '—',
       case when not exists (select 1 from conta_arq a where not exists (select 1 from conta_orcamentaria o where trim(o.codigo) = a.c))
             and not exists (select 1 from cc_arq a  where not exists (select 1 from centro_custo x where trim(x.codigo) = a.c))
             and not exists (select 1 from emp_arq a where not exists (select 1 from empresa x      where trim(x.codigo) = a.c))
             and not exists (select 1 from fil_arq a where not exists (select 1 from filial x       where trim(x.codigo) = a.c))
            then '✓ tudo existe no Planorc — pode importar'
            else '⚠ há códigos sem cadastro acima; corrija antes de importar' end
 order by 1, 2;
