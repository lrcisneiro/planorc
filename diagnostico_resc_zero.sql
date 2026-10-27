-- ============================================================
-- Rescisão saindo ZERO na tela — por que as verbas não entram?
--
-- `verbasDoRegime()` (motorFolha.ts) aplica DOIS filtros antes da cascata:
--   paisAplica   — verba com `pais` preenchido só casa com posto do MESMO país;
--                  verba com pais NULL/'' é compartilhada e vale para todos.
--   regimeAplica — `regime` é lista separada por vírgula; vazio = todos.
-- Se a verba sai em qualquer um dos dois, ela nem chega a ser calculada — e a
-- tela mostra "sem verbas de rescisão no catálogo deste regime".
--
-- As RESC_* nasceram com pais='BR' explícito. Se as verbas antigas estiverem com
-- pais NULL e a empresa do posto também, só as novas somem — e é exatamente
-- esse o sintoma. Esta consulta compara os três lados.
-- Só leitura.
-- ============================================================

-- a) o país das EMPRESAS (é o que o motor passa como país do posto)
select 'a · empresas'          as bloco,
       coalesce(pais, '(NULL)') as valor,
       count(*)                as qtd,
       string_agg(codigo, ', ' order by codigo) as quais
  from empresa where ativo
 group by 1, 2

union all
-- b) o país das VERBAS BR-CLT já existentes (as que funcionam hoje)
select 'b · verbas BR-CLT antigas',
       coalesce(pais, '(NULL = compartilhada)'),
       count(*),
       string_agg(codigo, ', ' order by codigo)
  from verba_folha
 where ativo and codigo not like 'RESC\_%'
   and (regime is null or regime like '%CLT%')
 group by 1, 2

union all
-- c) o país e o regime das RESC_* (as que somem)
select 'c · RESC_*',
       coalesce(pais, '(NULL)') || ' · regime ' || coalesce(regime, '(NULL)'),
       count(*),
       string_agg(codigo, ', ' order by ordem)
  from verba_folha
 where ativo and codigo like 'RESC\_%'
 group by 1, 2

union all
-- d) os REGIMES usados nos postos (tem de bater com o regime da verba)
select 'd · regime dos postos',
       coalesce(regime, '(NULL)'),
       count(*),
       ''
  from posto where coalesce(ativo, true)
 group by 1, 2

order by 1, 2;
