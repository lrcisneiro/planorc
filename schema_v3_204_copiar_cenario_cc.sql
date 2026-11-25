-- ============================================================
-- v3_204 — `copiar_versao_cenario` perdia o CENTRO DE CUSTO (e o `gerado`)
--
-- ⚠⚠ ACHADO NO USO REAL (25/nov): copiar para a versão nova do estudo de venda
-- do MS falhava com
--     duplicate key value violates unique constraint "uq_formulario_valor"
-- e o erro vinha do próprio INSERT: ele listava `empresa_id` e `filial_id` e
-- **não listava `cc_id`** — que está no índice único. Todas as linhas de origem
-- que diferem SÓ pelo centro de custo colapsavam na mesma chave no destino.
--
-- Medido: **17.425 de 17.586** linhas de `formulario_valor` têm `cc_id`
-- preenchido (99%), e **2.138 chaves** colapsariam — cada uma é um
-- `duplicate key`. O formulário de réplica de receitas, com 54 escopos por
-- empresa · filial · CC, bate nisso sempre.
--
-- ⚠⚠ O ERRO FOI SORTE. Onde NÃO houvesse colisão, a cópia teria passado e a
-- célula chegaria ao destino **sem centro de custo** — virando grão
-- consolidado em silêncio, e o Aplicar gravaria o orçado no lugar errado.
-- Coluna que entra no índice único e falta no INSERT ou estoura, ou corrompe;
-- aqui estourou.
--
-- ⚠ `gerado` também faltava. Sem ele a célula copiada nasce `false` = "corrigida
-- à mão", e passa a **sobreviver à re-geração** do wizard — o oposto do
-- contrato ("o que o wizard escreveu é substituído, o que você corrigiu
-- permanece"). A versão copiada ficaria imune ao próprio wizard que a gerou.
--
-- ⚠ Ao acrescentar coluna a `formulario_valor`, conferir ESTE INSERT: ele lista
-- coluna a coluna, então toda coluna nova nasce perdida na cópia, calada.
--
-- Re-executável (CREATE OR REPLACE, mesma assinatura). Termina em SELECT.
-- ============================================================

CREATE OR REPLACE FUNCTION public.copiar_versao_cenario(p_origem uuid, p_destino uuid, p_substituir boolean DEFAULT true)
 RETURNS TABLE(tabela text, linhas integer)
 LANGUAGE plpgsql
 SET statement_timeout TO '300s'
AS $function$
DECLARE t uuid := current_tenant_id(); n int;
BEGIN
  IF p_origem = p_destino THEN
    RAISE EXCEPTION 'Origem e destino são iguais.';
  END IF;
  IF t IS NULL THEN
    -- no SQL Editor não há JWT: sem isto a função apagaria e copiaria NADA,
    -- sem erro, e quem chamou acharia que funcionou
    RAISE EXCEPTION 'current_tenant_id() nulo — chame pelo app, não pelo SQL Editor.';
  END IF;

  n := copiar_versao_orcado(p_origem, p_destino, p_substituir);
  tabela := 'fat_orcado'; linhas := n; RETURN NEXT;

  IF p_substituir THEN DELETE FROM versao_taxa WHERE versao_id = p_destino AND tenant_id = t; END IF;
  INSERT INTO versao_taxa (tenant_id, versao_id, moeda_slot, ano, mes, taxa)
  SELECT tenant_id, p_destino, moeda_slot, ano, mes, taxa
    FROM versao_taxa WHERE versao_id = p_origem AND tenant_id = t;
  GET DIAGNOSTICS n = ROW_COUNT;
  tabela := 'versao_taxa'; linhas := n; RETURN NEXT;

  IF p_substituir THEN DELETE FROM premissa_dissidio WHERE versao_id = p_destino AND tenant_id = t; END IF;
  INSERT INTO premissa_dissidio (tenant_id, versao_id, sindicato_id, pct)
  SELECT tenant_id, p_destino, sindicato_id, pct
    FROM premissa_dissidio WHERE versao_id = p_origem AND tenant_id = t;
  GET DIAGNOSTICS n = ROW_COUNT;
  tabela := 'premissa_dissidio'; linhas := n; RETURN NEXT;

  IF p_substituir THEN DELETE FROM formulario_valor WHERE versao_id = p_destino AND tenant_id = t; END IF;
  INSERT INTO formulario_valor
    (tenant_id, formulario_id, linha_id, versao_id, empresa_id, filial_id, cc_id, ano, mes, valor, expressao, dims, gerado)
  SELECT tenant_id, formulario_id, linha_id, p_destino, empresa_id, filial_id, cc_id, ano, mes, valor, expressao, dims, gerado
    FROM formulario_valor WHERE versao_id = p_origem AND tenant_id = t;
  GET DIAGNOSTICS n = ROW_COUNT;
  tabela := 'formulario_valor'; linhas := n; RETURN NEXT;

  IF p_substituir THEN DELETE FROM posto_versao WHERE versao_id = p_destino AND tenant_id = t; END IF;
  INSERT INTO posto_versao
    (tenant_id, versao_id, posto_id, salario_base, fte, ini_ano, ini_mes, fim_ano, fim_mes,
     reajuste_mes, reajuste_pct, reajuste_valor,
     afast_ini_ano, afast_ini_mes, afast_fim_ano, afast_fim_mes, ativo, limpos, nota)
  SELECT tenant_id, p_destino, posto_id, salario_base, fte, ini_ano, ini_mes, fim_ano, fim_mes,
         reajuste_mes, reajuste_pct, reajuste_valor,
         afast_ini_ano, afast_ini_mes, afast_fim_ano, afast_fim_mes, ativo, limpos, nota
    FROM posto_versao WHERE versao_id = p_origem AND tenant_id = t;
  GET DIAGNOSTICS n = ROW_COUNT;
  tabela := 'posto_versao'; linhas := n; RETURN NEXT;
END $function$;
-- ⚠ O `;` acima é obrigatório e o `pg_get_functiondef` NÃO o devolve: sem ele o
-- SELECT de conferência fica colado no corpo e o editor acusa
-- `syntax error at or near "SELECT"`. Vale para toda migration montada a
-- partir da definição existente de uma função.

-- ---------------- conferência ----------------
-- ⚠ Mede EFEITO: as duas colunas têm de aparecer no corpo da função. Conferir
-- que "a função existe" não diria nada — ela existia e estava errada.
SELECT '1·cc_id no INSERT de formulario_valor' AS secao,
       CASE WHEN prosrc LIKE '%filial_id, cc_id, ano%' THEN 'sim' ELSE '⛔ NÃO' END AS resultado
  FROM pg_proc WHERE proname = 'copiar_versao_cenario'
UNION ALL
SELECT '2·gerado no INSERT',
       CASE WHEN prosrc LIKE '%dims, gerado%' THEN 'sim' ELSE '⛔ NÃO' END
  FROM pg_proc WHERE proname = 'copiar_versao_cenario'
UNION ALL
SELECT '3·quantas chaves colapsariam sem o cc_id (era o erro)',
       (SELECT count(*)::text FROM (
          SELECT versao_id, linha_id,
                 coalesce(empresa_id, '00000000-0000-0000-0000-000000000000'::uuid) e,
                 coalesce(filial_id,  '00000000-0000-0000-0000-000000000000'::uuid) f,
                 ano, mes, dims::text
            FROM formulario_valor GROUP BY 1,2,3,4,5,6,7 HAVING count(*) > 1) x)
ORDER BY 1;
