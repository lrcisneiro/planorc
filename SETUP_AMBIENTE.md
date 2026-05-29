# Planorc — Setup do Ambiente de Desenvolvimento (Mac)

Guia passo a passo para sair do zero até o projeto rodando localmente e publicado na nuvem.

---

## 1. Ferramentas Essenciais

### 1.1 Homebrew (gerenciador de pacotes do Mac)
Equivalente ao antigo "baixar instalador" — instala tudo via linha de comando.

Abra o **Terminal** (Cmd+Espaço → "Terminal") e cole:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Siga as instruções na tela. Ao final, rode:
```bash
brew --version
```
Se aparecer um número de versão, funcionou.

---

### 1.2 Node.js (runtime JavaScript/TypeScript)
O React precisa do Node para rodar localmente.

```bash
brew install node
node --version   # deve aparecer v20.x ou superior
npm --version    # gerenciador de pacotes do Node
```

---

### 1.3 Python 3 (para o backend FastAPI)
O Mac já tem Python, mas vamos garantir a versão correta:

```bash
brew install python@3.12
python3 --version   # deve aparecer 3.12.x
pip3 --version
```

---

### 1.4 Git (controle de versão)
```bash
brew install git
git --version
```

Configure seu nome e e-mail (aparece nos commits):
```bash
git config --global user.name "Ricardo Cisneiro"
git config --global user.email "lrcisneiro@gmail.com"
```

---

### 1.5 VS Code (editor de código)
O editor mais popular para desenvolvimento moderno. Muito mais poderoso que qualquer IDE dos anos 90.

Baixe em: **https://code.visualstudio.com**

Depois de instalar, abra o VS Code e instale estas extensões (Cmd+Shift+X):
- **ESLint** — verifica erros no código
- **Prettier** — formata código automaticamente
- **Tailwind CSS IntelliSense** — autocomplete do Tailwind
- **Python** (da Microsoft) — suporte Python
- **GitLens** — visualiza histórico Git dentro do editor
- **Thunder Client** — testa APIs como o antigo Postman

---

## 2. Contas na Nuvem (todas gratuitas para começar)

### 2.1 GitHub
Repositório de código — onde o projeto fica guardado e versionado.

1. Acesse **https://github.com** → Sign up
2. Use o e-mail lrcisneiro@gmail.com
3. Escolha o plano **Free**

Depois de criar a conta, conecte o Git local ao GitHub:
```bash
# Gera uma chave SSH (senha criptográfica para autenticar sem digitar senha)
ssh-keygen -t ed25519 -C "lrcisneiro@gmail.com"
# Pressione Enter 3 vezes (aceita caminho padrão, sem senha)

# Copia a chave pública
cat ~/.ssh/id_ed25519.pub
```
Copie o texto que aparecer → GitHub → Settings → SSH Keys → New SSH Key → Cole e salve.

---

### 2.2 Supabase (banco de dados PostgreSQL na nuvem + auth)
Substitui: banco local + servidor de autenticação + API REST.

1. Acesse **https://supabase.com** → Start for free
2. Faça login com a conta GitHub (mais prático)
3. Crie um novo projeto:
   - **Name**: valore
   - **Database Password**: anote bem (ex: `Planorc@2026#db`)
   - **Region**: South America (São Paulo)
4. Aguarde ~2 minutos para o projeto ser criado

Anote as credenciais do projeto (Settings → API):
- **Project URL**: `https://xxxxxxxxxxxx.supabase.co`
- **anon public key**: `eyJhb...` (chave longa)

---

### 2.3 Vercel (hospedagem do frontend)
Deploy automático a cada `git push`. Zero configuração de servidor.

1. Acesse **https://vercel.com** → Sign up with GitHub
2. Por enquanto só crie a conta — vamos conectar ao repositório depois

---

## 3. Criando o Projeto

### 3.1 Criar o repositório no GitHub
1. GitHub → **New repository**
2. Nome: `planorc`
3. Privado (Private) ✓
4. Marque "Add a README file"
5. Clique **Create repository**

