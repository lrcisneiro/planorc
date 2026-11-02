-- ============================================================
-- v3_138 — Padrão de `member` virou "diretor de área"
--
-- O catálogo (lib/capacidades.ts) passou a nascer FECHADO para member em 12
-- capacidades: importação de apontamento/formulário, metas de indicador, os
-- menus de Orçamento, Formulários, Realizado, Saldos, Amarração, Cadastros, e
-- os dashboards Comparativo anual / CAGR / Indicadores. O modelo foi o cadastro
-- da Andrea, onde essas 12 estavam negadas uma a uma.
--
-- POR QUE ISTO É UMA MIGRATION: virar um padrão muda, em silêncio, o acesso de
-- quem dependia dele. Quem já tinha por herança perde sem ninguém decidir, e
-- descobre quando o menu some. Então, antes do padrão novo valer, o acesso de
-- hoje é MATERIALIZADO como override explícito para quem o tinha por herança.
--
-- Quem é preservado: member que NÃO é admin no mesmo tenant e NÃO tem override
-- na capacidade. A Andrea sai pela segunda condição (tem os 12 negados); contas
-- que também são admin saem pela primeira, porque para elas o override é inócuo.
--
-- Depois disto, "perder acesso" vira uma decisão com nome: abrir Configurações
-- e trocar Liberar por Herdar.
--
-- tenant_id vai EXPLÍCITO: o gatilho de auto-tenant usa current_tenant_id(),
-- que é NULL fora de uma sessão autenticada (CLI e SQL Editor) — sem isto,
-- violação de NOT NULL.
--
-- Termina em SELECT, nunca em RAISE: o editor roda tudo numa transação.
-- ============================================================

INSERT INTO user_acesso_funcao (tenant_id, user_id, capacidade, permitido)
SELECT ut.tenant_id, ut.user_id, k.capacidade, true
  FROM user_tenant ut
 CROSS JOIN (VALUES
        ('apontamento.importar'), ('dash.anual'),         ('dash.cagr'),
        ('dash.indicadores'),     ('formulario.importar'), ('indicador.meta'),
        ('menu.amarracao'),       ('menu.cadastros'),      ('menu.formularios'),
        ('menu.orcamento'),       ('menu.realizado'),      ('menu.saldos')
       ) AS k(capacidade)
 WHERE ut.role = 'member'
   AND NOT EXISTS (SELECT 1 FROM user_tenant a
                    WHERE a.tenant_id = ut.tenant_id AND a.user_id = ut.user_id AND a.role = 'admin')
   AND NOT EXISTS (SELECT 1 FROM user_acesso_funcao f
                    WHERE f.tenant_id = ut.tenant_id AND f.user_id = ut.user_id AND f.capacidade = k.capacidade)
ON CONFLICT (tenant_id, user_id, capacidade) DO NOTHING;

-- Quem foi preservado, e em quantas das 12.
SELECT split_part(u.email,'@',1) AS quem,
       count(*)                  AS liberadas_explicitamente
  FROM user_acesso_funcao f
  LEFT JOIN auth.users u ON u.id = f.user_id
 WHERE f.permitido
   AND f.capacidade IN ('apontamento.importar','dash.anual','dash.cagr','dash.indicadores',
                        'formulario.importar','indicador.meta','menu.amarracao','menu.cadastros',
                        'menu.formularios','menu.orcamento','menu.realizado','menu.saldos')
 GROUP BY 1 ORDER BY 1;
