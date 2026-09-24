-- ============================================================
-- SONDA — as linhas do Choite na fat_folha, como estão gravadas
--
-- O diagnóstico anterior disse que os 25 divergentes têm desconto ZERO, mas o
-- CSV mostra a verba 549 CONVENIO MEDICO (Desconto, 2.736,63) para o 900048.
-- Uma das duas coisas é falsa. Esta sonda mostra a linha como ela está no
-- banco, sem interpretação no meio.
--
-- Responde com ERROR (ver diagnostico_terceiro_desconto.sql para o porquê).
-- Só leitura.
-- ============================================================
DO $diag$
DECLARE uid uuid; r record; txt text := '';
BEGIN
  SELECT user_id INTO uid FROM user_tenant WHERE role = 'admin' LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  IF current_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'TESTE INVÁLIDO: current_tenant_id() nulo';
  END IF;

  FOR r IN
    SELECT ff.verba_cod, ff.tipo_verba, ff.conta_deb_cod, ff.valor,
           (ff.conta_id IS NULL) AS conta_nao_resolvida,
           coalesce(ff.lote, '(nulo)') AS lote
      FROM fat_folha ff
     WHERE ff.tenant_id = current_tenant_id() AND ff.tipo = 'REALIZADO'
       AND ff.ano = 2026 AND ff.mes = 8 AND ff.matricula = '900048'
     ORDER BY ff.verba_cod
  LOOP
    txt := txt || format('[%s tipo="%s" deb=%s val=%s%s lote=%s] ',
      r.verba_cod, r.tipo_verba, coalesce(r.conta_deb_cod,'-'),
      to_char(r.valor,'FM999G990D00'),
      CASE WHEN r.conta_nao_resolvida THEN ' CONTA-NAO-RESOLVIDA' ELSE '' END,
      r.lote);
  END LOOP;

  IF txt = '' THEN
    RAISE EXCEPTION 'Matricula 900048 nao tem NENHUMA linha em fat_folha 2026/08';
  END IF;

  -- os valores DISTINTOS de tipo_verba no mês, para ver a grafia real
  RAISE EXCEPTION 'CHOITE: % || TIPOS NO MES: %', txt,
    (SELECT string_agg(DISTINCT format('"%s"(%s)', coalesce(tipo_verba,'(nulo)'), n), ', ')
       FROM (SELECT tipo_verba, count(*) AS n FROM fat_folha
              WHERE tenant_id = current_tenant_id() AND tipo = 'REALIZADO'
                AND ano = 2026 AND mes = 8 GROUP BY 1) t);
END
$diag$;
