-- ============================================================
-- v3_196 — FONTE DE DADOS DO ERP (cadastro + segredo no Vault)
--
-- POR QUE EXISTE: a carga mensal do realizado dependia de UMA pessoa com o
-- repositório na máquina. A v3_195 e o `lib/razaoZip.ts` tiraram o passo do
-- meio (a tela abre o zip); falta tirar o "baixar o arquivo e saber onde ele
-- está". Esta tabela guarda ONDE buscar, e o Vault guarda COM QUE credencial.
--
-- ⚠⚠ A SENHA NÃO ESTÁ AQUI, E ISSO NÃO É DETALHE. O Planorc fala com o banco
-- pelo cliente JS: tudo que o navegador lê, o usuário lê no DevTools. Uma
-- coluna `senha` nesta tabela — por mais RLS que tivesse — seria publicar a
-- credencial do ERP para todo mundo que alcança a tela. RLS decide QUEM lê,
-- não impede quem pode ler de ver.
-- Por isso: a tabela guarda `secret_id`, o segredo vive no `vault`, e **quem
-- escreve e quem lê o segredo é a Edge Function**, com service role. O valor
-- nunca trafega para o navegador, em nenhum sentido.
--
-- ⚠ E a senha também NÃO entra por RPC. Parâmetro de função atravessa o
-- PostgREST e pode aparecer em log de erro; o cadastro vai por RPC, o segredo
-- vai direto para a Edge Function. São dois caminhos de propósito.
--
-- ⚠⚠ ESCRITA SÓ POR RPC, com o GRANT fechado junto (lição da v3_174 e da
-- v3_190): autoridade que existe só na função e não na tabela é teatro — um
-- `PATCH` em `erp_fonte` passaria pela API se o GRANT estivesse aberto.
-- `url_base` e `usuario` são tão sensíveis quanto a senha para quem quer
-- apontar o Planorc para outro lugar.
--
-- Re-executável. Termina em SELECT.
-- ============================================================

CREATE TABLE IF NOT EXISTS erp_fonte (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL DEFAULT current_tenant_id() REFERENCES tenant(id) ON DELETE CASCADE,
  nome          text NOT NULL,
  -- Só `HTTP` por ora (GET com Basic, serve WebDAV e autoindex). A coluna
  -- existe para SFTP/S3 não exigirem migration — e para a Edge Function poder
  -- recusar explicitamente o que ainda não sabe fazer, em vez de tentar.
  tipo          text NOT NULL DEFAULT 'HTTP' CHECK (tipo IN ('HTTP')),
  url_base      text NOT NULL,
  usuario       text,
  secret_id     uuid,
  -- id do perfil de conversão (`frontend/src/lib/perfis/<id>.json`) e o nome
  -- do arquivo esperado dentro da pasta. Texto solto de propósito: o catálogo
  -- de perfis vive no frontend e uma FK aqui criaria a segunda fonte de
  -- verdade que a mudança de nov/2026 acabou de eliminar.
  perfil        text,
  arquivo       text,
  ativo         boolean NOT NULL DEFAULT true,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  criado_por    uuid DEFAULT auth.uid(),
  atualizado_em timestamptz,
  UNIQUE (tenant_id, nome)
);

ALTER TABLE erp_fonte ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS erp_fonte_sel ON erp_fonte;
CREATE POLICY erp_fonte_sel ON erp_fonte FOR SELECT TO authenticated
  USING (tenant_id = (SELECT current_tenant_id()));

-- ⚠ Nenhuma policy de INSERT/UPDATE/DELETE: a escrita é das RPCs
-- (SECURITY DEFINER) e do service role. Política que não existe nega.

-- ── GRANTs: revogar a tabela e conceder coluna a coluna ─────────────────
-- ⚠ `REVOKE` de coluna só vale depois de tirar o GRANT da tabela (lição da
-- v3_150). E `secret_id` fica de fora: sozinho ele não abre nada, mas também
-- não serve para nada na tela — coluna que a interface não usa e o atacante
-- usaria não se concede.
REVOKE ALL ON erp_fonte FROM authenticated;
GRANT SELECT (id, tenant_id, nome, tipo, url_base, usuario, perfil, arquivo,
              ativo, criado_em, criado_por, atualizado_em) ON erp_fonte TO authenticated;

