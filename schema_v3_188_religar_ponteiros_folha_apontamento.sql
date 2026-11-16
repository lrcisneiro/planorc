-- ============================================================
-- v3_188 — religa `posto_id` em fat_folha e fat_apontamento
--
-- POR QUE EXISTE: em 05/nov/2026 uma importação de rotina rodou em modo
-- **Substituir escopo**, que APAGA e recria os postos. Como
-- `fat_folha.posto_id` e `fat_apontamento.posto_id` são `ON DELETE SET NULL`,
-- os ids novos deixaram as duas tabelas de fato apontando para o nada.
-- Nenhum valor se perdeu — só o ponteiro. Medido hoje:
--
--     fat_folha        45.024 linhas órfãs
--     fat_apontamento  14.309 linhas órfãs  (100% da tabela)
--
-- ⚠ Isso NÃO dá erro em lugar nenhum. A folha continua somando certo por
-- competência e o apontamento continua somando certo por projeto; o que para
-- de funcionar é tudo que pergunta "deste POSTO": a conciliação Orçado × Folha
-- mostra o posto com realizado 0,00 e a pessoa separada em "sem posto", e a
-- Apontamento × Folha mostra **0,0 h apontadas** mesmo nos meses carregados.
-- Quatro itens da homologação da TI (A-02, A-17, A-20, C-09) são este defeito.
--
-- A CHAVE É (filial_id, matrícula), e ela é exata: `posto` tem unique por
-- (filial, matrícula). ⚠ A matrícula SOZINHA não serve — a `900008` pertence a
-- 7 CPFs (lição da v3_149). Medido: ZERO linhas ambíguas nas duas tabelas.
--
-- O QUE FICA DE FORA, e por quê:
--   · 15 linhas de folha do RONALDO BRUNO (matrícula 800002, série 8000xx =
--     pró-labore). O posto dele foi apagado em 05/nov e o arquivo do RH não o
--     traz de volta: é cadastro só do Planorc. Religar exige recriar o posto.
--   · 401 linhas de apontamento de TERCEIROS (`TER###`, `TC####`, `TL####`,
--     função TERCEIRO / FABRICA DE SOFTWARE). Não têm posto no quadro e não
--     devem ter: nulo ali é o valor certo, não uma lacuna.
--
-- ⚠ Só escreve onde `posto_id IS NULL`. Religar é consertar o que se perdeu,
-- nunca reescrever um vínculo que existe — se algum ponteiro atual estiver
-- errado, isso é outro problema e tem outra conversa.
--
-- ⚠⚠ A CAUSA CONTINUA LÁ. Enquanto "Substituir escopo" apagar e recriar, a
-- próxima importação nesse modo refaz o estrago. O conserto de verdade é o
-- modo fazer upsert por código e remover só os ausentes, preservando o id.
-- Para a carga mensal, o modo é **Adicionar/atualizar**.
--
-- Re-executável. Termina em SELECT.
-- ============================================================

-- ── 1. folha ──────────────────────────────────────────────────────────────
WITH par AS (
  -- Um par por (filial, matrícula) e só quando é ÚNICO. O `having count(*)=1`
  -- não é defensivo por hábito: é o que garante que uma duplicata futura no
  -- cadastro deixe a linha órfã em vez de atribuí-la à pessoa errada — erro
  -- que ninguém descobre, porque o número continua fechando no total.
  SELECT p.tenant_id, p.filial_id,
         lpad(nullif(trim(p.matricula), ''), 6, '0') AS mat,
         min(p.id) AS posto_id
    FROM posto p
   WHERE p.filial_id IS NOT NULL AND nullif(trim(p.matricula), '') IS NOT NULL
   GROUP BY 1, 2, 3
  HAVING count(*) = 1
)
UPDATE fat_folha f SET posto_id = par.posto_id
  FROM par
 WHERE f.posto_id IS NULL
   AND f.tenant_id = par.tenant_id
   AND f.filial_id = par.filial_id
   AND lpad(nullif(trim(f.matricula), ''), 6, '0') = par.mat;

-- ── 2. apontamento ────────────────────────────────────────────────────────
-- ⚠ `filial_id` aqui é a do POSTO, não a do projeto (essa é `filial_apont_id`).
-- Usar a do projeto casaria a pessoa com o posto errado sempre que ela
-- apontasse em outra unidade, que é justamente o caso comum.
WITH par AS (
  SELECT p.tenant_id, p.filial_id,
         lpad(nullif(trim(p.matricula), ''), 6, '0') AS mat,
         min(p.id) AS posto_id
    FROM posto p
   WHERE p.filial_id IS NOT NULL AND nullif(trim(p.matricula), '') IS NOT NULL
   GROUP BY 1, 2, 3
  HAVING count(*) = 1
)
UPDATE fat_apontamento a SET posto_id = par.posto_id
  FROM par
 WHERE a.posto_id IS NULL
   AND a.tenant_id = par.tenant_id
   AND a.filial_id = par.filial_id
   AND lpad(nullif(trim(a.matricula), ''), 6, '0') = par.mat;

-- ---------------- conferência ----------------
SELECT 'fat_folha · ainda órfãs' AS secao,
       (SELECT count(*)::text || ' de ' || (SELECT count(*) FROM fat_folha)::text
          FROM fat_folha WHERE posto_id IS NULL) AS resultado
UNION ALL
SELECT 'fat_folha · quem sobrou',
       (SELECT coalesce(string_agg(DISTINCT coalesce(nome,'(sem nome)') || ' · mat ' || coalesce(matricula,'—'), ' | '), 'ninguém')
          FROM fat_folha WHERE posto_id IS NULL)
UNION ALL
SELECT 'fat_apontamento · ainda órfãs',
       (SELECT count(*)::text || ' de ' || (SELECT count(*) FROM fat_apontamento)::text
          FROM fat_apontamento WHERE posto_id IS NULL)
UNION ALL
SELECT 'fat_apontamento · sobraram só terceiros?',
       (SELECT CASE WHEN count(*) FILTER (WHERE nullif(trim(matricula),'') IS NOT NULL) = 0
                    THEN 'correto — todos sem matrícula'
                    ELSE '⛔ ' || count(*) FILTER (WHERE nullif(trim(matricula),'') IS NOT NULL)::text || ' com matrícula' END
          FROM fat_apontamento WHERE posto_id IS NULL)
UNION ALL
SELECT 'horas de apontamento agora ligadas a posto',
       (SELECT round(sum(horas),1)::text || ' h em ' || count(DISTINCT posto_id)::text || ' posto(s)'
          FROM fat_apontamento WHERE posto_id IS NOT NULL)
UNION ALL
SELECT 'folha realizada agora ligada a posto',
       (SELECT count(*)::text || ' linha(s) · ' || count(DISTINCT posto_id)::text || ' posto(s)'
          FROM fat_folha WHERE posto_id IS NOT NULL AND tipo='REALIZADO');
