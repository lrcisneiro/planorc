// Decodificação das dimensões derivadas do Centro de Custo pela POSIÇÃO do código.
// pos1 = Área (sempre); pos2 = Divisão e pos3 = BU (só áreas 2/3/5).
// Mesma lógica da função SQL decodificar_cc() (migration 037).

export const AREA_MAP: Record<string, string> = { '1': 'CSC', '2': 'Comercial', '3': 'Serviços', '4': 'Diretoria', '5': 'Marketing' }
export const DIVISAO_MAP: Record<string, string> = { '1': 'Base', '2': 'Novos' }
export const BU_MAP: Record<string, string> = { '1': 'PC-Sistemas', '2': 'HXM', '3': 'LE Oeste', '4': 'Gestão', '5': 'RD', '6': 'Moda', '7': 'Sustentação', '8': 'Smart ERP' }
const COM_DIVISAO = new Set(['2', '3', '5'])  // áreas que têm Divisão/BU

export type CCDims = { area_cod: string | null; area_nome: string | null; divisao_cod: string | null; divisao_nome: string | null; bu_cod: string | null; bu_nome: string | null }

export function decodeCC(codigo: string): CCDims {
  const c = (codigo || '').trim()
  const a = c[0] || ''
  const r: CCDims = { area_cod: a || null, area_nome: AREA_MAP[a] || null, divisao_cod: null, divisao_nome: null, bu_cod: null, bu_nome: null }
  if (COM_DIVISAO.has(a)) {
    if (c.length >= 2) { r.divisao_cod = c[1]; r.divisao_nome = DIVISAO_MAP[c[1]] || null }
    if (c.length >= 3) { r.bu_cod = c[2]; r.bu_nome = BU_MAP[c[2]] || null }
  }
  return r
}
