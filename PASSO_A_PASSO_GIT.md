# Passo a passo — preservar o Planorc atual e abrir a versão v2

> Rode estes comandos no **Terminal do seu Mac**, dentro da pasta do projeto.
> (Eu não consigo rodar git daqui; quem executa é você.)

## Modelo mental (30 segundos)

- **`main`** = seu Planorc atual, que funciona. É o **cofre**. A gente não mexe nele até ter certeza.
- **branch** = uma **oficina** paralela, uma cópia onde a gente experimenta. Mexer na oficina **não toca** no cofre.
- **commit** = tirar uma *foto* (ponto de salvamento) do estado atual.
- **merge** = quando a oficina ficou boa, trazer o trabalho de volta para o cofre.
- Se algo der errado na oficina, você volta para o cofre e está tudo como antes.

Hoje sua situação: o cofre (`main`) está intacto. Já existe uma oficina chamada `feat/dre-v2` com o começo da v2, **mais um monte de trabalho ainda não salvo**. Vamos salvar esse trabalho e organizar os nomes.

---

## 1. Entrar na pasta do projeto

```bash
cd ~/Documents/planorc
```

## 2. Remover a trava do git que ficou da sessão

```bash
rm -f .git/index.lock
```
> Isso apaga um arquivo de "trava" que sobrou. É inofensivo — o git recria quando precisa.

## 3. Ver onde você está (conferência, não muda nada)

```bash
git branch          # mostra os branches; o * marca onde você está (deve ser feat/dre-v2)
git status          # lista o que está modificado e o que é novo
```

## 4. Salvar TUDO que está em aberto na oficina (branch atual)

```bash
git add -A
git commit -m "Trabalho em andamento + base da v2 (protótipos, presets, DRE)"
```
> `git add -A` marca todas as mudanças (modificadas e novas) para salvar.
> `git commit` tira a foto. Agora **nada se perde** — está tudo guardado no branch.

## 5. (Opcional) Renomear a oficina para o nome da nova versão

```bash
git branch -m feat/dre-v2 feat/v2-dark
```
> Só troca o nome do branch para algo mais claro ("v2 tema dark"). Não muda o conteúdo.

## 6. Conferir que o cofre (main) continua intocado

```bash
git branch                 # agora você está em feat/v2-dark; main aparece na lista
git log main --oneline -1  # mostra o último commit do main (o antigo, preservado)
```

---

## Como olhar a versão antiga e voltar

```bash
git checkout main         # sua pasta vira a versão ANTIGA (o cofre). Olhe à vontade.
git checkout feat/v2-dark # volta para a versão NOVA (a oficina)
```
> Trocar de branch troca os arquivos na sua pasta para os daquela versão. Sempre dá pra ir e voltar.
> Dica: pare o `npm run dev` antes de trocar, e rode de novo depois.

## Quando a v2 estiver aprovada (lá na frente)

```bash
git checkout main
git merge feat/v2-dark    # traz a nova versão para o cofre
```
> Só faça isso quando estiver satisfeito. Até lá, o main fica como está.

## Se algo der errado e você quiser "jogar a oficina fora"

```bash
git checkout main
git branch -D feat/v2-dark   # apaga o branch da v2; o main não é afetado
```

---

## Resumo

- `main` = preservado, sua versão atual.
- `feat/v2-dark` = onde fazemos a reestilização v2.
- Nada se perde: tudo virou um commit no passo 4.
- Para rodar o app em qualquer branch: `cd frontend && npm run dev`.
