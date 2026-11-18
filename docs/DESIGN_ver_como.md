# Ver como — testar o acesso de outra pessoa sem pedir a senha dela

**Problema.** Para saber se o recorte de alguém ficou certo, hoje é preciso chamar a pessoa e
pedir que ela compartilhe a tela. Isso é lento, depende da agenda dela, e acontece **depois** de
o acesso já estar valendo — quando o erro, se houver, já apareceu para ela.

E é frequente: no dia 18/nov sozinho a pergunta "o que fulano enxerga?" apareceu três vezes
(Rosimeire, Fernando, Ronaldo), e foi respondida por SQL, fora do produto.

---

## O que foi descartado, e por quê

### ❌ Fingir só no frontend
`useCapacidades` e `useUserAccess` leriam as regras da outra pessoa. Menu, botões e combos
ficariam iguais aos dela.

⚠⚠ **É a pior das opções, não a mais simples.** Os dados continuariam vindo pelo **seu** token:
a tela mostraria o recorte dela e a consulta devolveria o seu. Você testaria, veria "funcionando"
e teria testado nada — e a confiança falsa é pior que a ausência do recurso.
É o erro que o **ACS-02** custou: controle que existe na tela e não no banco.

### ❌ Emitir um token da pessoa (edge function com `service_role`)
Funciona de verdade — é o que ferramentas maduras fazem. Mas tem quatro efeitos que esta
instalação não quer pagar:

| | token gerado | cabeçalho (escolhido) |
|---|---|---|
| cria credencial da pessoa | **sim** | não |
| mexe no `último acesso` dela | **sim** — e a tela de Usuários mostra isso | não |
| passa por cima do MFA dela | **sim** | não |
| como se encerra | expira / precisa limpar | fecha a aba |

### ✅ Relatório de acesso efetivo — **complementar, não substituto**
Responde "o que a Fulana vê?" em números sem virar ela. Risco zero e resposta imediata.
Mas **não deixa navegar**, e metade das perguntas é sobre interação ("o botão aparece?").
Vale fazer depois; não resolve este problema.

---

## O desenho escolhido: cabeçalho `x-ver-como`

**Só 19 funções chamam `auth.uid()`** — todo o resto do RLS deriva delas. Então a impersonação
entra num ponto só:

```sql
uid_efetivo()  →  o alvo, se quem chama DE VERDADE é admin e o cabeçalho está presente
                  auth.uid(), caso contrário
```

O frontend manda o cabeçalho num cliente Supabase **separado**; o token continua sendo o do
admin, e o banco resolve o usuário efetivo.

### As 19 funções

```
aprovar_cenario · auditoria_quem · bloquear_versao · current_tenant_id ·
decidir_linha_orcado · decidir_posto_cenario · edit_dim_pessoas · eh_admin ·
eh_dono_card · escopo_dim · escopo_dim_edit · escopo_dim_pessoas ·
get_tenant_users · mesclar_cenario_orcado · pode_aprovar_cenario ·
pode_bloquear_versao · pode_escrever · pode_ver_folha · reabrir_versao
```

⚠ **`auditoria_quem` NÃO é impersonada.** A auditoria registra quem você é, nunca quem você
finge ser. Qualquer outra escolha ali transformaria o recurso numa forma de assinar com a mão
alheia.

⚠ **`eh_admin()` É impersonada**, e isso é o ponto. Impersonando um `member`, ele tem de
devolver **false** — senão você segue ignorando todo o escopo (admin ignora escopo em
`canSee`/`canEdit`) e o teste mente na direção mais perigosa: parece que a pessoa vê mais do
que vê.

---

## A trava que torna isso seguro: **somente leitura, por construção**

```sql
pode_escrever()  =  NÃO está impersonando  E  papel efetivo ∈ (admin, member)
```

**Medido: 165 das 185 políticas de escrita passam por `pode_escrever()`.** Então a sessão vira
somente leitura sem auditar tela por tela.

As **20 restantes** são cadastros de fundação e precisam da negativa explícita:

```
tenant · dimensao · dimensao_config · grupo_empresarial ·
area_funcional · dashboard_card · dashboard_card_acesso
```

