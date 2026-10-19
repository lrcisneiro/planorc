-- ============================================================
-- Conferência do razão PY depois da reimportação
--
-- Três perguntas: entrou tudo? entrou com as duas moedas? e o que ficou
-- fora da DRE por falta de amarração?
--
-- Só leitura.
-- ============================================================

-- ─────────── 1 · o que entrou, por mês e moeda ───────────
-- Esperado: 6.809 linhas no total (era o que os 10 lotes traziam).
-- `valor` é o slot 1 (BRL) e `val_m2` o slot 2 (USD). Com moeda do arquivo = USD,
-- val_m2 é o número original e `valor` é o convertido pela cotação do dia.
-- Linha com val_m2 nulo = algo não materializou.
select
  f.ano, f.mes,
  count(*)                                   as linhas,
  count(*) filter (where f.val_m2 is null)   as sem_usd,
  count(*) filter (where f.filial_id is null) as sem_filial,
  round(sum(f.valor), 2)                     as total_brl,
  round(sum(f.val_m2), 2)                    as total_usd,
  min(f.moeda_origem)                        as moeda_origem
from fat_realizado f
join empresa e on e.id = f.empresa_id
where e.codigo = 'XX'
group by f.ano, f.mes
order by f.ano, f.mes;

-- ─────────── 2 · conta a conta: o que está fora da DRE ───────────
-- Conta sem master não aparece em relatório nenhum. Para as patrimoniais
-- (01xx/02xx) isso é o esperado; para as de resultado, é buraco.
select
  cc.codigo,
  cc.descricao,
  case when cc.codigo ~ '^0[12]' then 'patrimonial (ok ficar fora)'
       else '*** RESULTADO sem master ***' end as situacao,
  count(*)                as lancamentos,
  round(sum(f.val_m2), 2) as total_usd
from fat_realizado f
join empresa e        on e.id = f.empresa_id and e.codigo = 'XX'
join conta_contabil cc on cc.id = f.conta_id
where not exists (select 1 from conta_linha cl where cl.conta_id = cc.id)
group by cc.codigo, cc.descricao
order by case when cc.codigo ~ '^0[12]' then 1 else 0 end, abs(sum(f.val_m2)) desc;

-- ─────────── 3 · a filial XX01 está cadastrada e apontando para o plano? ───────────
select
  f.codigo        as filial,
  f.descricao,
  e.codigo        as empresa,
  pc.codigo       as plano,
  (select count(*) from fat_realizado r where r.filial_id = f.id) as lancamentos
from filial f
join empresa e      on e.id = f.empresa_id
left join plano_contas pc on pc.id = e.plano_id
where e.codigo in ('XX','BO')
order by f.codigo;
