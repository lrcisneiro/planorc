-- ============================================================
-- SEED · fonte de ERP "AVENTUM" (arquivo CONTAAZUL.zip)
-- Rode no SQL Editor. Re-executável (não duplica). Termina em SELECT.
--
-- Copia a fonte que já funciona e troca só o ARQUIVO — URL, usuário e perfil
-- de conversão são os mesmos, como o Ricardo descreveu.
--
-- ⚠⚠ O `secret_id` NASCE NULO, DE PROPÓSITO — não se compartilha segredo entre
-- fontes. `erp_segredo_gravar` ROTACIONA apagando o anterior
-- (`DELETE FROM vault.secrets WHERE id = v_antigo`), e `erp_fonte_excluir`
-- leva a credencial junto. Com o `secret_id` copiado, trocar a senha de uma
-- fonte — ou excluí-la — deixaria a OUTRA apontando para um segredo que não
-- existe mais, e a falha só apareceria no dia da carga, como "não autorizado".
-- Duas fontes, dois segredos.
--
-- ⚠ E a senha não entra por SQL: ela nunca passa pelo PostgREST (parâmetro de
-- função cai em log de erro) nem pelo navegador. Quem a grava é a Edge
-- Function `erp-fonte`, com service role. Por isso o último passo é humano —
-- abrir a fonte na tela e digitar a senha uma vez.
--
-- ⚠ O `perfil` é copiado da fonte existente em vez de ser escrito à mão: ele
-- decide o mapa de empresa por item contábil, e o CLAUDE.md registra que ler o
-- razão com o perfil errado **passa na conferência de colunas** e distribui
-- tudo para as empresas erradas, "com sucesso". Copiar o que já está provado é
-- mais seguro que redigitar um literal.
-- ============================================================

INSERT INTO erp_fonte (tenant_id, nome, tipo, url_base, usuario, perfil, arquivo, ativo)
SELECT f.tenant_id, 'AVENTUM', f.tipo, f.url_base, f.usuario, f.perfil, 'CONTAAZUL.zip', true
  FROM erp_fonte f
 WHERE f.nome = 'GoodData — stage'
   AND NOT EXISTS (SELECT 1 FROM erp_fonte x
                    WHERE x.tenant_id = f.tenant_id AND x.nome = 'AVENTUM');

-- ---------------- conferência ----------------
SELECT '1 · fontes de ERP' AS secao,
       nome AS chave,
       arquivo||' · perfil '||coalesce(perfil,'—') AS info,
       CASE WHEN secret_id IS NULL
            THEN '⚠ SEM SENHA — abra a fonte na tela e digite uma vez'
            ELSE '✅ credencial própria ('||left(secret_id::text,8)||')' END AS det
  FROM erp_fonte WHERE ativo
UNION ALL
SELECT '2 · nenhum segredo compartilhado?', '',
       CASE WHEN (SELECT count(*) FROM (
              SELECT secret_id FROM erp_fonte WHERE secret_id IS NOT NULL
               GROUP BY secret_id HAVING count(*) > 1) z) = 0
            THEN '✅ cada fonte com o seu' ELSE '⛔ DUAS FONTES NO MESMO SEGREDO — trocar a senha de uma quebra a outra' END,
       ''
UNION ALL
SELECT '3 · mesma URL e usuário?', '',
       (SELECT count(DISTINCT url_base)::text FROM erp_fonte WHERE ativo)||' URL · '
       ||(SELECT count(DISTINCT usuario)::text FROM erp_fonte WHERE ativo)||' usuário',
       'esperado 1 e 1 — "todo o resto é igual"'
 ORDER BY 1, 2;
