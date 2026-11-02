-- ============================================================
-- Onde estão os CC nulos hoje — por tabela, origem e empresa
--
-- Decisão do Ricardo (02/nov): "não deveríamos ter CC nulo; precisamos achar e
-- gerar logs quando algum import ou integração com o ERP trouxer isso".
--
-- ⚠ TENSÃO A RESOLVER ANTES DA POLÍTICA: o razão do exterior **não traz CC**.
-- Na apuração de 30/out, todo lançamento de PY e BO veio sem filial e sem
-- centro de custo. Se isso se confirmar aqui, "zero CC nulo" é inalcançável
-- para o exterior, e a política de RLS precisa distinguir:
--   · nulo LEGÍTIMO  — o ERP de origem não tem a dimensão
--   · nulo por FALHA  — rateio sem destino, import com coluna vazia
-- Esconder os dois do usuário restrito é conservador e seguro; tratar os dois
-- como erro gera alarme permanente que ninguém vai conseguir zerar.
--
-- Por isso o corte por EMPRESA e por ORIGEM: é o que separa um do outro.
--
-- `fat_saldo` fica FORA: não tem cc_id. O balancete é por conta, empresa,
-- filial, ano e mês — então o Balanço não é recortável por centro de custo,
-- só por empresa/filial. Presumi o contrário e a consulta quebrou.
--
-- Só leitura. Uma consulta só.
-- ============================================================
with orc as (
  select 'fat_orcado' as tabela, f.origem, e.codigo as empresa, f.ano,
         count(*) as linhas, round(sum(f.valor), 2) as valor
    from fat_orcado f join empresa e on e.id = f.empresa_id
   where f.cc_id is null group by 1,2,3,4
),
real as (
  select 'fat_realizado', f.origem, e.codigo, f.ano, count(*), round(sum(f.valor), 2)
    from fat_realizado f join empresa e on e.id = f.empresa_id
   where f.cc_id is null group by 1,2,3,4
),
fol as (
  select 'fat_folha', f.tipo, e.codigo, f.ano, count(*), round(sum(f.valor), 2)
    from fat_folha f join empresa e on e.id = f.empresa_id
   where f.cc_id is null group by 1,2,3,4
),
tudo as (select * from orc union all select * from real union all select * from fol)
select '1 · total por tabela'                        as secao,
       t.tabela                                       as a,
       ''                                             as b,
       ''                                             as c,
       sum(t.linhas)::text || ' linha(s)'             as d,
       to_char(sum(t.valor), 'FM999G999G990D00')      as e
  from tudo t group by t.tabela
union all
select '2 · por tabela · origem · empresa',
       t.tabela, t.origem, t.empresa,
       sum(t.linhas)::text || ' linha(s) · ' || count(distinct t.ano) || ' ano(s)',
       to_char(sum(t.valor), 'FM999G999G990D00')
  from tudo t group by t.tabela, t.origem, t.empresa
union all
-- A pergunta que decide se o nulo é legítimo: a empresa tem ALGUM lançamento
-- COM centro de custo? Se nunca teve, é ERP que não manda a dimensão.
select '3 · a empresa já usou CC alguma vez?',
       e.codigo, coalesce(e.descricao, ''), '',
       (select count(*)::text from fat_realizado r where r.empresa_id = e.id and r.cc_id is not null) || ' lanç. COM cc',
       case when (select count(*) from fat_realizado r where r.empresa_id = e.id and r.cc_id is not null) = 0
            then '⚠ NUNCA teve CC → nulo é legítimo, do ERP de origem'
            else '✓ usa CC → nulo aqui é falha de carga' end
  from empresa e
 where exists (select 1 from fat_realizado r where r.empresa_id = e.id and r.cc_id is null)
union all
-- ⚠ A HIPÓTESE QUE DECIDE TUDO. 562 mil de 1,07 milhão de linhas do razão não
-- têm CC — 53%. Se forem contas de BALANÇO (banco, fornecedores, duplicatas),
-- isso é normal: balanço não tem centro de custo, e "zero CC nulo" seria uma
-- meta impossível. Se houver muita conta de RESULTADO sem CC, aí sim é falha.
--
-- A natureza vem da conta ORÇAMENTÁRIA amarrada (conta_linha → master), que é
-- o que a DRE usa. Conta sem amarração não entra na DRE de jeito nenhum.
select '4 · o CC nulo do razão é balanço ou resultado?',
       coalesce(co.natureza, '(conta SEM amarração)'),
       '', '',
       count(*)::text || ' linha(s)',
       case when co.natureza in ('RECEITA','DESPESA')
            then '⚠ conta de RESULTADO sem CC → entra na DRE e some do usuário restrito'
            else 'balanço ou sem amarração → não aparece na DRE' end
  from fat_realizado f
  left join lateral (
    select c.linha_id from conta_linha c where c.conta_id = f.conta_id order by c.id desc limit 1
  ) cl on true
  left join conta_orcamentaria co on co.id = cl.linha_id
 where f.cc_id is null
 group by co.natureza
 order by 1, 5 desc;
