-- ============================================================
-- Devolve os rateios ao estado COM MS. Par do `ms_rateio_tirar.sql`.
-- Rode no SQL Editor. **Re-executável**. Termina em SELECT.
--
-- ⚠⚠ RODE ISTO LOGO DEPOIS DE APLICAR a versão sem MS. Enquanto o `tirar`
-- estiver em vigor, **todo Aplicar** — de qualquer versão — usa os rateios sem
-- MS. As versões já FECHADAS estão protegidas (o banco recusa escrita em
-- versão bloqueada, v3_190); as abertas, não.
--
-- ⚠ Repõe do BACKUP, não de números digitados: repor o que eu medi seria
-- repor a minha leitura, não o que estava lá. O `id` original é reusado no
-- re-insert, então nada que aponte para essas linhas se perde.
--
-- ⚠ O backup NÃO é apagado no fim, de propósito: ele é o registro do estado
-- anterior e o que mantém o `tirar` re-executável. Apague à mão quando o
-- estudo terminar — e aí o próximo `tirar` tira um retrato novo.
-- ============================================================

-- ── 1 · devolve o percentual de quem ficou ──────────────────────────────
UPDATE rateio_destino rd
   SET pct = b.pct
  FROM bkp_rateio_ms b
 WHERE rd.id = b.id AND rd.pct IS DISTINCT FROM b.pct;

-- ── 2 · recria os destinos de MS que foram apagados ─────────────────────
INSERT INTO rateio_destino (id, regra_id, empresa_id, filial_id, cc_id, pct)
SELECT b.id, b.regra_id, b.empresa_id, b.filial_id, b.cc_id, b.pct
  FROM bkp_rateio_ms b
 WHERE NOT EXISTS (SELECT 1 FROM rateio_destino rd WHERE rd.id = b.id);

-- ---------------- conferência ----------------
-- ⚠ Três perguntas, nesta ordem: voltou a somar 100? MS voltou? e sobrou
-- alguma diferença contra o backup? A terceira é a que pega um `tirar` rodado
-- depois de alguém ter mexido no cadastro à mão.
SELECT '1·por regra' AS secao,
       (SELECT string_agg(nome || ': soma ' || soma::text || CASE WHEN ms > 0 THEN ' · MS ok' ELSE ' ⛔ SEM MS' END
                          || CASE WHEN soma = 100 THEN '' ELSE '  ⛔ NÃO SOMA 100' END, E'\n   ' ORDER BY nome)
          FROM (SELECT rr.nome, round(sum(rd.pct), 2) soma,
                       count(*) FILTER (WHERE e.codigo = '06') ms
                  FROM rateio_regra rr JOIN rateio_destino rd ON rd.regra_id = rr.id
                  LEFT JOIN empresa e ON e.id = rd.empresa_id
                 WHERE rr.id IN (SELECT DISTINCT regra_id FROM bkp_rateio_ms)
                 GROUP BY rr.nome) x) AS resultado
UNION ALL
SELECT '2·diferenças contra o backup (deve ser nenhuma)',
       coalesce((SELECT string_agg(coalesce(e.codigo, '?') || ': ' || rd.pct::text || ' ≠ ' || b.pct::text, ' | ')
                   FROM bkp_rateio_ms b JOIN rateio_destino rd ON rd.id = b.id
                   LEFT JOIN empresa e ON e.id = rd.empresa_id
                  WHERE rd.pct IS DISTINCT FROM b.pct), 'nenhuma — estado idêntico ao backup')
UNION ALL
SELECT '3·quando o backup foi tirado',
       (SELECT to_char(min(criado_em), 'DD/MM/YYYY HH24:MI') FROM bkp_rateio_ms)
ORDER BY 1;
