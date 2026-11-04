-- ============================================================
-- v3_171 — Cenário de orçamento: semear uma versão a partir da baseline
--
-- Irmão do cenário de postos (v3_164..v3_170), mas aqui NÃO há tabela de
-- sobreposição: `fat_orcado` já tem `versao_id`, então o cenário **é** a
-- versão. O posto precisou de `posto_versao` porque o posto é único e
-- atravessa versões; a célula de orçado não.
--
-- `origem_versao_id` é o que torna a versão um cenário: diz de qual baseline
-- ela foi semeada, e é contra ela que o comparativo calcula o Δ. Versão sem
-- origem é baseline; com origem, é proposta.
--
-- ⚠ SÓ ADMIN SEMEIA. "Liberar o orçamento para a área" é ato da controladoria:
-- criar a versão dela. Se o próprio gerente pudesse semear, a função
-- (SECURITY DEFINER, que copia a baseline inteira sem olhar escopo) viraria o
-- caminho para materializar numa versão sua o orçado de áreas que ele não vê.
-- O escopo de quem ORÇA no cenário continua sendo cadastro, e vale no RLS de
-- `fat_orcado` por versão (v3_137) — zero código.
--
-- ⚠ SEMEIA TODAS AS ORIGENS, mas o merge (B3) escreverá só `MANUAL`. Não é
-- incoerência: sem POSTO e FORMULARIO o cenário mostraria a área sem 70% do
-- próprio custo e o Δ não significaria nada. Copiar é para enxergar; mergear
-- valor gerado criaria número que a próxima aplicação apaga calada.
--
-- ⚠ O INSERT ... SELECT copia coluna a coluna, não `SELECT *`: coluna nova em
-- `fat_orcado` que não entre aqui simplesmente não é semeada — some do cenário
-- sem erro. Mesma razão de `posto_v` listar colunas uma a uma.
--
-- Termina em SELECT.
-- ============================================================

ALTER TABLE versao_orcamento
  ADD COLUMN IF NOT EXISTS origem_versao_id uuid REFERENCES versao_orcamento(id);

COMMENT ON COLUMN versao_orcamento.origem_versao_id IS
  'Baseline de onde este cenário foi semeado (v3_171). NULL = esta versão é baseline.';

CREATE INDEX IF NOT EXISTS idx_versao_origem
  ON versao_orcamento (tenant_id, origem_versao_id)
  WHERE origem_versao_id IS NOT NULL;

-- ------------------------------------------------------------
-- copiar_versao — cria a versão do cenário e, opcionalmente, semeia
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION copiar_versao(
  p_origem    uuid,
  p_codigo    text,
  p_descricao text,
  p_semear    boolean DEFAULT true
) RETURNS TABLE(versao_id uuid, celulas bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid := current_tenant_id();
  v_ano    int;
  v_nova   uuid;
  v_n      bigint := 0;
BEGIN
  IF NOT eh_admin() THEN
    RAISE EXCEPTION 'Só a controladoria (admin) pode criar cenário de orçamento.'
      USING ERRCODE = '42501';
  END IF;

  SELECT ano INTO v_ano FROM versao_orcamento
   WHERE id = p_origem AND tenant_id = v_tenant;
  IF v_ano IS NULL THEN
    RAISE EXCEPTION 'Versão de origem não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF btrim(coalesce(p_codigo,'')) = '' THEN
    RAISE EXCEPTION 'O cenário precisa de um código.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM versao_orcamento
              WHERE tenant_id = v_tenant AND upper(codigo) = upper(btrim(p_codigo))) THEN
    RAISE EXCEPTION 'Já existe uma versão com o código %.', btrim(p_codigo)
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO versao_orcamento
    (tenant_id, codigo, descricao, ano, ativa, bloqueada, origem_versao_id)
  VALUES
    (v_tenant, btrim(p_codigo),
     coalesce(nullif(btrim(coalesce(p_descricao,'')),''), btrim(p_codigo)),
     v_ano, true, false, p_origem)
  RETURNING id INTO v_nova;

  IF p_semear THEN
    INSERT INTO fat_orcado
      (tenant_id, versao_id, linha_id, empresa_id, filial_id, cc_id, ano, mes,
       valor, expressao, origem, origem_formulario_linha_id, dims, moeda_origem,
       val_m2, val_m3, val_m4, val_m5)
    SELECT
       o.tenant_id, v_nova, o.linha_id, o.empresa_id, o.filial_id, o.cc_id, o.ano, o.mes,
       o.valor, o.expressao, o.origem, o.origem_formulario_linha_id, o.dims, o.moeda_origem,
       o.val_m2, o.val_m3, o.val_m4, o.val_m5
      FROM fat_orcado o
     WHERE o.tenant_id = v_tenant AND o.versao_id = p_origem;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  END IF;

  RETURN QUERY SELECT v_nova, v_n;
END $$;

REVOKE ALL ON FUNCTION copiar_versao(uuid, text, text, boolean) FROM public;
GRANT EXECUTE ON FUNCTION copiar_versao(uuid, text, text, boolean) TO authenticated;

-- Resumo do que um cenário pesa, para a tela mostrar antes/depois de semear.
-- ⚠ `security_invoker` + filtro de tenant explícito. Sem o primeiro a view
-- roda como DONO e o RLS de `versao_orcamento` não se aplica — vazaria versão
-- de outro tenant. Aqui, diferente de `posto_v` (v3_142), não há privilégio de
-- coluna a preservar, então rodar como chamador é simplesmente o certo.
CREATE OR REPLACE VIEW vw_cenario_orcamento WITH (security_invoker = true) AS
SELECT v.id, v.codigo, v.descricao, v.ano, v.ativa, v.bloqueada,
       v.origem_versao_id, b.codigo AS origem_codigo,
       v.aprovado_em, v.aprovado_por, v.aprovacao_nota,
       (SELECT count(*) FROM fat_orcado o WHERE o.versao_id = v.id) AS celulas,
       v.tenant_id
  FROM versao_orcamento v
  LEFT JOIN versao_orcamento b ON b.id = v.origem_versao_id
 WHERE v.origem_versao_id IS NOT NULL
   AND v.tenant_id = (SELECT current_tenant_id());

GRANT SELECT ON vw_cenario_orcamento TO authenticated;

SELECT 'v3_171 aplicada' AS resultado,
       (SELECT count(*) FROM information_schema.columns
         WHERE table_name='versao_orcamento' AND column_name='origem_versao_id') AS col_origem,
       (SELECT count(*) FROM pg_proc WHERE proname='copiar_versao') AS fn_copiar;
