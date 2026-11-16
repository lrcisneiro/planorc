-- ============================================================
-- SEED — regime BR-ESTAGIO
--
-- POR QUE EXISTE: os três postos de estágio estavam como BR-CLT, então o motor
-- cobrava deles INSS patronal, FGTS, 13º, férias e o 1/3 — 60,04% sobre a base
-- que a Lei 11.788/2008 diz não existir, porque estágio não gera vínculo
-- empregatício (art. 3º). A PLR do seed de 17/nov os alcançou pela mesma razão.
-- Eram R$ 31,3 mil a mais em 2027 sobre uma base de R$ 49,2 mil.
--
-- O realizado já dizia: a folha paga a bolsa na verba 075, não na 001 do
-- salário CLT, e não tem uma única linha de encargo.
--
-- O MOTOR NÃO MUDA. `verbasDoRegime()` já filtra pela lista de regimes de cada
-- verba e não tem nenhum 'BR-CLT' escrito dentro. Isto aqui é cadastro.
--
-- O QUE O ESTÁGIO CUSTA, pela lei:
--   · bolsa-auxílio (art. 12)
--   · recesso de 30 dias remunerado por ano (art. 13) — análogo às férias,
--     ⚠ SEM o 1/3 constitucional, que é direito de empregado
--   · seguro contra acidentes pessoais (art. 9º, IV) — obrigatório, da empresa
--   e nada mais: sem INSS patronal, FGTS, 13º, férias, aviso ou multa de 40%.
--
-- DECISÕES DESTA INSTALAÇÃO (respostas do Ricardo, 17/nov):
--   · auxílio-transporte: NÃO entra como verba própria. A 643 é o transporte e
--     já passa pelo cartão (D50), que os estagiários recebem — criar linha
--     nova contaria o mesmo dinheiro duas vezes.
--   · agente de integração: não há.
--   · seguro: pago pela empresa, R$ 60,00 POR ANO → 5,00/mês no VALOR_FIXO.
--     ⚠ Se os 60 forem mensais, é só trocar o valor no cadastro do posto.
--
-- Re-executável. Termina em SELECT.
-- ============================================================

