-- ============================================================
-- SEED — a verba PLR no catálogo do orçamento
--
-- Desenho em docs/DESIGN_plr.md · mecanismo em schema_v3_187_plr_parcelas.sql.
-- ⚠ RODE A v3_187 ANTES: sem ela o `tipo_calculo = 'PARCELAS'` é recusado pelo
-- CHECK e a coluna `calendario` não existe.
--
-- Cada campo abaixo é uma decisão, não um default:
--
-- `incide_encargos = false` — É A ISENÇÃO LEGAL INTEIRA. A Lei 10.101/2000 tira
--   a PLR de INSS (patronal e empregado), FGTS, 13º, férias e aviso prévio. No
--   motor, a verba deixa de somar na `baseEncargos`, que é sobre o que
--   `PCT_BASE` e `PROVISAO_1_12` calculam. Marcar isto por engano criaria
--   encargo que a lei não cobra, inflando a folha orçada.
--
-- `regime = 'BR-CLT'` — decisão do Ricardo e confirmada no dado: as 159 pessoas
--   que receberam PLR em 2026 são todas CLT.
--
-- `calendario = '3:50;6:50'` — foi o calendário DE 2026 (março e junho, o
--   mínimo legal de um trimestre). ⚠ EM 2024 E 2025 FORAM MARÇO E SETEMBRO:
--   confira o ano que está orçando antes de aplicar, porque o motor distribui
--   por este campo e ninguém percebe um mês errado olhando o total do ano.
--
-- `conta_destino` 20101 "Salarios e Ordenados" — é para onde o ERP manda
--   (`srv.csv`: a verba 063 aponta ID_ITEMORC 20101). PLR é remuneração, não
--   benefício; mandá-la para 20201 faria o orçado divergir do razão na linha.
--
-- `ordem = 16` — logo depois da remuneração variável (623, ordem 15). Não muda
--   conta nenhuma aqui, porque verba que não incide encargo não entra na base;
--   é só leitura da memória de cálculo.
--
-- ⚠ O VALOR POR PESSOA NÃO VEM DAQUI. Ele mora em `posto_verba` e entra pela
-- importação de postos, com a coluna `063` — ver `scripts/gerar_plr.py`.
--
-- Re-executável. Termina em SELECT.
-- ============================================================

INSERT INTO verba_folha
  (tenant_id, codigo, descricao, tipo_calculo, calendario, incide_encargos,
   regime, ordem, conta_destino_id, categoria, ativo)
SELECT t.id, '063', 'PLR — participação nos lucros', 'PARCELAS', '3:50;6:50', false,
       'BR-CLT', 16,
       (SELECT c.id FROM conta_orcamentaria c WHERE c.tenant_id = t.id AND c.codigo = '20101'),
       'SALARIO', true
  FROM (SELECT id FROM tenant ORDER BY criado_em LIMIT 1) t
ON CONFLICT (tenant_id, codigo) DO UPDATE SET
  tipo_calculo    = EXCLUDED.tipo_calculo,
  calendario      = EXCLUDED.calendario,
  incide_encargos = EXCLUDED.incide_encargos,
  regime          = EXCLUDED.regime,
  ativo           = true;

-- ---------------- conferência ----------------
SELECT 'verba 063' AS secao,
       coalesce((SELECT v.descricao || ' · ' || v.tipo_calculo || ' · calendário ' || coalesce(v.calendario,'(vazio)')
                   FROM verba_folha v WHERE v.codigo = '063'), '⛔ não entrou') AS resultado
UNION ALL
SELECT 'isenta de encargos?',
       (SELECT CASE WHEN incide_encargos THEN '⛔ NÃO — marque incide_encargos = false'
                    ELSE 'sim (não entra na base de INSS/FGTS/13º/férias)' END
          FROM verba_folha WHERE codigo = '063')
UNION ALL
SELECT 'calendário legível pelo motor',
       (SELECT CASE WHEN calendario ~ '^([1-9]|1[0-2]):[0-9]+(\.[0-9]+)?(;([1-9]|1[0-2]):[0-9]+(\.[0-9]+)?)*$'
                    THEN 'sim' ELSE '⛔ formato inválido' END FROM verba_folha WHERE codigo = '063')
UNION ALL
SELECT 'parcelas somam 100%?',
       (SELECT CASE WHEN sum(split_part(p, ':', 2)::numeric) = 100
                    THEN 'sim (' || count(*) || ' parcela(s))'
                    ELSE '⛔ somam ' || sum(split_part(p, ':', 2)::numeric) || '%' END
          FROM verba_folha v, unnest(string_to_array(v.calendario, ';')) p
         WHERE v.codigo = '063')
UNION ALL
SELECT 'intervalo entre as parcelas',
       (SELECT CASE WHEN count(*) < 2 THEN 'parcela única'
                    WHEN max(m) - min(m) >= 3 THEN (max(m) - min(m)) || ' meses (legal: mínimo 3)'
                    ELSE '⛔ ' || (max(m) - min(m)) || ' meses — a lei exige um trimestre civil' END
          FROM verba_folha v, unnest(string_to_array(v.calendario, ';')) p,
               LATERAL (SELECT split_part(p, ':', 1)::int AS m) x
         WHERE v.codigo = '063')
UNION ALL
SELECT 'pessoas com valor cadastrado',
       (SELECT count(*)::text || ' posto(s) · ' || coalesce(round(sum(pv.valor),2)::text,'0')
          FROM posto_verba pv JOIN verba_folha v ON v.id = pv.verba_id WHERE v.codigo = '063');
