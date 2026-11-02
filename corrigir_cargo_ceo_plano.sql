-- O CEO foi criado à mão ANTES da v3_145, então pegou o default `ERP` e caiu na
-- lista "vindos da folha". É do plano. Os outros dois sem posto
-- (ANALISTA I STEP 6, ESN TRAINEE STEP 06) ficam como ERP: têm cara de cargo do
-- Protheus que ninguém ocupa no momento, não de decisão de estrutura.
--
-- Pelo código e não pelo nome: `codigo` tem unique por tenant, `nome` não.
UPDATE cargo SET origem = 'PLANO' WHERE codigo = 'CEO';

SELECT origem, count(*) AS cargos,
       string_agg(nome, ', ' ORDER BY nome) FILTER (WHERE origem = 'PLANO') AS no_plano
  FROM cargo GROUP BY origem ORDER BY origem;