WITH t AS (SELECT id FROM tenant ORDER BY criado_em LIMIT 1),
c101 AS (SELECT id FROM conta_orcamentaria WHERE codigo='20101' AND tenant_id=(SELECT id FROM t)),
c201 AS (SELECT id FROM conta_orcamentaria WHERE codigo='20201' AND tenant_id=(SELECT id FROM t)),
-- ── 1. as verbas do regime ────────────────────────────────────────────────
nova AS (
  INSERT INTO verba_folha (tenant_id, codigo, descricao, tipo_calculo, parametro,
                           regime, categoria, incide_encargos, mantem_afastado,
                           conta_destino_id, ordem, ativo)
  SELECT (SELECT id FROM t), x.cod, x.descr, x.calc, x.par, 'BR-ESTAGIO', x.cat,
         x.enc, x.afast, x.conta, x.ord, true
    FROM (VALUES
      -- A BASE É A 075, e não se reusa a 001: a folha paga a bolsa nesse
      -- código, e a conciliação Contábil × Folha compara código com código.
      -- Chamar a base de "001" acusaria divergência nos dois sentidos ao mesmo
      -- tempo, para sempre.
      ('075', 'Bolsa-auxílio (estágio)',            'BASE',          NULL,
       'SALARIO',   true,  true,  (SELECT id FROM c101), 10),
      -- Recesso: mesma forma do 13º, parâmetro 1, SEM o 1/3. É provisão — o
      -- direito se forma mês a mês e quem sai antes de um ano recebe
      -- proporcional (art. 13, §2º), então provisionar desde o 1º mês é o
      -- tratamento correto, não conservadorismo.
      ('A13E','Recesso remunerado (30d/ano)',       'PROVISAO_1_12', 1,
       'PROVISOES', false, false, (SELECT id FROM c101), 50),
      -- Obrigatório por lei e da empresa. VALOR_FIXO porque é prêmio de
      -- apólice, não percentual de nada.
      ('A52E','Seguro de acidentes pessoais',       'VALOR_FIXO',    NULL,
       'BENEFICIOS',false, true,  (SELECT id FROM c201), 160),
      -- INFORMATIVA: não entra no cálculo, existe para a conciliação parar de
      -- ver código desconhecido na folha. Era a pergunta 4.
      ('643', 'Auxílio Transporte',                 'INFORMATIVA',   NULL,
       NULL,        true,  true,  (SELECT id FROM c201), 530)
    ) AS x(cod, descr, calc, par, cat, enc, afast, conta, ord)
  ON CONFLICT (tenant_id, codigo) DO UPDATE
    SET descricao = EXCLUDED.descricao, tipo_calculo = EXCLUDED.tipo_calculo,
        parametro = EXCLUDED.parametro, regime = EXCLUDED.regime,
        categoria = EXCLUDED.categoria, incide_encargos = EXCLUDED.incide_encargos,
        conta_destino_id = EXCLUDED.conta_destino_id, ativo = true
  RETURNING id, codigo
),
-- ── 2. o que o regime novo HERDA ──────────────────────────────────────────
-- ⚠ O modo de falha deste desenho é o silêncio: verba que não lista o regime
-- simplesmente some da cascata, sem erro. Os estagiários recebem D50 de fato
-- (R$ 350/mês cada no realizado de outubro) — esquecer esta linha tiraria
-- R$ 4.200/ano do orçado caladamente.
herda AS (
  UPDATE verba_folha SET regime = regime || ',BR-ESTAGIO'
   WHERE tenant_id = (SELECT id FROM t) AND codigo = 'D50'
     AND regime NOT LIKE '%BR-ESTAGIO%'
  RETURNING codigo
),
-- ── 3. os postos mudam de regime ──────────────────────────────────────────
postos AS (
  UPDATE posto p SET regime = 'BR-ESTAGIO'
    FROM cargo c
   WHERE c.id = p.cargo_id AND p.tenant_id = (SELECT id FROM t)
     AND upper(c.nome) LIKE '%ESTAG%' AND p.ativo IS NOT FALSE
  RETURNING p.id
),
-- ── 4. a PLR sai ──────────────────────────────────────────────────────────
-- Trocar o regime já a torna inerte (o filtro a descarta), mas linha morta em
-- tabela de VALOR é a que volta a viver quando alguém reclassifica o posto
-- meses depois e ninguém lembra por que ela estava lá.
plr AS (
  DELETE FROM posto_verba pv USING verba_folha v
   WHERE v.id = pv.verba_id AND v.codigo = '063'
     AND pv.posto_id IN (SELECT id FROM postos)
  RETURNING pv.posto_id
)
-- ── 5. o seguro anexado a cada posto ──────────────────────────────────────
-- ⚠ Lê o id de `nova`, NÃO de `verba_folha`: todo sub-comando de um WITH vê o
-- MESMO snapshot, então um SELECT na tabela aqui não enxergaria a verba que a
-- CTE acabou de inserir — e o INSERT gravaria zero linha, sem erro. O
-- `ON CONFLICT ... RETURNING` faz a CTE devolver o id também na re-execução.
INSERT INTO posto_verba (tenant_id, posto_id, verba_id, valor, ativo)
SELECT (SELECT id FROM t), p.id, n.id, 5.00, true
  FROM postos p, nova n
 WHERE n.codigo = 'A52E'
ON CONFLICT (posto_id, verba_id) DO UPDATE SET valor = EXCLUDED.valor, ativo = true;

-- ---------------- conferência ----------------
SELECT 'postos em BR-ESTAGIO' AS secao,
       (SELECT count(*)::text || ' · bolsa ' || round(sum(salario_base),2)::text
          FROM posto WHERE regime='BR-ESTAGIO' AND ativo IS NOT FALSE) AS resultado
UNION ALL
SELECT 'verbas do regime (entram na cascata)',
       (SELECT string_agg(codigo, ' · ' ORDER BY ordem) FROM verba_folha
         WHERE ativo AND tipo_calculo <> 'INFORMATIVA'
           AND (regime IS NULL OR regime LIKE '%BR-ESTAGIO%'))
UNION ALL
SELECT 'nenhum encargo CLT alcança o estágio?',
       (SELECT CASE WHEN count(*)=0 THEN 'correto' ELSE '⛔ ' || string_agg(codigo,',') END
          FROM verba_folha WHERE ativo AND codigo IN ('A48','A50','A49','A09','A30','A90','A36','A31','A37','A32','A38','063')
           AND (regime IS NULL OR regime LIKE '%BR-ESTAGIO%'))
UNION ALL
SELECT 'PLR removida dos estagiários',
       (SELECT CASE WHEN count(*)=0 THEN 'correto' ELSE '⛔ ' || count(*)::text END
          FROM posto_verba pv JOIN verba_folha v ON v.id=pv.verba_id JOIN posto p ON p.id=pv.posto_id
         WHERE v.codigo='063' AND p.regime='BR-ESTAGIO')
UNION ALL
SELECT 'verbas anexadas a cada estagiário',
       (SELECT string_agg(DISTINCT v.codigo, ' · ') FROM posto_verba pv
          JOIN verba_folha v ON v.id=pv.verba_id JOIN posto p ON p.id=pv.posto_id
         WHERE p.regime='BR-ESTAGIO');
