-- ============================================================
-- NR: o NÚMERO DE PARCELAS vira parâmetro por escopo (era fixo em 6).
--
-- ───────── POR QUE NÃO DÁ PARA ESCREVER ANTERIOR([METANR],[NPARC]) ─────────
-- O motor exige que o N do ANTERIOR seja LITERAL — a regex que o reconhece é
-- `ANTERIOR\s*\(\s*\[([^\]]+)\]\s*[,;]\s*(\d+)\s*\)` (engine.ts), e `(\d+)` só
-- casa dígito. Referência de linha ali não é lida.
--
-- ───────── O DESENHO QUE RESOLVE ─────────
-- Em vez de UM termo com N variável, TODOS os doze termos sempre presentes,
-- cada um com um PESO que o N liga ou desliga:
--
--   peso_i = MINIMO(1; MAXIMO(0; N - (i-1))) / N
--
--   N = 6    → i=1..6 valem 1/6 cada, i=7..12 valem 0.   Σ = 1
--   N = 5,5  → i=1..5 valem 1/5,5, i=6 vale 0,5/5,5,     Σ = 1
--   N = 10   → i=1..10 valem 1/10,                       Σ = 1
--
-- O `MINIMO(1; …)` dá a parcela cheia, o `MAXIMO(0; …)` corta as que não
-- existem, e a parcela do meio sai FRACIONADA — que é o que faz uma média de
-- 5,5 meses somar 100% da venda. Dividir tudo por 5,5 e cortar em 5 perderia
-- 9% da receita em silêncio; esta é a razão de a fórmula não ser só `/[NP]`.
-- Teto de 12: além de um ano o ANTERIOR não alcança de todo modo (não
-- atravessa o ano — é a PARCANT que carrega as safras anteriores).
--
-- ───────── A GUARDA DO VAZIO ─────────
-- Célula vazia vale 0 no motor, e N=0 zeraria a receita NR inteira sem avisar.
-- Daí a linha de apoio NP:
--   NP = SE([NPARC] < 1; 6; [NPARC])
-- Vazio (ou lixo negativo) cai nos 6 de antes — o comportamento anterior é o
-- padrão, não a surpresa. Comparação por `<` e não por `==` porque no mathjs
-- `=` é atribuição.
--
-- ───────── ONDE PREENCHER ─────────
-- NPARC é driver ANALITICA: preenche por empresa/BU, e o escopo 🌐 global serve
-- de padrão para quem não tiver valor próprio (itálico na tela = herdado).
-- O peso usa o NPARC do mês CORRENTE, não o do mês da venda. Com N constante
-- no ano — o caso normal — é idêntico; se mudar no meio do ano, a safra antiga
-- passa a parcelar pelo N novo. Não compensa o custo de corrigir isso.
-- ⚠ Como todo driver, precisa dos 12 meses preenchidos (a pendência da
-- "premissa anual" em docs/DESIGN_receitas.md vale aqui também).
--
-- ───────── N GRANDE ATRAVESSA O ANO (não é defeito) ─────────
-- Com N=12, uma venda de janeiro parcelaria até JANEIRO DO ANO SEGUINTE: no
-- ano corrente entram 11 parcelas, e a 12ª pertence ao ano que vem. Medido:
-- venda de 120.000 com N=12 → 110.000 em 2027. É a mesma natureza do "a meta
-- de nov/dez só vira receita no ano seguinte" já documentado no MRR, e vale
-- proporcionalmente para qualquer N > 1: quanto maior o N, maior a fatia das
-- safras do 2º semestre que escorre para o ano seguinte. Quem recebe essa
-- fatia no ano seguinte é a PARCANT.
--
-- ───────── VERIFICADO CONTRA O MOTOR (29/out) ─────────
--   · NPARC vazio → resultado IDÊNTICO mês a mês à fórmula de 6 fixas
--     (850.000,00 nos dois, com meta 100k/mês e repasse 100%);
--   · soma dos pesos = 1 para N = 1, 5, 5,5, 6, 7,3 e 10 — a venda inteira é
--     recuperada, com a parcela fracionária aparecendo: N=5,5 numa venda de
--     110.000 dá cinco parcelas de 20.000 e UMA MEIA de 10.000;
--   · custo: os 60 escopos do "Aplicar em todos" passaram de 93ms para 272ms
--     (1,6 → 4,5ms por escopo). Três vezes mais caro, irrelevante em absoluto.
--
-- SEGURO: com NPARC vazio em tudo, o NP vale 6 e o resultado é IDÊNTICO ao da
-- fórmula de 6 parcelas fixas. Rodar este seed não muda número nenhum.
--
-- Idempotente. Pressupõe o seed_nr_rampa_virada.sql (usa [PARCANT]).
-- ============================================================

