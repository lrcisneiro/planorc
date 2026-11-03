-- ============================================================
-- v3_157 — Três cargos que ficaram no limbo entre ERP e PLANO
--
-- A v3_156 usou `ON CONFLICT (tenant_id, codigo) DO UPDATE`, e `codigo` é
-- derivado do NOME. Três cargos do plano têm nome idêntico a cargos que já
-- vieram da folha — ASSISTENTE COMERCIAL, GERENTE DE MARKETING, RECEPCIONISTA
-- — então o INSERT caiu em cima das linhas existentes e as ATUALIZOU em vez de
-- criar novas. O nome não mudou (era o mesmo texto), mas `nivel` foi escrito e,
-- pior, elas continuaram com `origem = 'ERP'`.
--
-- ⚠ A LIÇÃO: `ON CONFLICT` não sabe de `origem`. Um upsert por chave derivada
-- de nome atravessa a fronteira entre dois conjuntos que o modelo trata como
-- separados — e faz isso em silêncio, porque conflito resolvido não é erro.
--
-- Consequência prática: a carga de pessoas troca o cargo exigindo
-- `origem = 'PLANO'`, então quem ocupa esses três ficaria sem a troca e
-- apareceria em "cargo do arquivo sem par no catálogo".
--
-- O conserto é promovê-los, não duplicá-los: o nome É o do plano, a pessoa já
-- aponta para a linha certa, e criar um gêmeo faria duas entradas com o mesmo
-- nome — que é o defeito que o unique existe para impedir.
--
-- O recorte é preciso: só `origem = 'ERP'` COM `nivel` preenchido. A
-- importação da folha nunca escreve nível; quem escreveu foi a v3_156.
-- ⚠ Rodar ANTES da carga de pessoas, e só uma vez — depois dela, nível
-- preenchido à mão num cargo do ERP é escolha de alguém, não resíduo.
--
-- Termina em SELECT.
-- ============================================================

UPDATE cargo SET origem = 'PLANO'
 WHERE origem = 'ERP' AND nivel IS NOT NULL;

SELECT origem, count(*) AS cargos, count(nivel) AS com_nivel
  FROM cargo GROUP BY origem ORDER BY origem;
