-- ============================================================
-- v3_195 — `ratear_orcado`: o rateio do drill numa transação só
--
-- O QUE MUDA: apagar a origem e gravar os destinos passam a acontecer juntos.
-- Hoje são N chamadas do navegador; falhando no meio, o valor fica duplicado
-- (a ordem foi escolhida para duplicar em vez de sumir — ruim e visível é
-- melhor que silencioso, mas continua ruim).
--
-- ───────── O QUE ESTA FUNÇÃO **NÃO** FAZ ─────────
-- ⚠⚠ **Não recalcula a cascata de rateio.** Os destinos chegam prontos, com o
-- valor de cada mês já distribuído por `cascataRateio` (lib/rateioFolha.ts) —
-- a MESMA função que o Aplicar do posto usa. Reimplementar a cascata aqui
-- criaria uma segunda fonte de verdade, e o mesmo cadastro passaria a render
-- dois resultados conforme a tela — divergência que só aparece conferindo.
-- A função é a TRANSAÇÃO, não a matemática.
--
-- ⚠ Consequência aceita: um cliente com defeito poderia mandar destinos
-- errados. Por isso a função **confere o total ao centavo** e recusa a
-- instrução inteira se não bater — é a invariante que importa (dinheiro não
-- nasce nem some num rateio), e é barata de checar.
--
-- ───────── GUARDAS ─────────
-- · `SECURITY INVOKER`: o RLS de `fat_orcado` vale, então escopo de empresa,
--   filial, CC e versão continuam recortando. **Não** virar DEFINER por
--   conveniência — seria dar a qualquer um o orçado inteiro.
-- · `UPDATE`/`DELETE` barrados por RLS **não dão erro**: afetam zero linhas e
--   voltam sucesso. Aqui cada comando confere `ROW_COUNT` e levanta exceção,
--   que numa função desfaz tudo.
-- · Origem com célula de POSTO/FORMULÁRIO é recusada: mover valor gerado faria
--   o próximo Aplicar reinseri-lo na origem, e ele passaria a existir duas
--   vezes. Mesma regra da tela (`editavelCel`), agora também no banco.
-- · Versão `bloqueada` é recusada com mensagem clara, antes de os gatilhos da
--   v3_190 recusarem com a genérica.
--
-- ⚠ `atualizado_em` NÃO é escrito aqui de propósito: o gatilho de touch
-- (v3_173/176) só carimba quando o comando não tocou a coluna, e a célula
-- rateada FOI mexida — é o que o merge de cenário precisa enxergar.
--
-- Re-executável. Termina em SELECT.
-- ============================================================