DO $$
DECLARE
  v_form  uuid;
  v_max   int := 12;     -- teto de parcelas (o ANTERIOR não passa do ano)
  v_soma  text := '';
  v_expr  text;
  i       int;
BEGIN
  SELECT id INTO v_form FROM formulario WHERE codigo = 'VENDAS_NR';
  IF v_form IS NULL THEN RAISE EXCEPTION 'Formulário VENDAS_NR não encontrado'; END IF;

  -- ---- driver: número médio de parcelas, por escopo ----
  INSERT INTO formulario_linha
    (formulario_id, codigo, descricao, ordem, nivel, tipo_linha, expressao,
     natureza, formato, casas_decimais, conta_destino_id)
  VALUES
    (v_form, 'NPARC', 'Nº médio de parcelas da venda NR (vazio = 6)',
     15, 1, 'ANALITICA', NULL, 'NEUTRO', 'NUMERO', 1, NULL)
  ON CONFLICT (formulario_id, codigo) DO UPDATE
    SET descricao = EXCLUDED.descricao, ordem = EXCLUDED.ordem,
        tipo_linha = EXCLUDED.tipo_linha, natureza = EXCLUDED.natureza,
        formato = EXCLUDED.formato, casas_decimais = EXCLUDED.casas_decimais;

  -- ---- apoio: o N efetivo, com o padrão de 6 para célula vazia ----
  INSERT INTO formulario_linha
    (formulario_id, codigo, descricao, ordem, nivel, tipo_linha, expressao,
     natureza, formato, casas_decimais, conta_destino_id)
  VALUES
    (v_form, 'NP', 'Nº de parcelas efetivo (= NPARC, ou 6 se vazio) — apoio',
     75, 1, 'FORMULA', '=SE([NPARC] < 1; 6; [NPARC])',
     'NEUTRO', 'NUMERO', 1, NULL)
  ON CONFLICT (formulario_id, codigo) DO UPDATE
    SET descricao = EXCLUDED.descricao, ordem = EXCLUDED.ordem,
        tipo_linha = EXCLUDED.tipo_linha, expressao = EXCLUDED.expressao,
        natureza = EXCLUDED.natureza, formato = EXCLUDED.formato,
        casas_decimais = EXCLUDED.casas_decimais;

  -- ---- a rampa: 12 termos, cada um com o peso que o NP define ----
  FOR i IN 1..v_max LOOP
    v_soma := v_soma
           || CASE WHEN i > 1 THEN ' + ' ELSE '' END
           || format('ANTERIOR([METANR],%s) * MINIMO(1; MAXIMO(0; [NP] - %s)) / [NP]', i, i - 1);
  END LOOP;
  v_expr := format('=(%s + [PARCANT]) * [REPNR] / 100 + [PREVNR]', v_soma);

  UPDATE formulario_linha
     SET expressao = v_expr,
         descricao = 'Receita NR (safras do ano parceladas em NP meses + safras anteriores) × repasse'
   WHERE formulario_id = v_form AND codigo = 'RECNR';

  -- a descrição do CARD ainda anunciava "parcelada em 6 meses"
  UPDATE formulario
     SET descricao = 'Meta NR → receita parcelada em NPARC meses (a partir do mês seguinte) × % repasse + mensalidade estimada (% da venda) que acumula como carteira recorrente do ano'
   WHERE id = v_form;

  RAISE NOTICE 'RECNR atualizado com % termos', v_max;
END $$;

-- ---------- conferência ----------
SELECT l.ordem, l.codigo, l.descricao,
       l.tipo_linha || ' · ' || COALESCE(l.natureza,'—') || ' · ' || l.formato AS tipo,
       COALESCE(l.expressao, '— preencher —') AS formula,
       CASE WHEN l.conta_destino_id IS NULL THEN 'apoio' ELSE '→ ORÇADO' END AS destino,
       (SELECT count(*) FROM formulario_valor v WHERE v.linha_id = l.id) AS n_valores
  FROM formulario f
  JOIN formulario_linha l ON l.formulario_id = f.id
 WHERE f.codigo = 'VENDAS_NR'
 ORDER BY l.ordem;
