-- ============================================================
-- 120 — Cenário de FOLHA: `posto_versao` (sobreposição por versão)
--
-- Problema: `posto` não tem `versao_id`. O quadro é UM só, compartilhado por
-- todas as versões; só o resultado (fat_orcado/fat_folha) é congelado pelo
-- Aplicar. Basta reaplicar o motor numa versão derivada para ele recalcular do
-- quadro único e desfazer o cenário. "Corta 10 postos" e "adia 5 contratações"
-- não conviviam como duas hipóteses.
--
-- Decisão (docs/DESIGN_cenarios.md §7, out/2026), depois de olhar o mercado:
-- Oracle EPM e Workday Adaptive copiam a fatia inteira por cenário — funciona
-- porque lá o dado de pessoal já é dimensional. SAP SAC (versão privada que
-- publica só o alterado), Prophix (Default Scenario como única fonte dos
-- atributos) e Anaplan (cada line item declara a quais versões se aplica) usam
-- BASE + DIFERENÇA. Adotamos o segundo: copiar 571 postos × N cenários numa
-- tabela relacional custa caro de reconciliar e, pior, apaga a resposta "o que
-- este cenário muda" — que é justamente o que se apresenta.
--
-- O mestre guarda a REALIDADE (o que o RH manda). Esta tabela guarda as
-- DECISÕES. NULL = herda.
--
-- VARIAM (decisão): salário, FTE, vigência, reajuste, afastamento, ativo.
-- NÃO VARIAM (fato, ficam no mestre): nome, matrícula, admissão, cargo, regime,
--   sindicato, empresa/filial/CC, recurso_cod, benefícios, rateio.
--   Realocação (trocar CC/empresa) fica de fora de propósito: muda a chave do
--   rateio e do escopo de acesso, e é reorganização, não corte.
--
-- IDEMPOTENTE.
-- ============================================================

CREATE TABLE IF NOT EXISTS posto_versao (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenant ON DELETE CASCADE,
  versao_id  uuid NOT NULL REFERENCES versao_orcamento ON DELETE CASCADE,
  posto_id   uuid NOT NULL REFERENCES posto ON DELETE CASCADE,

  -- ---- decisões (NULL = herda do mestre) ----
  salario_base   numeric(14,2),
  fte            numeric(5,2),
  ini_ano smallint, ini_mes smallint CHECK (ini_mes IS NULL OR ini_mes BETWEEN 1 AND 12),
  fim_ano smallint, fim_mes smallint CHECK (fim_mes IS NULL OR fim_mes BETWEEN 1 AND 12),
  reajuste_mes   smallint CHECK (reajuste_mes IS NULL OR reajuste_mes BETWEEN 1 AND 12),
  reajuste_pct   numeric,
  reajuste_valor numeric(14,2),
  afast_ini_ano smallint, afast_ini_mes smallint CHECK (afast_ini_mes IS NULL OR afast_ini_mes BETWEEN 1 AND 12),
  afast_fim_ano smallint, afast_fim_mes smallint CHECK (afast_fim_mes IS NULL OR afast_fim_mes BETWEEN 1 AND 12),
  ativo          boolean,

  -- ---- a armadilha do NULL ----
  -- `NULL = herda` não sabe dizer "neste cenário este campo NÃO tem valor".
  -- Caso real: o mestre diz que a pessoa sai em maio e o cenário quer simular
  -- que ela FICA o ano todo — é preciso LIMPAR fim_ano/fim_mes, não herdar.
  -- Aqui ficam os nomes dos campos explicitamente vazios na versão; a
  -- resolução é  `campo ∈ limpos ? null : (overlay.campo ?? mestre.campo)`.
  limpos     text[] NOT NULL DEFAULT '{}',

  -- ---- rastro ----
  -- Cenário sem o PORQUÊ é número órfão na hora de apresentar. Texto livre:
  -- "corte estrutural 2027", "contratação adiada p/ jul".
  nota       text,

  criado_em  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (versao_id, posto_id)
);

CREATE INDEX IF NOT EXISTS ix_posto_versao_versao ON posto_versao (versao_id);
CREATE INDEX IF NOT EXISTS ix_posto_versao_posto  ON posto_versao (posto_id);

ALTER TABLE posto_versao ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "posto_versao_rls" ON posto_versao;
CREATE POLICY "posto_versao_rls" ON posto_versao FOR ALL
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

COMMENT ON TABLE posto_versao IS
  'Sobreposição do quadro de postos por versão/cenário. NULL = herda do posto mestre; `limpos` lista os campos explicitamente vazios. Só DECISÕES — fatos (nome, admissão, cargo, CC) moram no mestre.';

NOTIFY pgrst, 'reload schema';
