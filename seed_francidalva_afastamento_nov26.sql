-- ============================================================
-- SEED — tira o afastamento da Francidalva (posto 2101-000096)
--
-- POR QUE EXISTE: a pessoa da folha conferiu e escreveu — "consta no Planorc,
-- está com informação de afastada, mas não está afastada". O custo disso é o
-- maior item da lista dela: o motor **zera a base nos 12 meses** quando o
-- afastamento está em aberto, e ela aparece no orçado de 2027 com
-- R$ 9.928,46 no ano quando deveria custar perto de R$ 103 mil.
--     salário 4.391,84 × 1,6004 (encargos) = 7.028,69
--     + benefícios (A51 + A76 + D49) ......... 1.348,38
--     = 8.377,07/mês → 100.524,84/ano + PLR 2.195,92
-- Faltam ~R$ 92.800 no orçamento dela.
--
-- ⚠⚠ ISTO DURA ATÉ A PRÓXIMA IMPORTAÇÃO DO RH, E NÃO HÁ COMO EVITAR AQUI.
-- Conferi o arquivo: o `Funcionarios.csv` traz `SITFOLHA = 'A'` para ela. A
-- origem **afirma** que está afastada, e a importação a obedece — é o desenho
-- certo (a folha é a fonte da situação, v3_152). Quem corrige de verdade é o
-- RH, no ERP, no campo `RA_SITFOLH`. Enquanto não corrigirem lá, cada carga
-- mensal reabre o afastamento e some com o custo dela de novo.
-- **Rodar este seed sem pedir a correção no ERP é trabalho que evapora.**
--
-- ⚠ LIMPA OS DOIS CAMPOS, não só um. `situacaoPosto()` lê `sit_folha` primeiro
-- e o motor lê a janela `afast_ini`/`afast_fim`: limpar só a janela deixaria a
-- tela dizendo "afastada" com o custo cheio atrás, que é pior que o erro
-- original — ninguém confia num número que a própria tela contradiz.
--
-- ⚠ A ELAINE BRITO SEGURA (2102-000005) está na MESMA situação — afastamento
-- 10/2026 em aberto, orçado 2027 de R$ 9.376,00 — e **não é tocada aqui**: o
-- RH não a citou. Se ela também voltou, é um segundo caso, e a pergunta é a
-- mesma: o ERP sabe?
--
-- ⚠ Isto NÃO é um defeito do motor. Afastamento sem previsão de retorno zerar
-- o ano é decisão deliberada (o pior caso, documentado no desenho da v3_117).
-- O defeito está no dado de origem.
--
-- Re-executável. Termina em SELECT.
-- ============================================================

UPDATE posto
   SET afast_ini_ano = NULL, afast_ini_mes = NULL,
       afast_fim_ano = NULL, afast_fim_mes = NULL,
       afast_motivo  = NULL,
       sit_folha     = NULL
 WHERE codigo = '2101-000096';

-- ---------------- conferência ----------------
SELECT 'Francidalva' AS secao,
       (SELECT 'sit=' || coalesce(nullif(trim(sit_folha),''),'(vazio)')
               || ' · afastamento ' || coalesce(afast_ini_ano::text,'nenhum')
               || ' · salário R$ ' || round(salario_base,2)::text
          FROM posto WHERE codigo='2101-000096') AS resultado
UNION ALL
SELECT 'ainda há posto com afastamento em aberto?',
       (SELECT coalesce(string_agg(codigo || ' ' || nome, ' · '), 'nenhum')
          FROM posto WHERE ativo IS NOT FALSE
            AND afast_ini_ano IS NOT NULL AND afast_fim_ano IS NULL)
UNION ALL
SELECT 'orçado 2027 dela (muda só no próximo Aplicar)',
       (SELECT coalesce('R$ ' || round(sum(-valor),2)::text, 'nada')
          FROM fat_orcado WHERE origem='POSTO' AND ano=2027 AND dims->>'posto'='2101-000096'
            AND versao_id=(SELECT id FROM versao_orcamento WHERE codigo='Orçado2027'))
UNION ALL
SELECT 'PEDIR AO RH', 'corrigir RA_SITFOLH da matrícula 000096 no ERP — senão a próxima carga reabre';
