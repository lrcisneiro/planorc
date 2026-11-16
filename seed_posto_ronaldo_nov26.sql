-- ============================================================
-- SEED — recria o posto 2001-800002 (RONALDO BRUNO KAIROF DE SOUZA)
--
-- POR QUE EXISTE: é o último posto perdido na importação de 05/nov/2026, que
-- rodou em "Substituir escopo" e apagou o que o arquivo do RH não traz de
-- volta. Pró-labore da série 8000xx é cadastro só do Planorc. Dos seis sócios,
-- cinco já foram recriados; este ficou, e são as 15 linhas de folha que a
-- v3_188 não conseguiu religar — não por ambiguidade, mas porque não há posto
-- com quem casar.
--
-- ⚠⚠ ELE NÃO ESTÁ NO ORÇADO DE 2027, e isso é o que importa de verdade aqui.
-- O ponteiro solto era o sintoma; o buraco é R$ 88.317,53/mês de pró-labore
-- fora do orçamento — ~R$ 1,1 mi no ano, já com o dissídio. Os outros quatro
-- sócios ativos somam R$ 2.577.476,04 em 2027; com ele a diretoria fecha.
-- (O Dijan, 800003, está fora de propósito: foi cortado, e a vigência dele
-- termina em 12/2026 — confirmado pelo Ricardo.)
--
-- DE ONDE VEM CADA CAMPO — tudo medido, nada suposto:
--   empresa 05 · filial 2001 · CC 310 (Base-Diretoria) → da folha dele
--   regime BR-PRESTADOR                                → verba 228, como os 5
--   salario_base 88.317,53                             → realizado de out/26
--
-- A CONVENÇÃO DO SALÁRIO foi conferida contra os outros, não adivinhada: o
-- `salario_base` de cada sócio é o realizado de out/26 da verba 228 — bate ao
-- centavo em 4 dos 5 (o Dijan difere R$ 440). Mesmo critério do
-- `preencher_salario_folha.py`, que tira o prestador de 222+228 da folha do mês.
--
-- ⚠ Sem vigência, sem cargo e sem verba anexada, igual aos outros cinco: o
-- custo do sócio é o pró-labore e nada mais. Copiar a forma deles é o que faz
-- a diretoria aparecer junta no relatório em vez de este destoar.
--
-- ⚠ Se ele também tiver sido cortado, o conserto é `fim_ano`/`fim_mes` no
-- cadastro — NÃO deixar de criar o posto. Sem posto, as 15 linhas de folha
-- ficam órfãs para sempre e a conciliação continua cega nele.
--
-- Re-executável. Termina em SELECT.
-- ============================================================

WITH t AS (SELECT id FROM tenant ORDER BY criado_em LIMIT 1),
alvo AS (
  SELECT (SELECT id FROM t) AS tenant_id,
         (SELECT id FROM empresa      WHERE codigo='05'   AND tenant_id=(SELECT id FROM t)) AS empresa_id,
         (SELECT id FROM filial       WHERE codigo='2001' AND tenant_id=(SELECT id FROM t)) AS filial_id,
         (SELECT id FROM centro_custo WHERE codigo='310'  AND tenant_id=(SELECT id FROM t)) AS cc_id
),
novo AS (
  INSERT INTO posto (tenant_id, codigo, nome, matricula, empresa_id, filial_id, cc_id,
                     regime, salario_base, fte, ativo)
  SELECT a.tenant_id, '2001-800002', 'RONALDO BRUNO KAIROF DE SOUZA', '800002',
         a.empresa_id, a.filial_id, a.cc_id, 'BR-PRESTADOR', 88317.53, 1, true
    FROM alvo a
   WHERE a.empresa_id IS NOT NULL AND a.filial_id IS NOT NULL AND a.cc_id IS NOT NULL
  ON CONFLICT (tenant_id, codigo) DO UPDATE
    SET nome = EXCLUDED.nome, matricula = EXCLUDED.matricula,
        empresa_id = EXCLUDED.empresa_id, filial_id = EXCLUDED.filial_id, cc_id = EXCLUDED.cc_id,
        regime = EXCLUDED.regime, salario_base = EXCLUDED.salario_base, ativo = true
  RETURNING id
)
-- Religa as 15 linhas órfãs. Mesma chave da v3_188 — (filial, matrícula) —, só
-- que agora o par existe. Lê o id de `novo` e não da tabela: todo sub-comando
-- de um WITH vê o MESMO snapshot, e um SELECT em `posto` aqui não enxergaria a
-- linha que a CTE acabou de inserir (lição do seed do estágio).
UPDATE fat_folha f SET posto_id = novo.id
  FROM novo, alvo a
 WHERE f.posto_id IS NULL
   AND f.tenant_id = a.tenant_id
   AND f.filial_id = a.filial_id
   AND lpad(nullif(trim(f.matricula), ''), 6, '0') = '800002';

-- ---------------- conferência ----------------
SELECT 'posto criado' AS secao,
       (SELECT p.codigo || ' · ' || p.nome || ' · ' || p.regime || ' · R$ ' || round(p.salario_base,2)::text
          FROM posto p WHERE p.codigo='2001-800002') AS resultado
UNION ALL
SELECT 'folha do Ronaldo agora ligada ao posto',
       (SELECT count(*)::text || ' linha(s)' FROM fat_folha f JOIN posto p ON p.id=f.posto_id
         WHERE p.codigo='2001-800002')
UNION ALL
SELECT 'fat_folha ainda órfã (deve ser zero)',
       (SELECT CASE WHEN count(*)=0 THEN 'nenhuma — correto'
                    ELSE count(*)::text || ' linha(s): ' || string_agg(DISTINCT coalesce(nome,'?'), ', ') END
          FROM fat_folha WHERE posto_id IS NULL)
UNION ALL
SELECT 'sócios ativos no cadastro',
       (SELECT string_agg(p.codigo || ' ' || split_part(p.nome,' ',1), ' · ' ORDER BY p.matricula)
          FROM posto p WHERE p.matricula LIKE '8000%' AND p.ativo
            AND (p.fim_ano IS NULL OR p.fim_ano >= 2027))
UNION ALL
SELECT 'FALTA RODAR O APLICAR',
       'o posto existe, mas só entra no orçado de 2027 no próximo Aplicar';
