-- ============================================================
-- O refresh_realizado_mensal está mesmo rodando?
--
-- A RPC faz DELETE + INSERT na MESMA transação, então a contagem de
-- fat_realizado_mensal vista daqui continua a ANTIGA até ela commitar — não dá
-- para medir progresso por linhas. O que mostra o estado de verdade é
-- pg_stat_activity: se a query aparecer como `active`, está trabalhando.
--
-- Roda como postgres no SQL Editor, então NÃO precisa do bloco de claim.
-- Só leitura.
-- ============================================================

-- 1. O que está rodando agora (ignora esta própria consulta)
select
  pid,
  state,
  now() - query_start            as rodando_ha,
  now() - state_change           as neste_estado_ha,
  wait_event_type, wait_event,          -- preenchidos = ESPERANDO, não trabalhando
  left(regexp_replace(query, '\s+', ' ', 'g'), 90) as query
from pg_stat_activity
where pid <> pg_backend_pid()
  and state <> 'idle'
order by query_start;

-- 2. Alguém travando alguém? (bloqueio é a causa clássica de "nunca termina")
select
  bloqueada.pid        as pid_esperando,
  left(bloqueada.query, 60)  as esperando_por,
  bloqueante.pid       as pid_que_bloqueia,
  left(bloqueante.query, 60) as query_bloqueante
from pg_stat_activity bloqueada
join lateral unnest(pg_blocking_pids(bloqueada.pid)) as b(pid) on true
join pg_stat_activity bloqueante on bloqueante.pid = b.pid
where cardinality(pg_blocking_pids(bloqueada.pid)) > 0;

-- 3. O tamanho do trabalho — quanto a função tem de reagrupar
select
  (select count(*) from fat_realizado)        as linhas_fat_realizado,
  (select count(*) from fat_realizado_mensal) as linhas_agregado_ANTES_do_commit;

-- Para cancelar sem derrubar a conexão (troque o PID pelo da consulta 1):
--   select pg_cancel_backend(<pid>);
-- E para rodar o refresh aqui, sem o limite de tempo do PostgREST na frente:
--   select refresh_realizado_mensal();
