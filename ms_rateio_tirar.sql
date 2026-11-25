-- ============================================================
-- MS fora do rateio — tira a empresa 06 dos destinos e renormaliza para 100.
-- Rode no SQL Editor. **Re-executável** (ver abaixo). Termina em SELECT.
--
-- CONTEXTO: estudo de venda da unidade Mato Grosso do Sul. As 15 pessoas
-- lotadas em 06 vão com a unidade, então o quadro não muda — o que muda é
-- quem absorve a parte que MS carregava do custo compartilhado (CSC, RH,
-- diretoria): hoje 06 leva de 2,48% a 20% conforme a regra.
--
-- ⚠⚠ ISTO MUDA CADASTRO GLOBAL, NÃO UMA VERSÃO. `rateio_regra` não é por
-- versão (a coluna `versao_id` existe e o Aplicar nem a lê), então enquanto
-- este script estiver aplicado **todo Aplicar usa os rateios SEM MS** — em
-- qualquer versão. Por isso a ordem importa:
--     1. aplicar e **FECHAR** (bloquear) Orçado2027 e ORCADO2027_PRELIM
--     2. duplicar Orçado2027 → 2027_SEM_MS
--     3. rodar ESTE script
--     4. aplicar o quadro na 2027_SEM_MS
--     5. rodar `ms_rateio_voltar.sql`
-- O passo 1 é o que impede uma reaplicação futura de reescrever as versões
-- "com MS" usando os percentuais sem MS — em silêncio, porque o Aplicar não
-- registra quais regras usou.
--
-- ⚠ RE-EXECUTÁVEL porque os percentuais novos são calculados **a partir do
-- BACKUP**, nunca do estado atual. Recalcular sobre o já-renormalizado daria
-- outro número a cada execução, e o erro seria invisível.
--
-- ⚠ O resíduo do arredondamento vai para a MAIOR cota, mês a mês — é a regra
-- que o rateio do drill e o Aplicar do posto já usam. Sem isso `100 ÷ 3` vira
-- 99,99, e **o sistema não valida essa soma**.
--
-- ⚠ No SQL Editor `current_tenant_id()` é NULO, então nada aqui filtra por
-- tenant: o recorte são as regras que TÊM destino em 06.
-- ============================================================

-- ── 1 · backup, uma vez só ──────────────────────────────────────────────
-- Guarda o estado ORIGINAL dos destinos das regras tocadas. É o que torna o
-- script re-executável e o `voltar` exato — repor por números digitados à mão
-- seria repor o que eu medi, não o que estava lá.
CREATE TABLE IF NOT EXISTS bkp_rateio_ms (
  id uuid PRIMARY KEY, regra_id uuid, empresa_id uuid, filial_id uuid, cc_id uuid,
  pct numeric, criado_em timestamptz DEFAULT now()
);

INSERT INTO bkp_rateio_ms (id, regra_id, empresa_id, filial_id, cc_id, pct)
SELECT rd.id, rd.regra_id, rd.empresa_id, rd.filial_id, rd.cc_id, rd.pct
  FROM rateio_destino rd
 WHERE rd.regra_id IN (
   SELECT DISTINCT x.regra_id FROM rateio_destino x
     JOIN empresa e ON e.id = x.empresa_id WHERE e.codigo = '06')
   AND NOT EXISTS (SELECT 1 FROM bkp_rateio_ms b WHERE b.id = rd.id);

-- ── 2 · renormaliza os que FICAM, a partir do backup ────────────────────
WITH base AS (
  SELECT b.id, b.regra_id, b.pct, (e.codigo = '06') AS e_ms
    FROM bkp_rateio_ms b JOIN empresa e ON e.id = b.empresa_id
), soma AS (
  SELECT regra_id, sum(pct) FILTER (WHERE NOT e_ms) AS fica FROM base GROUP BY regra_id
), calc AS (
  SELECT b.id, b.regra_id, round(b.pct * 100 / s.fica, 2) AS novo,
         -- ⚠ desempate por `id`: a RATEMP07 tem percentuais repetidos (dois
         -- CCs com metade cada), e sem desempate o resíduo cairia num deles ao
         -- acaso, mudando o resultado entre execuções.
         row_number() OVER (PARTITION BY b.regra_id ORDER BY b.pct DESC, b.id) AS rn
    FROM base b JOIN soma s ON s.regra_id = b.regra_id
   WHERE NOT b.e_ms
), resid AS (
  SELECT regra_id, 100 - sum(novo) AS sobra FROM calc GROUP BY regra_id
)
UPDATE rateio_destino rd
   SET pct = c.novo + CASE WHEN c.rn = 1 THEN r.sobra ELSE 0 END
  FROM calc c JOIN resid r ON r.regra_id = c.regra_id
 WHERE rd.id = c.id;

-- ── 3 · tira os destinos de MS ──────────────────────────────────────────
-- Apaga em vez de zerar: destino com 0% faria a cascata gerar célula de valor
-- zero, e `fat_orcado` guarda ausência, não zero.
DELETE FROM rateio_destino rd
 USING empresa e
 WHERE rd.empresa_id = e.id AND e.codigo = '06'
   AND rd.regra_id IN (SELECT DISTINCT regra_id FROM bkp_rateio_ms);

-- ---------------- conferência ----------------
-- ⚠ Mede EFEITO: a soma POR REGRA tem de ser 100,00 em todas. Qualquer linha
-- marcada ⛔ significa que o rateio daquela regra passou a criar ou destruir
-- dinheiro — e nenhuma tela acusaria isso.
SELECT rr.nome AS regra,
       CASE WHEN round(sum(rd.pct), 2) = 100 THEN 'ok' ELSE '⛔ NÃO SOMA 100' END AS confere,
       round(sum(rd.pct), 2) AS soma,
       count(*) FILTER (WHERE e.codigo = '06') AS ainda_tem_ms,
       string_agg(coalesce(e.codigo, '?') || '=' || rd.pct::text, ' · ' ORDER BY rd.pct DESC) AS destinos
  FROM rateio_regra rr
  JOIN rateio_destino rd ON rd.regra_id = rr.id
  LEFT JOIN empresa e ON e.id = rd.empresa_id
 WHERE rr.id IN (SELECT DISTINCT regra_id FROM bkp_rateio_ms)
 GROUP BY rr.nome
 ORDER BY rr.nome;