-- ── cadastro (sem senha) ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION erp_fonte_salvar(
  p_id       uuid,
  p_nome     text,
  p_url      text,
  p_usuario  text DEFAULT NULL,
  p_perfil   text DEFAULT NULL,
  p_arquivo  text DEFAULT NULL,
  p_ativo    boolean DEFAULT true
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_t uuid := current_tenant_id();
BEGIN
  -- ⚠ Apontar o Planorc para outro endereço é ato de fundação, como criar
  -- `dimensao` (v3_141): quem muda a `url_base` muda de onde vem o realizado.
  IF NOT eh_admin() THEN RAISE EXCEPTION 'Só administrador cadastra fonte de ERP.'; END IF;
  IF coalesce(btrim(p_nome), '') = '' THEN RAISE EXCEPTION 'Informe o nome da fonte.'; END IF;
  IF p_url !~* '^https://' THEN
    -- Sem `http://`: a credencial Basic vai no cabeçalho, e em claro na rede
    -- ela é entregue a quem estiver no caminho.
    RAISE EXCEPTION 'A URL precisa ser https:// — a credencial viaja nela.';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO erp_fonte (tenant_id, nome, url_base, usuario, perfil, arquivo, ativo)
    VALUES (v_t, btrim(p_nome), btrim(p_url), nullif(btrim(p_usuario), ''), p_perfil, nullif(btrim(p_arquivo), ''), p_ativo)
    RETURNING id INTO v_id;
  ELSE
    UPDATE erp_fonte SET nome = btrim(p_nome), url_base = btrim(p_url),
           usuario = nullif(btrim(p_usuario), ''), perfil = p_perfil,
           arquivo = nullif(btrim(p_arquivo), ''), ativo = p_ativo, atualizado_em = now()
     WHERE id = p_id AND tenant_id = v_t
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Fonte não encontrada neste tenant.'; END IF;
  END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION erp_fonte_excluir(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_secret uuid;
BEGIN
  IF NOT eh_admin() THEN RAISE EXCEPTION 'Só administrador exclui fonte de ERP.'; END IF;
  DELETE FROM erp_fonte WHERE id = p_id AND tenant_id = current_tenant_id()
  RETURNING secret_id INTO v_secret;
  -- ⚠ O segredo vai junto. Deixá-lo órfão no vault é guardar uma credencial
  -- que ninguém mais sabe de quem é — e que continua válida no ERP.
  IF v_secret IS NOT NULL THEN DELETE FROM vault.secrets WHERE id = v_secret; END IF;
END $$;

-- ── o segredo: duas funções que SÓ O SERVICE ROLE pode executar ─────────
-- ⚠⚠ O SCHEMA `vault` NÃO É EXPOSTO PELO PostgREST, então a Edge Function não
-- alcança `vault.decrypted_secrets` direto — precisa destas pontes em `public`.
-- E é melhor assim: a ponte é estreita, nomeada e com o GRANT fechado, em vez
-- de abrir um schema inteiro.
-- ⚠⚠ `erp_segredo_ler` DEVOLVE A SENHA EM CLARO. É a função mais perigosa do
-- banco: quem a executa lê a credencial do ERP. Ela existe porque a Edge
-- Function precisa dela, e **só o service role pode executá-la** — `REVOKE`
-- de `public` vem antes do `GRANT`, porque `PUBLIC` recebe EXECUTE por padrão
-- em toda função criada (é o caminho pelo qual um privilégio vaza sem ninguém
-- conceder nada).
CREATE OR REPLACE FUNCTION erp_segredo_gravar(p_fonte uuid, p_senha text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
DECLARE v_antigo uuid; v_novo uuid;
BEGIN
  SELECT secret_id INTO v_antigo FROM erp_fonte WHERE id = p_fonte;
  -- Caminho único e idempotente: cria o novo, aponta, apaga o anterior. Menos
  -- estados a manter que um update condicional — e se algo falhar no meio, o
  -- que sobra é um segredo órfão, não uma fonte sem credencial.
  SELECT vault.create_secret(p_senha, 'erp_fonte:' || p_fonte || ':' || extract(epoch from now())::bigint,
                             'Planorc · credencial de fonte de ERP') INTO v_novo;
  UPDATE erp_fonte SET secret_id = v_novo, atualizado_em = now() WHERE id = p_fonte;
  IF v_antigo IS NOT NULL THEN DELETE FROM vault.secrets WHERE id = v_antigo; END IF;
END $$;

CREATE OR REPLACE FUNCTION erp_segredo_ler(p_fonte uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = public, vault AS $$
  SELECT s.decrypted_secret FROM erp_fonte f
    JOIN vault.decrypted_secrets s ON s.id = f.secret_id
   WHERE f.id = p_fonte
$$;

REVOKE ALL ON FUNCTION erp_segredo_gravar(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION erp_segredo_ler(uuid)          FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION erp_segredo_gravar(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION erp_segredo_ler(uuid)          TO service_role;

GRANT EXECUTE ON FUNCTION erp_fonte_salvar(uuid, text, text, text, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION erp_fonte_excluir(uuid) TO authenticated;

COMMENT ON TABLE erp_fonte IS
  'Onde buscar os arquivos do ERP. A credencial NÃO está aqui: secret_id aponta para o vault, e só a Edge Function erp-fonte (service role) a lê.';

-- ---------------- conferência ----------------
-- ⚠ Mede EFEITO, não intenção: existir a policy não prova que ela filtra, e
-- existir a RPC não prova que o GRANT da tabela fechou (v3_174).
SELECT 'tabela criada' AS secao,
       coalesce((SELECT 'sim · ' || count(*)::text || ' colunas' FROM information_schema.columns
                  WHERE table_name = 'erp_fonte'), '⛔ não') AS resultado
UNION ALL
SELECT 'coluna senha NÃO existe (é o ponto)',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_name = 'erp_fonte' AND column_name IN ('senha','password','secret'))
            THEN '⛔ existe' ELSE 'confirmado' END
UNION ALL
SELECT 'escrita fechada na tabela?',
       CASE WHEN has_table_privilege('authenticated', 'erp_fonte', 'INSERT')
              OR has_table_privilege('authenticated', 'erp_fonte', 'UPDATE')
              OR has_table_privilege('authenticated', 'erp_fonte', 'DELETE')
            THEN '⛔ ainda aberta' ELSE 'sim — só pelas RPCs' END
UNION ALL
SELECT 'secret_id legível pela API?',
       CASE WHEN has_column_privilege('authenticated', 'erp_fonte', 'secret_id', 'SELECT')
            THEN '⛔ sim' ELSE 'não' END
UNION ALL
SELECT 'url_base legível (a tela mostra)?',
       CASE WHEN has_column_privilege('authenticated', 'erp_fonte', 'url_base', 'SELECT')
            THEN 'sim' ELSE '⛔ não — a tela fica cega' END
UNION ALL
SELECT '⚠ erp_segredo_ler fechada p/ usuário?',
       CASE WHEN has_function_privilege('authenticated', 'erp_segredo_ler(uuid)', 'EXECUTE')
             OR has_function_privilege('anon', 'erp_segredo_ler(uuid)', 'EXECUTE')
            THEN '⛔ ABERTA — a senha do ERP está exposta' ELSE 'sim — só service_role' END
UNION ALL
SELECT '⚠ erp_segredo_gravar fechada?',
       CASE WHEN has_function_privilege('authenticated', 'erp_segredo_gravar(uuid,text)', 'EXECUTE')
            THEN '⛔ aberta' ELSE 'sim — só service_role' END
UNION ALL
SELECT 'service_role alcança as duas?',
       CASE WHEN has_function_privilege('service_role', 'erp_segredo_ler(uuid)', 'EXECUTE')
             AND has_function_privilege('service_role', 'erp_segredo_gravar(uuid,text)', 'EXECUTE')
            THEN 'sim' ELSE '⛔ não — a Edge Function não vai funcionar' END
UNION ALL
SELECT 'RPCs criadas',
       (SELECT string_agg(proname, ', ' ORDER BY proname) FROM pg_proc
         WHERE proname IN ('erp_fonte_salvar', 'erp_fonte_excluir'));