### 3.2 Clonar o repositório no Mac
```bash
# Escolha onde vai ficar o projeto (ex: sua pasta de projetos)
cd ~/Documents
git clone git@github.com:SEU_USUARIO/planorc.git
cd planorc
```

### 3.3 Criar o projeto React com Vite
Dentro da pasta do repositório:

```bash
# Cria o frontend
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install

# Instala Tailwind CSS
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p

# Instala dependências do projeto
npm install @supabase/supabase-js
npm install react-router-dom
npm install @tanstack/react-query
npm install recharts
npm install lucide-react

# Testa se está funcionando
npm run dev
```

Abra **http://localhost:5173** no navegador — deve aparecer a página inicial do Vite.

### 3.4 Criar o backend Python
```bash
# Volta para a raiz do projeto
cd ..

# Cria o backend
mkdir backend
cd backend

# Cria ambiente virtual Python (isolamento de dependências — como um projeto Delphi separado)
python3 -m venv .venv
source .venv/bin/activate   # ativa o ambiente

# Instala as dependências
pip install fastapi uvicorn supabase python-dotenv pydantic

# Testa
uvicorn main:app --reload
```

---

## 4. Estrutura de Pastas do Projeto

```
planorc/
├── frontend/               # React + TypeScript (o que o usuário vê)
│   ├── src/
│   │   ├── components/     # Componentes reutilizáveis (botões, inputs, tabelas)
│   │   ├── pages/          # Telas completas (DRE, Orçamento, Configurações)
│   │   ├── hooks/          # Lógica reutilizável (buscar dados, filtros)
│   │   ├── lib/            # Configurações (Supabase client, etc.)
│   │   └── types/          # Tipos TypeScript (interfaces das entidades)
│   └── ...
├── backend/                # Python + FastAPI (regras de negócio, APIs)
│   ├── main.py             # Ponto de entrada
│   ├── routes/             # Endpoints da API (/dre, /orcamento, etc.)
│   ├── models/             # Modelos de dados
│   └── services/           # Lógica de negócio
├── supabase/
│   └── migrations/         # Scripts SQL versionados
│       └── 001_schema_inicial.sql
└── README.md
```

---

## 5. Fluxo de Trabalho Diário

```
1. Abrir Terminal
2. cd ~/Documents/planorc
3. code .                    ← abre o VS Code na pasta do projeto
4. cd frontend && npm run dev ← inicia o frontend local
5. cd ../backend && source .venv/bin/activate && uvicorn main:app --reload
6. Editar código no VS Code
7. git add . && git commit -m "descrição do que foi feito"
8. git push                  ← Vercel faz deploy automático em ~30 segundos
```

---

## 6. Conceitos Novos para Você

| Conceito novo | Paralelo com o que você conhece |
|--------------|--------------------------------|
| `npm install` | Como instalar componentes no Delphi, mas via linha de comando |
| `npm run dev` | Como F9 no Delphi — compila e roda |
| Componente React | Form/Frame do Delphi: tem visual, propriedades e eventos |
| `useState` | Variável que, quando muda, re-renderiza a tela automaticamente |
| `async/await` | Como threads, mas mais simples — espera resposta sem travar a UI |
| API REST | Como uma DLL remota via HTTP — você chama funções e recebe JSON |
| TypeScript | Pascal moderno — tem tipos, interfaces, é compilado antes de rodar |
| Git commit | Checkpoint — como salvar versão numerada de um release |
| `.env` | Arquivo de configuração com senhas (não vai pro GitHub) |
| Supabase | Servidor de banco + Delphi DataModule pré-configurado na nuvem |

---

## Próximos Passos Após o Setup

1. ✅ Ambiente instalado
2. ⬜ Criar tabelas no Supabase (usar o arquivo `001_schema_inicial.sql`)
3. ⬜ Primeira tela funcional: login + dashboard DRE
4. ⬜ Conectar ao Supabase e buscar dados reais
5. ⬜ Deploy no Vercel

**Dúvidas?** Pode perguntar em qualquer etapa — estou aqui para ajudar.
