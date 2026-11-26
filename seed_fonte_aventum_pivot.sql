-- ============================================================
-- A fonte de ERP da AVENTUM passa a apontar para o PIVOT do ContaAzul.
-- Rode no SQL Editor. Re-executável. Termina em SELECT.
--
-- POR QUE: ela estava em `CONTAAZUL.zip` com o perfil `valore` — o caminho do
-- DE-PARA, que traduzia o pivot para o formato Protheus antes do GoodData.
-- Esse passo saiu: o pivot entra como a origem o exporta, pelo perfil
-- `contaazul`, e a tradução virou amarração conta → linha, na tela.
--
-- ⚠ Deixada apontando para o perfil novo mesmo antes de o arquivo estar na
-- área de stage. Se alguém clicar em "Buscar na fonte" antes do upload, o erro
-- é 404 — claro e sem estrago. O contrário é que era perigoso: com o perfil
-- `valore` a tela leria o zip do de-para contra o plano BRAVENTUM e reporia na
-- base exatamente a amarração errada que se acabou de desmontar.
--
-- ⚠ `arquivo` é a EXPECTATIVA do nome, não uma leitura: ela casa com
-- `arquivo_padrao` do perfil. Quem subir o pivot com outro nome corrige no
-- próprio modal de importar — a manutenção mora junto do uso.
-- ⚠ Nenhuma credencial aqui: a senha vive no vault e não é tocada por este
-- script (`erp_fonte` guarda `secret_id`, nunca a senha).
-- ============================================================

UPDATE erp_fonte
   SET perfil  = 'contaazul',
       arquivo = 'pivot.xlsx'
 WHERE nome = 'AVENTUM';

-- ---------------- conferência ----------------
SELECT 'fonte de ERP' AS secao, nome AS chave,
       coalesce(perfil, '(sem perfil)') AS info,
       coalesce(arquivo, '(sem arquivo)')
         || CASE WHEN secret_id IS NULL THEN ' · sem credencial' ELSE ' · credencial no vault' END
         || CASE WHEN ativo THEN '' ELSE ' · INATIVA' END AS det
  FROM erp_fonte
 ORDER BY nome;
