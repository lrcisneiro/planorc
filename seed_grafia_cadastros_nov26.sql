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

-- ============================================================
-- 2ª PASSADA — o que a 1ª não pegou
--
-- A conferência "master e linha concordam?" denunciou oito divergências. Seis
-- são legítimas (a linha da DRE pode ter nome de exibição diferente da conta
-- master), mas duas eram erro de verdade — e nenhuma estava na lista da TI,
-- porque não aparecem na DRE dele:
--     "Recelita Liquida"  → troca de letra, no master da Receita Líquida
--     "Liquida" / "Comissao" → acentos que a 1ª passada não cobriu, porque eu
--                              só havia listado "Liquido" e "Comissoes"
--
-- ⚠ A LIÇÃO É SOBRE A LISTA, não sobre as palavras: corrigir por lista de
-- termos conhecidos só alcança o que alguém já viu. Achar o resto exigiu
-- varrer por PADRÃO (palavra portuguesa provavelmente sem acento), e é assim
-- que se deve procurar da próxima vez.
-- ============================================================

UPDATE conta_orcamentaria SET descricao =
       replace(replace(replace(descricao, 'Recelita', 'Receita'), 'Liquida', 'Líquida'), 'omissao', 'omissão')
 WHERE descricao LIKE '%Recelita%' OR descricao LIKE '%Liquida%' OR descricao LIKE '%omissao%';

UPDATE relatorio_linha SET descricao =
       replace(replace(replace(descricao, 'Recelita', 'Receita'), 'Liquida', 'Líquida'), 'omissao', 'omissão')
 WHERE descricao LIKE '%Recelita%' OR descricao LIKE '%Liquida%' OR descricao LIKE '%omissao%';

-- ---------------- conferência da 2ª passada ----------------
SELECT 'sobrou palavra sem acento?' AS secao,
       (SELECT CASE WHEN count(*) = 0 THEN 'nenhuma — correto'
                    ELSE string_agg(DISTINCT descricao, ' | ') END
          FROM (SELECT descricao FROM conta_orcamentaria
                UNION ALL SELECT descricao FROM relatorio_linha
                UNION ALL SELECT descricao FROM centro_custo) x
         WHERE descricao ~* '\m(liquida|recelita|comissao|servico|manutencao|provisao)\M') AS resultado
UNION ALL
-- ⚠ Não apaga nada: "teste" num cadastro pode ter lançamento atrás.
SELECT 'cadastros que parecem rascunho (NÃO apagados)',
       (SELECT coalesce(string_agg(DISTINCT descricao, ' · '), 'nenhum')
          FROM (SELECT descricao FROM conta_orcamentaria
                UNION ALL SELECT descricao FROM relatorio_linha) y
         WHERE descricao ~* '\mteste\M');
