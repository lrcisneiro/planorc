-- ============================================================
-- A alíquota de faturamento é igual em todas as filiais?
--
-- Decide se o imposto pode virar FÓRMULA no relatório (só se a alíquota for
-- única, e ainda assim com as ressalvas do fato e do realizado) ou se tem de
-- ser CALCULADO por filial e gravado no fat_orcado.
--
-- Mostra também onde a receita orçada de 2027 cai por filial — porque alíquota
-- cadastrada em filial sem receita não importa, e filial com receita e sem
-- alíquota é um buraco silencioso.
-- Só leitura. Uma consulta só.
-- ============================================================
with rec as (
  -- receita orçada por filial, somando as contas de RECEITA
  select fo.filial_id, sum(fo.valor) v
    from fat_orcado fo
    join conta_orcamentaria co on co.id = fo.linha_id
    join versao_orcamento ver  on ver.id = fo.versao_id
   where co.natureza = 'RECEITA'
     and fo.ano = 2027
   group by 1
)
select coalesce(f.codigo, '(sem filial)')    as filial,
       coalesce(f.descricao, '—')            as filial_nome,
       coalesce(e.codigo, '—')               as empresa,
       coalesce(f.imp_fat::text, '⚠ SEM ALÍQUOTA') as imp_fat,
       coalesce(round(r.v, 2)::text, '—')    as receita_orcada_2027,
       case when r.v is not null and f.imp_fat is null then '⚠ tem receita e não tem alíquota'
            when r.v is null and f.imp_fat is not null then 'alíquota sem receita (ok)'
            when r.v is not null then round(r.v * f.imp_fat / 100, 2)::text || ' de imposto'
            else '' end                      as situacao
  from filial f
  left join empresa e on e.id = f.empresa_id
  left join rec r     on r.filial_id = f.id
 where f.ativo
 order by (r.v is null), f.codigo;
