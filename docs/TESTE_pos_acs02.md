# Roteiro de teste — depois do ACS-02 (v3_129 a v3_132)

Serve como evidência do Anexo A e como conferência antes de liberar acesso.
Cada item diz **o que fazer**, **o que esperar** e **o que significa se falhar** —
esta última coluna é o que transforma o teste em diagnóstico.

> Ordem importa: o item 1 é o que mais machuca se estiver errado, e invalida os
> outros. Faça na ordem.

---

## 1 · Admin continua vendo tudo  ⟵ comece por aqui

**Como:** entre como admin e abra *Dashboards → DRE Acompanhamento* e *Postos*.

**Esperar:** exatamente os números de antes. Admin ignora o escopo por desenho.

**Se falhar:** `eh_admin()` não está enxergando o papel — provavelmente
`auth.uid()` nulo ou `user_tenant.role` diferente de `'admin'`. É o pior caso:
sem admin funcionando, ninguém conserta cadastro de ninguém. Rollback está no
fim do `schema_v3_129_rls_escopo.sql`.

---

## 2 · Não-regressão por usuário (medido, não clicado)

**Como:** rode `seguranca_passo2_naoregressao.sql` no SQL Editor.
O resultado sai como `ERROR` de propósito — é a única saída que o editor sempre
mostra.

**Esperar:**
- responder em **segundos** (se demorar, o `InitPlan` do `v3_131` não pegou);
- `admin` com os números cheios;
- usuário **com** regra vendo **menos**;
- ninguém vendo zero em tudo.

**Se falhar:**
- *member com regra vendo o mesmo que admin* → política de escrita voltou a ser
  `FOR ALL` e está vazando a leitura.
- *todo mundo zerado* → `current_tenant_id()` não resolveu.
- *lento* → função de escopo fora de subconsulta escalar.

---

## 3 · Totais batem com o que a pessoa via antes

**Como:** com um usuário restrito (`b32a12df` ou `f4adcaff`), anote o total de
Receita, EBITDA e Resultado no *DRE Acompanhamento* e no *Orçamento — análise*.
Compare com o que ele via antes das migrations.

**Esperar:** **idênticos**. O frontend já aplicava o mesmo recorte, e as RPCs já
excluíam linha com dimensão nula (`cc_id = ANY(lista)` não é verdadeiro para
nulo).

**Se falhar:** não é regressão, é **bug achado** — ou a política divergiu do
`useUserAccess`, ou o `useUserAccess` estava errado. Anote a diferença: ela diz
qual dos dois.

---

## 4 · ESCRITA ainda funciona para quem deve escrever

Este é o item que eu quase deixei de fora, e é onde está o risco não óbvio.

**4a. Orçar uma célula** — entre como `member` com regra, abra *Orçar (grade)*,
digite um valor e salve.
**Esperar:** salva. **Se falhar com erro de RLS:** a linha que ele tenta gravar
está fora do escopo de **ORÇAR** dele (que herda do VER quando não há regra
própria).

**4b. `viewer` NÃO escreve** — entre como viewer e tente editar.
**Esperar:** recusa. É o buraco que o `v3_130` fechou: antes, `GRANT ALL` +
policy `FOR ALL` deixava um viewer apagar o orçado pela API.

**4c. ⚠ Aplicar postos e importar razão, como NÃO-admin.**
A política de `INSERT` exige `cc_id IS NOT NULL AND cc_id = ANY(edit_cc())` para
quem tem restrição. Mas **53% do razão tem `cc_id` nulo** (contas de balanço), e
o *Aplicar* pode gerar linha sem CC quando o rateio não tem destino.
**Consequência:** um não-admin com permissão de importar teria essas linhas
**rejeitadas** — importação parcial, em silêncio ou com erro.
**Hoje não dói** porque `realizado.importar` e `posto.aplicar` são admin por
padrão, e admin ignora o escopo. **Dói no dia em que você liberar importação
para um member.** Se for fazer isso, me chame antes: a correção é permitir
dimensão nula na escrita (não dá para restringir o que não tem valor), mantendo
a leitura conservadora.

---

## 5 · Desempenho do razão

**Como:** abra o *DRE Acompanhamento* num ano cheio e cronometre.

**Esperar:** igual a antes. O predicado novo é avaliado uma vez por consulta.

**Se piorar:** `EXPLAIN (ANALYZE, BUFFERS)` na RPC. O caminho é índice com
`cc_id` à frente — **não** afrouxar a política. Lembre que no `EXPLAIN` o
trabalho do nó é o *intervalo* do `actual time`, não o total.

---

## 6 · Usuário sem cadastro vê o aviso, não uma tela quebrada

**Como:** entre com `4aa4c2cb` ou `4f5e1b72` (sem regra).

**Esperar:** faixa laranja no topo — *"Seu acesso a dados ainda não foi
cadastrado"* — com as dimensões que faltam.

**Se falhar e as telas aparecerem só zeradas:** o deploy do frontend não subiu.
As migrations estão no banco, o aviso está no código **não publicado**.

---

## 7 · Cabeçalhos e CSP (INF-01/INF-02)

**Como:** abra o app em produção com o console do navegador aberto e navegue
por Dashboards, Orçar, Postos, exportar PNG/PDF e importar um xlsx.

**Esperar:** **nenhuma violação de CSP** no console. A CSP de script/style/connect
está em `Report-Only` justamente para esta volta.

**Se passar limpo:** renomeie `Content-Security-Policy-Report-Only` para
`Content-Security-Policy` em `frontend/public/_headers` e publique. É o que
converte o item de "observando" para "vigorando".

**Se acusar violação:** anote o host bloqueado — é um `connect-src` ou
`script-src` faltando, não motivo para abandonar a CSP.
