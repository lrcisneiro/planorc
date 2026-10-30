-- ============================================================
-- Os lançamentos que escaparam da conversão — os três, lado a lado
--
-- CORREÇÃO do que este arquivo dizia antes: o razão do exterior ESTÁ
-- convertido. A conclusão anterior ("o plano inteiro está em guarani") saiu do
-- NOME de uma conta — `BANCO ITAU GUARANI` — e nome não é prova. Os números
-- desmentem: `SUELDOS Y JORNALES` soma −695.060 em 190 lançamentos (em guarani
-- seriam R$ 600 de salário no ano) e `CAJA GENERAL GUARANI` soma −3.381 em 44.
-- São valores de REAL.
--
-- O que existe são lançamentos ISOLADOS fora de escala, e os três têm a mesma
-- assinatura: um gigante no meio de centenas de pequenos.
--
--   PY 1304    RESULTADO POR DIFERENCIA DE CAMBIO   12.857.665,55   1 de 1
--   PY 01010120 / 01010121  (o MESMO valor nas duas) 149.972.690,71  1 de 725/379
--   PY 02010101 PROVEEDORES LOCALES                  13.460.908,14   1 de 1.368
--
-- Só o 1304 toca a DRE — as outras duas contas são de balanço e não estão
-- amarradas. As outras duas ainda assim importam para o BALANÇO, que lê
-- fat_saldo, e por isso entram aqui.
--
-- O 149.972.690,71 aparecer IDÊNTICO em duas contas (a de guarani e a de
-- dólar) diz que é UM lançamento de transferência com as duas pontas — o que
-- torna "valor não convertido" bem mais provável que "operação real".
--
-- O histórico é o que falta para fechar o caso: ele costuma trazer o número do
-- documento e a descrição da origem.
--
-- Sem filtro de tenant: no SQL Editor o current_tenant_id() é NULL.
-- Só leitura. Uma consulta só.
-- ============================================================
select cco.codigo                                   as conta,
       cco.descricao                                as conta_nome,
       e.codigo                                     as empresa,
       coalesce(f.codigo, '(sem filial)')           as filial,
       fr.ano || '/' || lpad(fr.mes::text, 2, '0')  as competencia,
       to_char(fr.valor, 'FM999G999G999G990D00')    as valor,
       fr.origem || ' · lote ' || coalesce(fr.lote, '—')
         || ' · sublote ' || coalesce(fr.sublote, '—')         as carga,
       coalesce(fr.dims->>'historico', '(sem histórico)')      as historico,
       coalesce(fr.dims->>'documento', fr.dims->>'doc', '—')   as documento,
       fr.criado_em                                 as importado_em
  from fat_realizado fr
  join conta_contabil cco on cco.id = fr.conta_id
  join empresa e          on e.id  = fr.empresa_id
  left join filial f      on f.id  = fr.filial_id
 where fr.ano = 2026
   and abs(fr.valor) > 1000000        -- a escala que separa carga de operação
   and cco.plano_id in (select id from plano_contas where nome not ilike '%protheus top%')
 order by abs(fr.valor) desc;
