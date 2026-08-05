-- ============================================================
-- Folha F5 — regime prefixado por PAÍS (BR-CLT, PY-IPS, …).
--
-- Motivo: os regimes de países diferentes se confundiam no seletor (BR
-- 'PRESTADOR' × PY 'CONTRATO'). Passam a ser namespaced por país no VALOR:
--   BR: BR-CLT | BR-PRESTADOR | BR-PROLABORE
--   PY: PY-IPS | PY-CONTRATO
-- O motor compara regime por string (sem valores fixos), então só precisa que
-- posto.regime e verba_folha.regime usem o MESMO valor prefixado.
--
-- Este backfill prefixa os dados JÁ existentes (hoje: postos/verbas BR + as
-- verbas PY do v3_076). Idempotente: só toca regimes SEM '-' (não prefixados).
-- ============================================================

-- posto: prefixa com o país da empresa do posto (relación posto→empresa→pais)
UPDATE posto p SET regime = e.pais || '-' || p.regime
FROM empresa e
WHERE p.empresa_id = e.id
  AND p.regime IS NOT NULL AND p.regime <> '' AND p.regime NOT LIKE '%-%'
  AND e.pais IS NOT NULL AND e.pais <> '';

-- fallback: posto cuja empresa está sem país → assume BR (todos os atuais são BR)
UPDATE posto SET regime = 'BR-' || regime
WHERE regime IS NOT NULL AND regime <> '' AND regime NOT LIKE '%-%';

-- verba_folha: regime é LISTA separada por vírgula → prefixa cada token com o
-- país da verba (COALESCE p/ BR se a verba for compartilhada sem país).
UPDATE verba_folha SET regime = (
  SELECT string_agg(COALESCE(pais, 'BR') || '-' || trim(tok), ',')
  FROM unnest(string_to_array(regime, ',')) AS tok
  WHERE trim(tok) <> ''
)
WHERE regime IS NOT NULL AND regime <> '' AND regime NOT LIKE '%-%';
