#!/bin/bash
# ============================================================
# Planorc FP&A — Script de criação do projeto
# Execute UMA VEZ após clonar o repositório do GitHub:
#   cd ~/Documents/planorc-fpa
#   bash criar_projeto_planorc.sh
# ============================================================

set -e  # Para se der erro

echo "🚀 Criando projeto Planorc FP&A..."

# ── Frontend ──────────────────────────────────────────────
echo ""
echo "📦 Configurando frontend (React + Vite + TypeScript)..."
npm create vite@latest frontend -- --template react-ts

cd frontend

# Dependências principais
npm install
npm install @supabase/supabase-js
npm install react-router-dom
npm install @tanstack/react-query
npm install recharts
npm install lucide-react
npm install clsx

# Tailwind
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p

# Configura Tailwind
cat > tailwind.config.js << 'EOF'
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50:  '#f0f4ff',
          500: '#3b5bdb',
          600: '#364fc7',
          700: '#2f44b3',
        }
      }
    },
  },
  plugins: [],
}
EOF

# Adiciona diretivas Tailwind ao CSS principal
cat > src/index.css << 'EOF'
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  font-family: 'Inter', system-ui, sans-serif;
}

body {
  background-color: #f8f9fa;
  color: #212529;
}
EOF

# Cria estrutura de pastas
mkdir -p src/components/ui
mkdir -p src/components/layout
mkdir -p src/pages/dre
mkdir -p src/pages/orcamento
mkdir -p src/pages/configuracoes
mkdir -p src/hooks
mkdir -p src/lib
mkdir -p src/types

# Cliente Supabase
cat > src/lib/supabase.ts << 'EOF'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Variáveis VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY não configuradas no .env')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
EOF

# Tipos TypeScript principais
cat > src/types/index.ts << 'EOF'
// ── Entidades principais ──────────────────────────────────

export interface Empresa {
  id: string
  codigo: string
  descricao: string
  ativo: boolean
}

export interface Filial {
  id: string
  empresa_id: string
  codigo: string
  descricao: string
  imp_fat: number
  ativo: boolean
  empresa?: Empresa
}

export interface CentroCusto {
  id: string
  codigo: string
  descricao: string
  nivel: 1 | 2 | 3
  pai_id: string | null
  area?: string
  divisao?: string
  bu?: string
  ativo: boolean
  filhos?: CentroCusto[]
}

export interface PlanoOrcamentario {
  id: string
  codigo: string
  descricao: string
  nivel: 1 | 2 | 3
  pai_id: string | null
  n1_codigo?: string
  n2_codigo?: string
  grupo_folha: boolean
  natureza: 'RECEITA' | 'DESPESA' | 'NEUTRO'
  aceita_lancamento: boolean
  ativo: boolean
  filhos?: PlanoOrcamentario[]
}

export interface VersaoOrcamento {
  id: string
  codigo: string
  descricao: string
  ano: number
  tipo: 'BASELINE' | 'REVISAO' | 'FORECAST' | 'REALIZADO'
  status: 'RASCUNHO' | 'EM_APROVACAO' | 'APROVADO' | 'FECHADO'
}

export interface Lancamento {
  id: string
  versao_id: string
  item_orc_id: string
  empresa_id: string
  filial_id?: string
  cc_id?: string
  ano: number
  mes: number
  valor: number
  tipo_lancamento: 'ORCADO' | 'REALIZADO' | 'FORECAST'
  dim_values: Record<string, string>
  matricula?: string
  nome_funcionario?: string
}

// ── DRE ──────────────────────────────────────────────────

export interface DRELinha {
  codigo: string
  descricao: string
  nivel: 1 | 2 | 3
  natureza: 'RECEITA' | 'DESPESA' | 'NEUTRO'
  meses: {
    [mes: number]: {
      orcado: number
      realizado: number
    }
  }
  ytd: {
    orcado: number
    realizado: number
  }
  filhos?: DRELinha[]
}
EOF

# Variáveis de ambiente
cat > .env.example << 'EOF'
VITE_SUPABASE_URL=https://SEU_PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=sua_chave_anon_aqui
EOF

cp .env.example .env

# App.tsx inicial com roteamento
cat > src/App.tsx << 'EOF'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Layout from './components/layout/Layout'
import DrePage from './pages/dre/DrePage'

