-- ============================================================
-- 115 — Item contábil da empresa (empresa.item_contabil)
--
-- O item contábil do Protheus é a EMPRESA GERENCIAL escrita em outro código.
-- O de-para já existia, mas só como CSV na mão de quem roda o conversor da
-- folha (`dados_rh/DePara ItemCCxEmpresa.csv`, lido por
-- converter_folha_realizada.py para redirecionar a empresa quando a coluna
-- ITEM_CONTABIL vem preenchida). Ficar só ali tem dois problemas: a tela não
-- alcança, e o arquivo de ajuste contábil (AJTCC, CTBA500) precisa do item para
-- montar o lançamento — sem ele o Protheus recusa.
--
-- Aqui ele vira atributo da empresa, que é onde sempre pertenceu.
--
-- Idempotente.
-- ============================================================

ALTER TABLE empresa
  ADD COLUMN IF NOT EXISTS item_contabil text;

COMMENT ON COLUMN empresa.item_contabil IS
  'Código do item contábil no Protheus — a mesma empresa gerencial, em outro formato. Usado no lançamento de ajuste de CC (CTBA500) e no de-para da importação da folha.';

-- ── Carga inicial: o de-para desta instalação ───────────────
-- Vem de "DePara ItemCCxEmpresa.csv" (TOTVS Oeste). Só preenche o que está
-- vazio, então rodar de novo não desfaz ajuste feito na tela. Em outra
-- instalação este bloco não se aplica — o cadastro é por Cadastros → Empresas,
-- e códigos que não existirem aqui simplesmente não casam.
UPDATE empresa e
   SET item_contabil = d.item
  FROM (VALUES
    ('01', '02'),   -- BAURU
    ('05', '01'),   -- RIO PRETO
    ('06', '03'),   -- MATO GROSSO DO SUL
    ('25', '04'),   -- MODA
    ('28', 'FB'),   -- RESULTAR BR
    ('40', 'TP'),   -- TOP PARTICIPACOES
    ('BO', 'BO'),   -- BOLIVIA
    ('XX', 'PY'),   -- PARAGUAI
    ('YY', '06'),   -- CASCAVEL
    ('ZZ', '05')    -- LONDRINA
  ) AS d(cod, item)
 WHERE btrim(e.codigo) = d.cod
   AND coalesce(btrim(e.item_contabil), '') = '';