E as autoridades que não passam por `pode_escrever()` também respondem **false** impersonando:
`pode_aprovar_cenario()` e `pode_bloquear_versao()`. Carimbo não se dá por procuração.

---

## Por que o risco é menor do que parece

**Impersonar nunca concede o que o admin já não tinha.** Só admin pode, e admin ignora todo o
escopo de dados — então o recurso **reduz** visibilidade, não amplia. Não existe escalada de
privilégio pelo caminho feliz.

⚠ **O risco real é um só: um defeito fazer `uid_efetivo()` aceitar o cabeçalho de quem não é
admin.** É aí que a prova tem de bater, e é a única coisa que pode transformar isto num
vazamento. Tudo o mais é incômodo.

⚠ **O log é informativo, não garantia.** Registramos o início da sessão de "ver como", mas um
admin pode mandar o cabeçalho sem passar pela tela. Dado que ele já alcança tudo, isso não
muda o que ele pode ver — muda só o rastro. Dizer o contrário seria teatro.

---

## Fases

### P1 — banco
1. `impersonando()` e `uid_efetivo()`, com guarda pelo `auth.uid()` **real**.
2. Troca mecânica de `auth.uid()` → `uid_efetivo()` nas 18 (todas menos `auditoria_quem`),
   partindo de `pg_get_functiondef` com **ida-e-volta**, como nas v3_193/194.
3. `pode_escrever()`, `pode_aprovar_cenario()`, `pode_bloquear_versao()` → false impersonando.
4. `AND NOT impersonando()` nas 20 políticas de escrita de fundação.
5. `prova_ver_como.sql`.

### P2 — frontend
6. Cliente Supabase **separado** com o cabeçalho; nunca mexer no cliente padrão.
7. Seletor em Configurações → Usuários ("ver como"), só para quem tem `menu.config`.
8. **Faixa permanente**, de cor inconfundível, com o nome de quem está sendo visto e um "sair"
   sempre visível. ⚠ Admin que esquece que está impersonando e conclui que "o sistema quebrou"
   é o modo de falha mais provável deste recurso.
9. Estado em `sessionStorage`: fechar a aba encerra.

### P3 — depois
10. Log do início ("ver como" em `auditoria`).
11. O **relatório de acesso efetivo**, que continua valendo por si.

---

## A prova (`prova_ver_como.sql`)

Um `DO` só, terminando em `RAISE`, **personificando de verdade** — a lição de
`prova_ratear_orcado.sql`, que morreu por `current_tenant_id()` nulo no SQL Editor.
E **cada recusa confere a mensagem**: `EXCEPTION WHEN others` faz teste passar pelo motivo
errado, e já fez.

O que precisa ser afirmado:

1. **Sem cabeçalho, nada muda** — as contagens de um usuário qualquer são idênticas às de hoje.
   Esta é a asserção mais importante: o recurso não pode mexer em quem não o usa.
2. **Não-admin com o cabeçalho é IGNORADO** — um `member` mandando `x-ver-como` de outro
   continua vendo o dele. É o único caminho que vira vazamento.
3. **Admin impersonando um `member` vê o que o member vê** — contagem de `posto`, `fat_orcado`
   e `fat_folha` idêntica à do member de verdade.
4. **`eh_admin()` devolve false** impersonando um não-admin.
5. **Escrita recusada** em `fat_orcado` e numa das 20 de fundação.
6. **`auditoria_quem` segue devolvendo o admin real.**

⚠ Asserção afirma o **mínimo** necessário: `prova_escopo_pessoas.sql` exigiu "abre tudo" e levou
568 de 570 — o sistema estava certo e a asserção, errada.

---

## O que este recurso **não** resolve

⚠ **Degradação silenciosa.** A tela que mostra `0` onde deveria dizer "sem acesso" continua
mentindo — impersonando você vê o `0` igualzinho, e ele parece um dado. Os dois casos conhecidos
(salário mascarado virando `R$ 0`; a aba Análise Pessoas dizendo "sem orçado" num timeout)
só apareceram porque alguém **conferiu o número contra outra fonte**, não porque a tela acusou.
Ver como outra pessoa ajuda a achar o que **some**; não ajuda a achar o que **mente**.