const queryClient = new QueryClient()

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Navigate to="/dre" replace />} />
            <Route path="dre" element={<DrePage />} />
            {/* mais rotas aqui */}
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
EOF

# Layout principal (sidebar + conteúdo)
cat > src/components/layout/Layout.tsx << 'EOF'
import { Outlet, NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  TrendingUp,
  Table2,
  Settings,
  Building2
} from 'lucide-react'

const navItems = [
  { to: '/dre',          icon: TrendingUp,      label: 'DRE' },
  { to: '/orcamento',    icon: Table2,           label: 'Orçamento' },
  { to: '/dashboard',    icon: LayoutDashboard,  label: 'Dashboard' },
  { to: '/configuracoes',icon: Settings,         label: 'Config.' },
]

export default function Layout() {
  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-16 bg-[#1e2d5a] flex flex-col items-center py-4 gap-2">
        <div className="w-10 h-10 bg-blue-500 rounded-lg flex items-center justify-center mb-4">
          <Building2 className="text-white" size={20} />
        </div>
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `w-12 h-12 rounded-lg flex flex-col items-center justify-center gap-0.5 text-[10px] transition-colors
              ${isActive
                ? 'bg-blue-500 text-white'
                : 'text-gray-400 hover:bg-white/10 hover:text-white'
              }`
            }
          >
            <Icon size={18} />
            <span>{label}</span>
          </NavLink>
        ))}
      </aside>

      {/* Conteúdo */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
EOF

# Página DRE inicial (placeholder)
cat > src/pages/dre/DrePage.tsx << 'EOF'
export default function DrePage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold text-gray-800 mb-1">
        DRE — Orçado × Realizado
      </h1>
      <p className="text-gray-500 text-sm mb-6">Jan–Abr 2026 · Baseline 2026</p>

      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">
        Conecte o Supabase e os dados aparecerão aqui.
        <br /><br />
        Edite o arquivo <code className="bg-gray-100 px-1 rounded">.env</code> com
        suas credenciais do Supabase.
      </div>
    </div>
  )
}
EOF

echo "✅ Frontend configurado!"
cd ..

# ── Backend ──────────────────────────────────────────────
echo ""
echo "🐍 Configurando backend (Python + FastAPI)..."
mkdir -p backend
cd backend

python3 -m venv .venv
source .venv/bin/activate

pip install fastapi uvicorn supabase python-dotenv pydantic --quiet

cat > main.py << 'EOF'
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Planorc FP&A API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def root():
    return {"status": "ok", "app": "Planorc FP&A"}

@app.get("/health")
def health():
    return {"status": "healthy"}
EOF

cat > .env.example << 'EOF'
SUPABASE_URL=https://SEU_PROJETO.supabase.co
SUPABASE_SERVICE_KEY=sua_service_key_aqui
EOF

cp .env.example .env

mkdir -p routes models services

echo "✅ Backend configurado!"
cd ..

# ── README ────────────────────────────────────────────────
cat > README.md << 'EOF'
# Planorc FP&A

Plataforma de Planejamento Financeiro e Controladoria.

## Rodando localmente

### Frontend
```bash
cd frontend
npm run dev
```
Acesse: http://localhost:5173

### Backend
```bash
cd backend
source .venv/bin/activate
uvicorn main:app --reload
```
API: http://localhost:8000
Docs: http://localhost:8000/docs

## Configuração
1. Copie `frontend/.env.example` → `frontend/.env` e preencha as credenciais do Supabase
2. Execute `supabase_001_schema_inicial.sql` no SQL Editor do Supabase
3. Rode o frontend e o backend

## Stack
- Frontend: React + TypeScript + Vite + Tailwind CSS
- Backend: Python + FastAPI
- Banco: PostgreSQL via Supabase
- Deploy: Vercel (frontend) + Railway (backend)
EOF

echo ""
echo "✅ ──────────────────────────────────────────"
echo "   Projeto Planorc criado com sucesso!"
echo ""
echo "   Próximos passos:"
echo "   1. Edite frontend/.env com suas credenciais do Supabase"
echo "   2. Execute supabase_001_schema_inicial.sql no Supabase"
echo "   3. cd frontend && npm run dev"
echo "──────────────────────────────────────────────"
