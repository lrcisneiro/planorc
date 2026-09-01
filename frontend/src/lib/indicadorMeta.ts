// ============================================================
// Metas e faixas de status por indicador (schema_v3_079_indicador_meta.sql).
//
// A meta é cadastrada por linha de relatório e pode ser refinada por ano e por
// empresa. Aqui mora a resolução do mais específico para o mais genérico e a
// classificação do valor na faixa.
// ============================================================
import { supabase } from './supabase'

export type IndicadorMeta = {
  id: string
  linha_id: string
  ano: number | null
  empresa_id: string | null
  maior_melhor: boolean
  excelente: number | null
  saudavel: number | null
  atencao: number | null
  benchmark_ref: string | null
  comentario: string | null
}

export type StatusMeta = 'EXCELENTE' | 'SAUDAVEL' | 'ATENCAO' | 'CRITICO'

export const STATUS_UI: Record<StatusMeta, { label: string; cor: string; fundo: string }> = {
  EXCELENTE: { label: 'Excelente', cor: '#2f9e44', fundo: 'rgba(52,211,153,0.14)' },
  SAUDAVEL:  { label: 'Saudável',  cor: '#1098ad', fundo: 'rgba(34,211,238,0.14)' },
  ATENCAO:   { label: 'Atenção',   cor: '#e67700', fundo: 'rgba(251,191,36,0.16)' },
  CRITICO:   { label: 'Crítico',   cor: '#e03131', fundo: 'rgba(248,113,113,0.14)' },
}

/** Carrega as metas do tenant (catálogo pequeno — uma linha por indicador/ano/empresa). */
export async function carregarMetas(): Promise<IndicadorMeta[]> {
  const { data } = await supabase
    .from('indicador_meta')
    .select('id,linha_id,ano,empresa_id,maior_melhor,excelente,saudavel,atencao,benchmark_ref,comentario')
  return (data || []) as IndicadorMeta[]
}

/**
 * Escolhe a meta mais específica para (linha, ano, empresa): ano e empresa
 * casados valem mais que só o ano, que vale mais que só a empresa, que vale
 * mais que a regra geral (ano e empresa nulos).
 *
 * `empresaId` só deve vir preenchido quando a tela está olhando UMA empresa —
 * num consolidado de várias, a meta por empresa não se aplica e a geral vale.
 */
export function resolverMeta(
  metas: IndicadorMeta[], linhaId: string, ano: number, empresaId: string | null,
): IndicadorMeta | null {
  let melhor: IndicadorMeta | null = null
  let melhorPeso = -1
  for (const m of metas) {
    if (m.linha_id !== linhaId) continue
    if (m.ano != null && m.ano !== ano) continue
    if (m.empresa_id != null && m.empresa_id !== empresaId) continue
    const peso = (m.ano != null ? 2 : 0) + (m.empresa_id != null ? 1 : 0)
    if (peso > melhorPeso) { melhor = m; melhorPeso = peso }
  }
  return melhor
}

/** Classifica o valor na faixa. Retorna null quando a meta não tem nenhum limite. */
export function statusMeta(valor: number, meta: IndicadorMeta | null | undefined): StatusMeta | null {
  if (!meta || !isFinite(valor)) return null
  const { excelente, saudavel, atencao, maior_melhor } = meta
  if (excelente == null && saudavel == null && atencao == null) return null
  const atinge = (limite: number | null) =>
    limite != null && (maior_melhor ? valor >= limite : valor <= limite)
  if (atinge(excelente)) return 'EXCELENTE'
  if (atinge(saudavel)) return 'SAUDAVEL'
  if (atinge(atencao)) return 'ATENCAO'
  return 'CRITICO'
}

/** Texto curto da meta para o card: "Meta 2026 ≥ 1,9 · Crabtree ≥2,0x". */
export function resumoMeta(meta: IndicadorMeta | null | undefined, casas = 2): string {
  if (!meta) return ''
  const alvo = meta.saudavel ?? meta.excelente ?? meta.atencao
  if (alvo == null) return meta.benchmark_ref || ''
  const num = alvo.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })
  const partes = [`Meta${meta.ano ? ` ${meta.ano}` : ''} ${meta.maior_melhor ? '≥' : '≤'} ${num}`]
  if (meta.benchmark_ref) partes.push(meta.benchmark_ref)
  return partes.join(' · ')
}
