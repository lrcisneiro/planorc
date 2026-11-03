-- ============================================================
-- v3_163 — Folha REALIZADA não tem versão, e a política a escondia
--
-- Sintoma: a tela *Folha realizada* vinha VAZIA para quem não é admin. Não era
-- falta de dado — são 22.698 linhas — nem o escopo PESSOAS da v3_162.
--
-- A causa está na forma do predicado de versão, desde a v3_137:
--
--     (escopo_versao() IS NULL OR (versao_id IS NOT NULL AND versao_id = ANY(...)))
--
-- O `versao_id IS NOT NULL` existe para que linha sem dimensão não escape de um
-- recorte — raciocínio certo para empresa, filial e CC, onde nulo é lacuna de
-- cadastro. Mas em `fat_folha` o nulo **não é lacuna, é o significado**:
-- `tipo = 'REALIZADO'` é o que a folha pagou, e o que foi pago não pertence a
-- nenhuma versão de orçamento. Medido: REALIZADO = 22.698 linhas, **todas** sem
-- versão; ORCADO = 42.827, **todas** com versão. A correlação é perfeita.
--
-- Logo, quem tem QUALQUER regra de versão via zero folha realizada — e com ela
-- ia junto a conciliação inteira, que é o propósito da tela. Ficou invisível
-- porque só morde quem não é admin, e quem desenvolve costuma ser admin.
--
-- Conserto: na folha, nulo PASSA no recorte de versão. Os outros três
-- (empresa, filial, CC — hoje em PESSOAS) continuam intactos, então ninguém
-- enxerga folha de área alheia; o que volta é o realizado da área dele.
--
-- ⚠ Vale para INSERT também, e por isso não é só leitura: importar folha
-- realizada grava `versao_id` nulo, e a política de escrita recusava a carga de
-- quem tivesse recorte de versão — um `INSERT` barrado por RLS levanta `42501`,
-- mas dentro de um lote grande ninguém liga o erro à causa.
--
-- `fat_orcado` fica como está: lá `versao_id` nulo não existe (0 linhas) e a
-- exigência é uma guarda legítima — orçado sem versão seria defeito.
--
-- Termina em SELECT. Prova por personificação em `prova_escopo_pessoas.sql`.
-- ============================================================

DROP POLICY IF EXISTS fat_folha_sel ON fat_folha;
CREATE POLICY fat_folha_sel ON fat_folha FOR SELECT TO authenticated USING (
  tenant_id = (SELECT current_tenant_id())
  AND ((SELECT escopo_empresa_pessoas()) IS NULL OR (empresa_id IS NOT NULL AND empresa_id = ANY((SELECT escopo_empresa_pessoas())::uuid[])))
  AND ((SELECT escopo_filial_pessoas())  IS NULL OR (filial_id  IS NOT NULL AND filial_id  = ANY((SELECT escopo_filial_pessoas())::uuid[])))
  AND ((SELECT escopo_cc_pessoas())      IS NULL OR (cc_id      IS NOT NULL AND cc_id      = ANY((SELECT escopo_cc_pessoas())::uuid[])))
  -- nulo = REALIZADO, que não pertence a versão nenhuma: passa.
  AND (versao_id IS NULL OR (SELECT escopo_versao()) IS NULL
       OR versao_id = ANY((SELECT escopo_versao())::uuid[])));

DO $$ DECLARE cmd text; pol text;
BEGIN
  FOREACH cmd IN ARRAY ARRAY['INSERT','UPDATE','DELETE'] LOOP
    pol := 'fat_folha_' || lower(left(cmd,3));
    EXECUTE format('DROP POLICY IF EXISTS %I ON fat_folha', pol);
    EXECUTE format($f$CREATE POLICY %I ON fat_folha FOR %s TO authenticated %s (
      tenant_id = (SELECT current_tenant_id()) AND (SELECT pode_escrever())
      AND ((SELECT edit_empresa_pessoas()) IS NULL OR (empresa_id IS NOT NULL AND empresa_id = ANY((SELECT edit_empresa_pessoas())::uuid[])))
      AND ((SELECT edit_filial_pessoas())  IS NULL OR (filial_id  IS NOT NULL AND filial_id  = ANY((SELECT edit_filial_pessoas())::uuid[])))
      AND ((SELECT edit_cc_pessoas())      IS NULL OR (cc_id      IS NOT NULL AND cc_id      = ANY((SELECT edit_cc_pessoas())::uuid[])))
      AND (versao_id IS NULL OR (SELECT edit_versao()) IS NULL
           OR versao_id = ANY((SELECT edit_versao())::uuid[])))$f$,
      pol, cmd, CASE WHEN cmd = 'INSERT' THEN 'WITH CHECK' ELSE 'USING' END);
  END LOOP;
END $$;

SELECT 'políticas de fat_folha que aceitam versão nula' AS secao,
       count(*)::text || ' de 4' AS resultado
  FROM pg_policies WHERE tablename='fat_folha'
   AND coalesce(qual, with_check) LIKE '%versao_id IS NULL%'
UNION ALL SELECT 'folha REALIZADO (sem versão, por desenho)',
  (SELECT count(*)::text FROM fat_folha WHERE tipo='REALIZADO' AND versao_id IS NULL)
UNION ALL SELECT '⛔ folha REALIZADO COM versão (esperado: 0)',
  (SELECT count(*)::text FROM fat_folha WHERE tipo='REALIZADO' AND versao_id IS NOT NULL)
UNION ALL SELECT '⛔ folha ORCADO SEM versão (esperado: 0)',
  (SELECT count(*)::text FROM fat_folha WHERE tipo='ORCADO' AND versao_id IS NULL)
UNION ALL SELECT 'fat_orcado sem versão (fica exigindo, de propósito)',
  (SELECT count(*)::text FROM fat_orcado WHERE versao_id IS NULL);
