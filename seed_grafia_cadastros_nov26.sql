-- ============================================================
-- SEED — grafia dos cadastros (item A-09 da homologação da TI)
--
-- POR QUE EXISTE: o gerente de TI listou doze erros de grafia visíveis na DRE,
-- nos filtros e no organograma. Nenhum deles muda um número — e é por isso
-- que valem a correção: quem está conferindo um relatório e lê "Impostors"
-- ou "Roaylties" passa a desconfiar do resto, que está certo.
--
-- DOIS TIPOS DE ERRO, e a distinção importa:
--   · digitação ("Roaylties", "unidadees", "Impostors", "Adminstrativo") —
--     erro de quem cadastrou, sem desculpa;
--   · acento que o ERP não traz ("Servicos", "Salarios", "Comissoes") — o
--     Protheus exporta sem acento e a carga copiou. Vai voltar na próxima
--     importação que sobrescrever descrição, e aí o lugar de corrigir é o
--     perfil de importação, não este seed.
--
-- A DESCRIÇÃO VIVE EM DUAS TABELAS: `conta_orcamentaria` (o master) e
-- `relatorio_linha` (a linha da DRE). ⚠ Corrigir só uma deixa o relatório e o
-- cadastro discordando, e aí a próxima pessoa não sabe qual é o certo.
-- `centro_custo` entra pelo "Adminstrativo  Geral" do organograma — que, de
-- quebra, tem espaço dobrado.
--
-- ⚠ O QUE NÃO ESTÁ AQUI, de propósito:
--   · **`Impostos s/ faturamento` × `Impostors s/ Faturamento` continuam DOIS
--     cadastros.** Este seed conserta a grafia; fundir dois planos de conta é
--     decisão de controladoria, e fundir errado move lançamento de lugar.
--     Depois dele os dois ficam com nomes quase iguais — o que é bom: a
--     duplicata para de se esconder atrás do erro de digitação.
--   · `**Livre` fica. Os asteriscos parecem marcação de linha reservada, não
--     engano, e apagar convenção alheia é pior que mantê-la.
--   · `Salarios Teste` vira `Salários Teste`: se é lixo, quem sabe apaga; o
--     seed não decide isso.
--
-- Re-executável — rodar duas vezes não muda nada na segunda.
-- Termina em SELECT.
-- ============================================================

UPDATE conta_orcamentaria SET descricao = regexp_replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(descricao, 'Mexico', 'México'), 'Roaylties', 'Royalties'), 'unidadees', 'unidades'), 'Impostors', 'Impostos'), 'Adminstrativo', 'Administrativo'), 'Servicos', 'Serviços'), 'Salarios', 'Salários'), 'Comissoes', 'Comissões'), 'Manutençao', 'Manutenção'), 'Liquido', 'Líquido'), 'Adesao', 'Adesão'), 'Recorrencia', 'Recorrência'), 'Bolivia', 'Bolívia'), 'Nao Recorrente', 'Não Recorrente'), '\s{2,}', ' ', 'g')
 WHERE descricao LIKE '%Mexico%' OR descricao LIKE '%Roaylties%' OR descricao LIKE '%unidadees%' OR descricao LIKE '%Impostors%' OR descricao LIKE '%Adminstrativo%' OR descricao LIKE '%Servicos%' OR descricao LIKE '%Salarios%' OR descricao LIKE '%Comissoes%' OR descricao LIKE '%Manutençao%' OR descricao LIKE '%Liquido%' OR descricao LIKE '%Adesao%' OR descricao LIKE '%Recorrencia%' OR descricao LIKE '%Bolivia%' OR descricao LIKE '%Nao Recorrente%' OR descricao ~ '\s{2,}';

