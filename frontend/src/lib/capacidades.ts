// ============================================================
// Catálogo de capacidades — cruza MENUS × FUNÇÕES × ACESSO.
// Fonte única do que é "gateável" no app. Adicionar um menu/função
// novo no futuro = adicionar uma entrada aqui; o controle já passa a existir.
//
// Cada capacidade tem um padrão por papel (admin/member/viewer).
// (Próximo incremento: override por usuário em user_acesso_funcao.)
// ============================================================
export type Papel = 'admin' | 'member' | 'viewer'

export type Capacidade = {
  key: string
  label: string
  categoria: 'Funções' | 'Menu'
  padrao: Record<Papel, boolean>
}

export const CAPACIDADES: Capacidade[] = [
  // ── Funções (capacidades de ação) ──
  { key: 'orcar',     label: 'Orçar (editar valores do orçado)', categoria: 'Funções', padrao: { admin: true,  member: true,  viewer: false } },
  { key: 'estrutura', label: 'Editar estrutura de relatórios',    categoria: 'Funções', padrao: { admin: true,  member: false, viewer: false } },

  // ── Menu (itens de navegação) ──
  { key: 'menu.dashboards', label: 'Dashboards',              categoria: 'Menu', padrao: { admin: true, member: true,  viewer: true  } },
  { key: 'menu.relatorios', label: 'Relatórios',              categoria: 'Menu', padrao: { admin: true, member: true,  viewer: true  } },
  { key: 'menu.orcamento',  label: 'Orçamento',               categoria: 'Menu', padrao: { admin: true, member: true,  viewer: false } },
  { key: 'menu.estruturas', label: 'Estruturas de relatórios', categoria: 'Menu', padrao: { admin: true, member: false, viewer: false } },
  { key: 'menu.realizado',  label: 'Realizado',               categoria: 'Menu', padrao: { admin: true, member: true,  viewer: false } },
  { key: 'menu.saldos',     label: 'Saldos (BP)',             categoria: 'Menu', padrao: { admin: true, member: true,  viewer: false } },
  { key: 'menu.amarracao',  label: 'Amarração',               categoria: 'Menu', padrao: { admin: true, member: true,  viewer: false } },
  { key: 'menu.cadastros',  label: 'Cadastros',               categoria: 'Menu', padrao: { admin: true, member: true,  viewer: false } },
  { key: 'menu.config',     label: 'Configurações',           categoria: 'Menu', padrao: { admin: true, member: false, viewer: false } },
]

export const CAP_BY_KEY: Record<string, Capacidade> = Object.fromEntries(CAPACIDADES.map(c => [c.key, c]))
