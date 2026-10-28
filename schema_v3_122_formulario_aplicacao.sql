-- ============================================================
-- 122 — Quando o formulário foi aplicado no orçado
--
-- O relatório lê o `fat_orcado`; o formulário só chega lá pelo **Aplicar**.
-- Nada na tela dizia que os drivers tinham mudado depois da última aplicação,
-- então editava-se a meta, ia-se ao relatório e via-se o número velho — sem
-- nenhum sinal. Custou uma investigação inteira em out/2026: dois cenários de
-- meta apareciam com a diferença INVERTIDA porque um dos lados estava com
-- aplicação antiga, e a suspeita caiu sobre a fórmula, que estava certa.
--
-- Uma linha por formulário × versão × ano. O Aplicar carimba; a tela compara
-- com o `max(formulario_valor.atualizado_em)` do mesmo recorte e avisa.
--
-- Guardar isto no `fat_orcado` não serviria: lá o Aplicar APAGA e regrava, e o
-- que importa é a última vez que rodou, inclusive quando não gerou linha
-- nenhuma (escopo zerado continua sendo uma aplicação).
-- IDEMPOTENTE.
-- ============================================================

CREATE TABLE IF NOT EXISTS formulario_aplicacao (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant ON DELETE CASCADE,
  formulario_id uuid NOT NULL REFERENCES formulario ON DELETE CASCADE,
  versao_id     uuid NOT NULL REFERENCES versao_orcamento ON DELETE CASCADE,
  ano           int  NOT NULL,
  aplicado_em   timestamptz NOT NULL DEFAULT now(),
  escopos       int,              -- quantos escopos a última rodada cobriu
  celulas       int,              -- quantas linhas foram ao fat_orcado
  UNIQUE (formulario_id, versao_id, ano)
);

ALTER TABLE formulario_aplicacao ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "formulario_aplicacao_rls" ON formulario_aplicacao;
CREATE POLICY "formulario_aplicacao_rls" ON formulario_aplicacao FOR ALL
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

-- `atualizado_em` existe desde a v3_049 mas só era preenchido no INSERT (o
-- editor de célula fazia UPDATE sem tocá-lo), então não servia para "mudou
-- desde quando". O trigger resolve para qualquer caminho de escrita — tela,
-- importação ou SQL — em vez de depender de cada um lembrar.
CREATE OR REPLACE FUNCTION formulario_valor_touch() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN NEW.atualizado_em := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_formulario_valor_touch ON formulario_valor;
CREATE TRIGGER trg_formulario_valor_touch
  BEFORE INSERT OR UPDATE ON formulario_valor
  FOR EACH ROW EXECUTE FUNCTION formulario_valor_touch();

NOTIFY pgrst, 'reload schema';
