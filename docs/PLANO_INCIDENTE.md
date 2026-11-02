# Plano de resposta a incidentes — Planorc

> **MON-02.** Uma página, de propósito. Plano de incidente que ninguém lê
> inteiro no dia do incidente não é plano. Este cabe numa tela e começa pelo
> que se faz nos primeiros cinco minutos.

**Responsável:** Ricardo Cisneiro · **Suplente:** *(definir — hoje não há)*
**Última revisão:** 02/11/2026

---

## O que conta como incidente

Qualquer um destes, sem precisar de certeza:

- alguém viu dado que não devia — em especial **folha nominal de sócios ou diretoria**;
- chave `service_role` ou credencial do banco exposta (commit, print, mensagem);
- acesso com credencial de outra pessoa;
- dado apagado ou alterado sem explicação;
- indisponibilidade que não é deploy.

**Na dúvida, é incidente.** O custo de abrir e fechar como falso alarme é uma
hora; o de não abrir é descobrir tarde.

---

## Primeiros 5 minutos

**1. Preservar antes de consertar.** A vontade é corrigir; o primeiro passo é
registrar. Anote hora, o que foi visto e quem avisou. Se possível, print.
Corrigir primeiro apaga a evidência do que aconteceu.

**2. Cortar o acesso da conta envolvida** — Supabase → Authentication → Users →
o usuário → **Ban user**. Derruba as sessões dele.

**3. Se há suspeita de credencial vazada**, ir direto à seção *Revogar chaves*.

**4. Avisar.** Ricardo, e o Fernando quando envolver dado pessoal (ver *LGPD*).

---

## Como cortar acesso

| situação | o que fazer | onde |
|---|---|---|
| Uma pessoa | **Ban user** (derruba sessões) | Authentication → Users |
| Uma pessoa, em definitivo | Excluir pela tela de Configurações | Planorc → Configurações → Usuários |
| Reduzir o que ela vê | Tirar as regras de acesso dela | Configurações → acesso |
| **Todo mundo** | `disable_signup` já está ligado; para derrubar sessões: *Log out all users* | Authentication → Settings |

> **O que NÃO funciona:** mudar o papel para `viewer` não derruba sessão nem
> impede leitura — `viewer` lê tudo o que o escopo dele permite. Para cortar
> leitura, tire as regras de acesso ou banque o usuário.

---

## Revogar chaves

**Chave anônima (`anon`)** — é **pública por natureza**, vai no bundle do site.
Vazamento dela **não é incidente**: o que protege é a RLS, não o segredo da
chave. Não rotacionar por pânico; rotacionar quebra o site até o novo deploy.

**`service_role`** — essa sim. Está apenas nas Edge Functions, como variável de
ambiente.
1. Supabase → Settings → API → **Generate new service_role key**
2. Atualizar o segredo das funções `criar-usuario` e `excluir-usuario`
3. Reimplantar as duas
4. Testar convidar um usuário — se falhar, o segredo não propagou

**Senha do banco** — Settings → Database → Reset database password. Quebra
qualquer conexão direta.

---

## Descobrir o que aconteceu

Desde o `v3_136` existe a tabela **`auditoria`** (só admin lê). Ela cobre
mudança de papel, mudança de regra de acesso e **operação destrutiva em massa**.

```sql
-- últimas 50 ações sensíveis
select quando, origem, coalesce(quem::text,'(privilegiada)') as quem,
       quem_papel, tabela, operacao, linhas, detalhe
  from auditoria order by quando desc limit 50;

-- tudo o que uma pessoa fez
select * from auditoria where quem = '<uuid>' order by quando desc;

-- só as destruições em massa
select quando, quem, tabela, linhas, detalhe
  from auditoria where linhas is not null order by quando desc;
```

**O que a auditoria NÃO cobre, e precisa ser dito:**

- **Leitura.** Ela registra escrita. Quem *viu* a folha não fica registrado —
  para isso dependemos dos logs do Supabase (Logs → API), que guardam por
  período limitado conforme o plano.
- **`origem = 'privilegiada'`** significa que a ação veio do SQL Editor, onde
  `auth.uid()` é nulo. A trilha diz *o quê*, não *quem* — a atribuição depende
  dos logs de acesso do painel.
- **Edição de célula do orçado** fica de fora de propósito: é a operação mais
  frequente e a menos sensível.

---

## Restaurar dado

Backup automático do Supabase (Database → Backups).

> ⚠ **A restauração nunca foi testada** (INF-07). Em incidente real, trate o
> tempo de restauração como desconhecido e comunique isso. Testar uma vez, fora
> de incidente, é o que transforma backup em backup.

Para perda **parcial** — uma versão de orçado, um lote de folha — reimportar
costuma ser mais rápido e seguro que restaurar o banco inteiro.

---

## LGPD — quando comunicar

O sistema guarda **nome, matrícula, centro de custo, salário e verbas**,
inclusive de sócios e diretoria. Se o incidente envolveu acesso indevido a isso:

1. Registrar o que foi acessado, por quem, quando e por quanto tempo.
2. Acionar o **Fernando** — a decisão de comunicar a ANPD e os titulares não é
   do time de desenvolvimento.
3. Prazo da ANPD para comunicação de incidente relevante: **2 dias úteis**.

> ⚠ **PRV-01 está aberto:** não há base legal registrada, política de
> privacidade nem prazo de retenção. Num incidente isso pesa — a ausência é
> perguntada antes do incidente em si.

---

## Depois: fechar o ciclo

1. **O que falhou** — mecanismo, não pessoa.
2. **O que teria impedido** — e se é barato, fazer agora.
3. **Atualizar esta página.** Plano de incidente que não muda depois de um
   incidente não aprendeu nada.
4. **Registrar no Anexo A** se o incidente tocou requisito aberto.

---

## Lacunas conhecidas deste plano

Ditas aqui porque plano que esconde a própria fragilidade é pior que nenhum:

- **Sem suplente.** Se o Ricardo estiver indisponível, não há segundo acionável.
  É a lacuna mais barata de fechar e a mais cara de descobrir na hora.
- **Sem alerta automático** (MON-03). Todo incidente hoje depende de alguém
  perceber e avisar.
- **Restauração não testada** (INF-07).
- **Sem ambiente de teste** (SEC-05) — correção emergencial vai direto em
  produção, sem ensaio.
