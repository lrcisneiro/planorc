-- ============================================================
-- SEED — religa a folha da matrícula 800002 ao posto 2001-900101
--
-- ⚠⚠ CORREÇÃO DE UM ERRO MEU. A versão anterior deste arquivo CRIAVA um posto
-- para o Ronaldo, e teria criado uma DUPLICATA: ele já está cadastrado como
-- `2001-900101`, com a mesma empresa·filial·CC (05·2001·310), o mesmo salário
-- (88.317,53), cargo DIRETOR DE SERVIÇOS — e está no orçado de 2027, com
-- R$ 1.118.099,93. Eu afirmei que faltava R$ 1,1 mi no orçamento: não falta.
--
-- O ERRO TEM NOME: procurei o posto pela matrícula da FOLHA e concluí que ele
-- não existia. A pessoa tem DUAS matrículas —
--     800002  na folha (série 8000xx, pró-labore)
--     900101  no cadastro do posto (série 9001xx, prestador)
-- e `(filial, matrícula)` é a chave da v3_188, então as 15 linhas ficaram
-- órfãs por mudança de matrícula, não por falta de posto. "Não achei por esta
-- chave" nunca é o mesmo que "não existe" — e o nome, que eu não consultei,
-- respondia na primeira tentativa.
--
-- O QUE FICA ÓRFÃO, e é só isto:
--     12 linhas ORCADO    2026-01..12   R$ 900.000,00   (75.000/mês)
--      3 linhas REALIZADO 2026-08..10   R$ 264.952,59   (88.317,53/mês)
-- O posto 900101 só tem orçado de 2027; o histórico de 2026 inteiro dele está
-- sob a matrícula antiga. Sem religar, a conciliação por posto fica cega nos
-- R$ 264.952,59 de realizado e o 2026 dele some do comparativo.
--
-- ⚠ É A MESMA PESSOA NA MESMA CADEIRA — mesmo nome, mesma empresa, mesma
-- filial, mesmo centro de custo, mesmo valor. A matrícula mudou de série
-- quando o vínculo deixou de ser pró-labore e virou prestador. Ligar a
-- história ao posto atual é o que faz a conciliação enxergar a pessoa inteira;
-- criar um segundo posto a partiria em dois e inflaria o headcount.
--
-- ⚠ NENHUM VALOR MUDA. Isto escreve `posto_id` e mais nada.
--
-- Re-executável. Termina em SELECT.
-- ============================================================

UPDATE fat_folha f SET posto_id = p.id
  FROM posto p
 WHERE p.codigo = '2001-900101'
   AND f.tenant_id = p.tenant_id
   AND f.posto_id IS NULL
   AND f.filial_id = p.filial_id
   AND lpad(nullif(trim(f.matricula), ''), 6, '0') = '800002';

-- ---------------- conferência ----------------
SELECT 'folha ligada ao posto 2001-900101' AS secao,
       (SELECT count(*)::text || ' linha(s) · ' || count(DISTINCT f.matricula)::text
               || ' matrícula(s) (' || string_agg(DISTINCT f.matricula, ', ') || ') · R$ '
               || round(sum(f.valor),2)::text
          FROM fat_folha f JOIN posto p ON p.id = f.posto_id WHERE p.codigo = '2001-900101') AS resultado
UNION ALL
SELECT 'fat_folha ainda órfã (deve ser zero)',
       (SELECT CASE WHEN count(*) = 0 THEN 'nenhuma — correto'
                    ELSE count(*)::text || ' linha(s): ' || string_agg(DISTINCT coalesce(nome,'?'), ', ') END
          FROM fat_folha WHERE posto_id IS NULL)
UNION ALL
SELECT 'nenhum posto duplicado para o Ronaldo?',
       (SELECT CASE WHEN count(*) = 1 THEN 'correto — 1 posto'
                    ELSE '⛔ ' || count(*)::text || ' postos' END
          FROM posto WHERE upper(nome) LIKE '%RONALDO BRUNO%')
UNION ALL
SELECT 'realizado de 2026 que volta a ter dono',
       (SELECT round(sum(f.valor),2)::text
          FROM fat_folha f JOIN posto p ON p.id = f.posto_id
         WHERE p.codigo = '2001-900101' AND f.tipo = 'REALIZADO');