CREATE OR REPLACE FUNCTION ratear_orcado(
  p_versao   uuid,
  p_ano      integer,
  p_linha    uuid,                 -- conta_orcamentaria (o MASTER)
  p_emp      uuid,                 -- origem
  p_fil      uuid,
  p_cc       uuid,
  p_destinos jsonb                 -- [{"e":uuid,"f":uuid|null,"c":uuid|null,"m":{"1":valor,…}}]
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  t         uuid := current_tenant_id();
  v_origem  numeric;
  v_dest    numeric;
  n_cel_or  int;
  n_del     int := 0;
  n_upd     int := 0;
  n_ins     int := 0;
  d         jsonb;
  mes_k     text;
  mes_v     numeric;
  afet      int;
BEGIN
  IF t IS NULL THEN
    RAISE EXCEPTION 'current_tenant_id() nulo — chame pelo app, não pelo SQL Editor.';
  END IF;
  IF p_destinos IS NULL OR jsonb_array_length(p_destinos) = 0 THEN
    RAISE EXCEPTION 'Nenhum destino informado.';
  END IF;
  IF EXISTS (SELECT 1 FROM versao_orcamento WHERE id = p_versao AND bloqueada) THEN
    RAISE EXCEPTION 'Versão bloqueada: reabra antes de ratear.';
  END IF;

  -- ── a origem tem de ser puramente MANUAL ──
  IF EXISTS (
    SELECT 1 FROM fat_orcado f
     WHERE f.tenant_id = (SELECT current_tenant_id()) AND f.versao_id = p_versao
       AND f.ano = p_ano AND f.linha_id = p_linha
       AND f.empresa_id = p_emp
       AND f.filial_id IS NOT DISTINCT FROM p_fil
       AND f.cc_id     IS NOT DISTINCT FROM p_cc
       AND (f.origem <> 'MANUAL' OR coalesce(f.dims, '{}'::jsonb) <> '{}'::jsonb)
  ) THEN
    RAISE EXCEPTION 'A origem tem valor de posto ou formulário — mude na origem daquele valor, não aqui.';
  END IF;

  SELECT coalesce(sum(f.valor), 0), count(*) INTO v_origem, n_cel_or
    FROM fat_orcado f
   WHERE f.tenant_id = (SELECT current_tenant_id()) AND f.versao_id = p_versao
     AND f.ano = p_ano AND f.linha_id = p_linha
     AND f.empresa_id = p_emp
     AND f.filial_id IS NOT DISTINCT FROM p_fil
     AND f.cc_id     IS NOT DISTINCT FROM p_cc
     AND f.origem = 'MANUAL' AND coalesce(f.dims, '{}'::jsonb) = '{}'::jsonb;

  IF n_cel_or = 0 THEN
    RAISE EXCEPTION 'A combinação de origem não tem valor manual nesta versão/ano.';
  END IF;

  -- ── a invariante: o que sai da origem é o que entra nos destinos ──
  SELECT coalesce(sum(e.value::text::numeric), 0) INTO v_dest
    FROM jsonb_array_elements(p_destinos) x, jsonb_each(x->'m') e;

  IF round(v_dest, 2) <> round(v_origem, 2) THEN
    RAISE EXCEPTION 'Rateio não fecha: origem % e destinos % — diferença de %.',
      round(v_origem, 2), round(v_dest, 2), round(v_dest - v_origem, 2);
  END IF;

  -- ── apaga a origem ──
  -- Primeiro, e dentro da mesma transação: assim a combinação que também é
  -- destino não colide com a chave única ao ser regravada logo abaixo.
  DELETE FROM fat_orcado f
   WHERE f.tenant_id = (SELECT current_tenant_id()) AND f.versao_id = p_versao
     AND f.ano = p_ano AND f.linha_id = p_linha
     AND f.empresa_id = p_emp
     AND f.filial_id IS NOT DISTINCT FROM p_fil
     AND f.cc_id     IS NOT DISTINCT FROM p_cc
     AND f.origem = 'MANUAL' AND coalesce(f.dims, '{}'::jsonb) = '{}'::jsonb;
  GET DIAGNOSTICS n_del = ROW_COUNT;
  IF n_del <> n_cel_or THEN
    RAISE EXCEPTION 'Apagadas % de % células da origem — fora do seu escopo de edição.', n_del, n_cel_or;
  END IF;

  -- ── grava os destinos, somando no que já existir ──
  FOR d IN SELECT * FROM jsonb_array_elements(p_destinos) LOOP
    FOR mes_k, mes_v IN SELECT key, value::text::numeric FROM jsonb_each(d->'m') LOOP
      CONTINUE WHEN mes_v = 0;

      UPDATE fat_orcado f
         SET valor = f.valor + mes_v, expressao = NULL
       WHERE f.tenant_id = (SELECT current_tenant_id()) AND f.versao_id = p_versao
         AND f.ano = p_ano AND f.mes = mes_k::int AND f.linha_id = p_linha
         AND f.empresa_id = (d->>'e')::uuid
         AND f.filial_id IS NOT DISTINCT FROM nullif(d->>'f','')::uuid
         AND f.cc_id     IS NOT DISTINCT FROM nullif(d->>'c','')::uuid
         AND f.origem = 'MANUAL' AND coalesce(f.dims, '{}'::jsonb) = '{}'::jsonb;
      GET DIAGNOSTICS afet = ROW_COUNT;

      IF afet > 0 THEN
        n_upd := n_upd + afet;
      ELSE
        -- ⚠ Zero linhas atualizadas tem DUAS causas: a célula não existe (então
        -- insere), ou existe e o RLS a esconde de quem chama. A segunda só se
        -- revela na chave única — e sem este bloco chegaria à tela como
        -- "duplicate key value violates constraint uq_fat_orcado", que não
        -- ajuda ninguém. A transação desfaz tudo nos dois casos.
        BEGIN
          INSERT INTO fat_orcado (tenant_id, versao_id, linha_id, empresa_id, filial_id, cc_id,
                                  ano, mes, valor, expressao, origem, dims)
          VALUES ((SELECT current_tenant_id()), p_versao, p_linha, (d->>'e')::uuid,
                  nullif(d->>'f','')::uuid, nullif(d->>'c','')::uuid,
                  p_ano, mes_k::int, mes_v, NULL, 'MANUAL', '{}'::jsonb);
          n_ins := n_ins + 1;
        EXCEPTION WHEN unique_violation THEN
          RAISE EXCEPTION 'O destino do mês % já tem valor que você não alcança (fora do seu escopo de edição). Nada foi gravado.', mes_k;
        END;
      END IF;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'origem_valor', round(v_origem, 2), 'origem_celulas', n_cel_or,
    'apagadas', n_del, 'atualizadas', n_upd, 'inseridas', n_ins,
    'destinos', jsonb_array_length(p_destinos));
END $$;

COMMENT ON FUNCTION ratear_orcado IS
  'Rateia o valor de uma combinação do orçado nos destinos informados, numa transação só. '
  'A cascata é calculada no cliente (lib/rateioFolha.ts) — aqui só se confere o total e grava. v3_195.';

GRANT EXECUTE ON FUNCTION ratear_orcado(uuid, integer, uuid, uuid, uuid, uuid, jsonb) TO authenticated;

SELECT 'função criada' AS secao,
       (SELECT CASE WHEN count(*) = 1 THEN 'sim · SECURITY ' ||
                 CASE WHEN bool_or(prosecdef) THEN 'DEFINER ⛔' ELSE 'INVOKER (correto)' END
               ELSE '⛔ não encontrada' END
          FROM pg_proc WHERE proname = 'ratear_orcado') AS resultado;
