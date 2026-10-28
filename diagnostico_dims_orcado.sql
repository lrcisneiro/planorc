-- ============================================================
-- fat_orcado tem 136 MB para 101 mil linhas (1,3 KB/linha) e o uq_fat_orcado,
-- que indexa (dims::text), tem 83 MB. Quanto disso é o `dims`?
-- Uma consulta só, responde por SELECT, sem filtro de tenant (roda como postgres).
-- ============================================================
WITH t AS (
  SELECT fo.dims, length(fo.dims::text) len,
         coalesce(v.codigo, '(sem versão)') ver
  FROM fat_orcado fo LEFT JOIN versao_orcamento v ON v.id = fo.versao_id
),
porver AS (
  SELECT ver, count(*) n, round(avg(len)) media, max(len) maxi,
         pg_size_pretty(sum(len)) total
  FROM t GROUP BY ver
),
chaves AS (
  -- jsonb_object_keys levanta erro se o dims for escalar ou JSON null, em vez
  -- de devolver zero linhas; o filtro por jsonb_typeof evita derrubar tudo.
  SELECT k, count(*) n, round(avg(length(dims->>k))) media_val, max(length(dims->>k)) max_val
  FROM t, jsonb_object_keys(dims) k WHERE jsonb_typeof(dims) = 'object' GROUP BY k
),
maior AS (
  SELECT left(dims::text, 400) amostra, len FROM t ORDER BY len DESC LIMIT 1
)
SELECT '1 · dims por versão' secao, ver a, n::text b, 'media=' || media c, 'max=' || maxi d, 'soma=' || total e
  FROM porver
UNION ALL
SELECT '2 · chaves do dims', k, n::text, 'media=' || coalesce(media_val::text,'-'), 'max=' || coalesce(max_val::text,'-'), ''
  FROM chaves
UNION ALL
SELECT '3 · maior dims', left(amostra, 200), len::text, '', '', '' FROM maior
ORDER BY 1, 3 DESC;