UPDATE relatorio_linha SET descricao = regexp_replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(descricao, 'Mexico', 'México'), 'Roaylties', 'Royalties'), 'unidadees', 'unidades'), 'Impostors', 'Impostos'), 'Adminstrativo', 'Administrativo'), 'Servicos', 'Serviços'), 'Salarios', 'Salários'), 'Comissoes', 'Comissões'), 'Manutençao', 'Manutenção'), 'Liquido', 'Líquido'), 'Adesao', 'Adesão'), 'Recorrencia', 'Recorrência'), 'Bolivia', 'Bolívia'), 'Nao Recorrente', 'Não Recorrente'), '\s{2,}', ' ', 'g')
 WHERE descricao LIKE '%Mexico%' OR descricao LIKE '%Roaylties%' OR descricao LIKE '%unidadees%' OR descricao LIKE '%Impostors%' OR descricao LIKE '%Adminstrativo%' OR descricao LIKE '%Servicos%' OR descricao LIKE '%Salarios%' OR descricao LIKE '%Comissoes%' OR descricao LIKE '%Manutençao%' OR descricao LIKE '%Liquido%' OR descricao LIKE '%Adesao%' OR descricao LIKE '%Recorrencia%' OR descricao LIKE '%Bolivia%' OR descricao LIKE '%Nao Recorrente%' OR descricao ~ '\s{2,}';

UPDATE centro_custo SET descricao = regexp_replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(descricao, 'Mexico', 'México'), 'Roaylties', 'Royalties'), 'unidadees', 'unidades'), 'Impostors', 'Impostos'), 'Adminstrativo', 'Administrativo'), 'Servicos', 'Serviços'), 'Salarios', 'Salários'), 'Comissoes', 'Comissões'), 'Manutençao', 'Manutenção'), 'Liquido', 'Líquido'), 'Adesao', 'Adesão'), 'Recorrencia', 'Recorrência'), 'Bolivia', 'Bolívia'), 'Nao Recorrente', 'Não Recorrente'), '\s{2,}', ' ', 'g')
 WHERE descricao LIKE '%Mexico%' OR descricao LIKE '%Roaylties%' OR descricao LIKE '%unidadees%' OR descricao LIKE '%Impostors%' OR descricao LIKE '%Adminstrativo%' OR descricao LIKE '%Servicos%' OR descricao LIKE '%Salarios%' OR descricao LIKE '%Comissoes%' OR descricao LIKE '%Manutençao%' OR descricao LIKE '%Liquido%' OR descricao LIKE '%Adesao%' OR descricao LIKE '%Recorrencia%' OR descricao LIKE '%Bolivia%' OR descricao LIKE '%Nao Recorrente%' OR descricao ~ '\s{2,}';

-- ---------------- conferência ----------------
SELECT 'ainda com grafia errada' AS secao,
       (SELECT CASE WHEN count(*) = 0 THEN 'nenhuma — correto'
                    ELSE count(*)::text || ': ' || string_agg(DISTINCT descricao, ' | ') END
          FROM (SELECT descricao FROM conta_orcamentaria
                UNION ALL SELECT descricao FROM relatorio_linha
                UNION ALL SELECT descricao FROM centro_custo) x
         WHERE descricao LIKE '%Mexico%' OR descricao LIKE '%Roaylties%' OR descricao LIKE '%unidadees%' OR descricao LIKE '%Impostors%' OR descricao LIKE '%Adminstrativo%' OR descricao LIKE '%Servicos%' OR descricao LIKE '%Salarios%' OR descricao LIKE '%Comissoes%' OR descricao LIKE '%Manutençao%' OR descricao LIKE '%Liquido%' OR descricao LIKE '%Adesao%' OR descricao LIKE '%Recorrencia%' OR descricao LIKE '%Bolivia%' OR descricao LIKE '%Nao Recorrente%' OR descricao ~ '\s{2,}') AS resultado
UNION ALL
SELECT 'master e linha concordam?',
       (SELECT CASE WHEN count(*) = 0 THEN 'sim — nenhuma divergência'
                    ELSE count(*)::text || ' linha(s) com descrição diferente do master' END
          FROM relatorio_linha rl JOIN conta_orcamentaria co ON co.id = rl.linha_orc_id
         WHERE rl.descricao IS DISTINCT FROM co.descricao)
UNION ALL
SELECT 'a duplicata de impostos (decisão da controladoria)',
       (SELECT coalesce(string_agg(codigo || ' = ' || descricao, ' · '), 'nenhuma')
          FROM conta_orcamentaria WHERE descricao ILIKE '%mpostos s/%aturamento%');
