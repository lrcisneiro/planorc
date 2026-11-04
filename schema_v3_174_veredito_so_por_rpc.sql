-- ============================================================
-- v3_174 — O veredito só se escreve pela RPC
--
-- ⚠⚠ ACHADO AO CONFERIR A v3_172, e vale para os POSTOS desde a v3_165:
-- `pode_aprovar_cenario()` existe, as RPCs a chamam — e as TABELAS aceitam
-- escrita direta de qualquer `member` pela API. Isto é, o controle de
-- autoridade estava íntegro no caminho da tela e ausente no caminho do dado:
--
--   PATCH /rest/v1/posto_versao?id=eq.<x>  {"aprovado": true}
--
-- passava, porque a policy de escrita só exige `pode_escrever()`. O comentário
-- da v3_165 dizia que sem a função "um member aprova o próprio cenário pela API
-- e o controle vira teatro"; a função foi escrita e a porta ficou aberta do
-- lado de fora. É a lição da ACS-02 outra vez: **verificação mede efeito, não
-- intenção** — `pg_proc` confirmava que a autoridade existia, e só olhar os
-- GRANTs mostrou que ela não valia.
--
-- Conserto nos dois, por caminhos diferentes, porque as tabelas são diferentes:
--
-- `orcado_veredito` **só tem veredito**. Nada legítimo a escreve direto: a tela
-- usa `decidir_linha_orcado` e `reabrir_linha_orcado`, ambas SECURITY DEFINER.
-- Então some a escrita inteira — resta `SELECT`.
--
-- `posto_versao` guarda a PROPOSTA e o veredito na mesma linha, e a proposta é
-- escrita direto pela grade (upsert com colunas nomeadas). Então o corte é por
-- COLUNA, como em `posto.salario` (v3_142/143/148): nega as quatro de veredito
-- e concede o resto **por regra**, re-executável — lista fixa faria toda coluna
-- nova cair no balde dos negados por omissão, que foi o que houve com
-- `area_func_id`.
--
-- `DELETE` continua liberado: abandonar a decisão é ato de quem propõe.
-- As policies de escrita ficam de pé mesmo sem GRANT — se alguém reconceder a
-- tabela um dia, o `pode_escrever()` ainda está lá.
--
-- Prova por personificação em `prova_veredito_fechado.sql` — rodar depois.
-- Termina em SELECT.
-- ============================================================

-- ------------------------------------------------------------
-- 1. orcado_veredito: leitura e nada mais
-- ------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON orcado_veredito FROM authenticated;

-- ------------------------------------------------------------
-- 2. posto_versao: coluna a coluna, por regra
-- ------------------------------------------------------------
DO $$
DECLARE
  negadas text[] := ARRAY['aprovado', 'aprov_nota', 'aprov_em', 'aprov_por'];
  c text;
BEGIN
  REVOKE INSERT, UPDATE ON posto_versao FROM authenticated;
  FOR c IN
    SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'posto_versao'
       AND NOT (column_name = ANY(negadas))
  LOOP
    EXECUTE format('GRANT INSERT (%I), UPDATE (%I) ON posto_versao TO authenticated', c, c);
  END LOOP;
END $$;

COMMENT ON TABLE orcado_veredito IS
  'Veredito por linha do cenário de orçamento (v3_172). ESCRITA SÓ POR RPC '
  '(decidir_linha_orcado / reabrir_linha_orcado) — authenticated tem só SELECT (v3_174).';

SELECT 'v3_174 aplicada' AS resultado,
       (SELECT coalesce(string_agg(DISTINCT privilege_type, ', ' ORDER BY privilege_type), '(nenhum)')
          FROM information_schema.role_table_grants
         WHERE table_name = 'orcado_veredito' AND grantee = 'authenticated'
           AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')) AS orcado_veredito,
       (SELECT coalesce(string_agg(DISTINCT privilege_type, ', ' ORDER BY privilege_type), '(nenhum)')
          FROM information_schema.role_table_grants
         WHERE table_name = 'posto_versao' AND grantee = 'authenticated'
           AND privilege_type IN ('INSERT','UPDATE')) AS posto_versao_tabela,
       (SELECT count(*) FROM information_schema.column_privileges
         WHERE table_name = 'posto_versao' AND grantee = 'authenticated'
           AND privilege_type = 'UPDATE') AS posto_versao_colunas_upd,
       (SELECT count(*) FROM information_schema.column_privileges
         WHERE table_name = 'posto_versao' AND grantee = 'authenticated'
           AND privilege_type = 'UPDATE'
           AND column_name IN ('aprovado','aprov_nota','aprov_em','aprov_por')) AS veredito_ainda_gravavel;
