// ============================================================
// Executor dos wizards (catálogo em ./wizards.ts, leitores em ./wizardFontes.ts).
//
// Faz só o caminho de ESCRITA, igual para todos: resolve as contas de destino,
// cria o formulário, grava a estrutura, apaga a geração anterior e insere os
// valores com `gerado = true`. Quem sabe de onde vem o número é o wizard, no
// seu `preparar` — porque dois wizards leem coisas muito diferentes e um
// "motor de fontes" declarativo só esconderia isso atrás de configuração.
//
// Re-gerar é a mesma rotina com `formularioId`: apaga SÓ as células geradas e
// escreve de novo. Correção feita à mão (gerado = false) sobrevive — é o que
// torna o dado copiado aceitável, porque a exceção por filial não se perde.
// ============================================================
import { supabase, TENANT_ID } from './supabase'
import type { Preparado, Wizard } from './wizards'

export type WizardParams = {
  codigo: string
  nome: string
  /** versão em que os valores são gravados */
  versaoId: string
  /** ano em que os valores são gravados */
  ano: number
  /** parâmetros próprios do wizard */
  p: Record<string, any>
  /** re-geração: preenche este formulário em vez de criar um novo */
  formularioId?: string
}
export type WizardResultado = {
  formularioId: string
  escopos: number
  celulas: number
  linhas: number
  avisos: string[]
}

export async function executarWizard(w: Wizard, args: WizardParams): Promise<WizardResultado> {
  // ── 1 · o wizard lê o que precisa e devolve estrutura + valores.
  // Antes de criar qualquer coisa: se a origem estiver vazia, é melhor falhar
  // aqui do que deixar um formulário vazio no hub para o usuário descobrir.
  const prep: Preparado = await w.preparar(args.p)
  if (!prep.linhas.length) throw new Error('O wizard não produziu nenhuma linha — nada a gerar.')

  // ── 2 · contas de destino por código (as dinâmicas já vêm com id)
  const codigos = Array.from(new Set(prep.linhas.map(l => l.contaDestino).filter((c): c is string => !!c)))
  const contaId: Record<string, string> = {}
  if (codigos.length) {
    const { data, error } = await supabase.from('conta_orcamentaria').select('id,codigo').in('codigo', codigos)
    if (error) throw new Error('Erro ao buscar as contas de destino: ' + error.message)
    for (const c of (data || []) as any[]) contaId[c.codigo] = c.id
    const faltando = codigos.filter(c => !contaId[c])
    if (faltando.length) {
      throw new Error(`Conta orçamentária não encontrada: ${faltando.join(', ')}. ` +
        'Cadastre-a em Cadastros › Estrutura antes de gerar — sem ela o Aplicar não teria onde gravar.')
    }
  }

  // ── 3 · formulário
  let formularioId = args.formularioId
  const proc = { wizard: w.codigo, wizard_params: { ...args.p, versao_id: args.versaoId, ano: args.ano, gerado_em: new Date().toISOString() } }
  if (!formularioId) {
    const { data, error } = await supabase.from('formulario')
      .insert({ tenant_id: TENANT_ID, codigo: args.codigo, nome: args.nome, descricao: w.descricao, ...proc })
      .select('id').single()
    if (error) {
      throw new Error(error.code === '23505'
        ? `Já existe um formulário com o código "${args.codigo}". Escolha outro.`
        : 'Erro ao criar o formulário: ' + error.message)
    }
    formularioId = data!.id
  } else {
    await supabase.from('formulario').update(proc).eq('id', formularioId)
  }

  // ── 4 · estrutura
  const payload = prep.linhas.map((l, i) => ({
    formulario_id: formularioId, codigo: l.codigo, descricao: l.descricao,
    ordem: (i + 1) * 10, nivel: 1, tipo_linha: l.tipo_linha,
    expressao: l.expressao ?? null, natureza: l.natureza,
    formato: l.formato, casas_decimais: l.casas ?? 2,
    conta_destino_id: l.contaDestinoId ?? (l.contaDestino ? contaId[l.contaDestino] : null),
  }))
  const { error: errL } = await supabase.from('formulario_linha').upsert(payload, { onConflict: 'formulario_id,codigo' })
  if (errL) throw new Error('Erro ao criar as linhas: ' + errL.message)

  const { data: linhasDb, error: errLd } = await supabase.from('formulario_linha')
    .select('id,codigo').eq('formulario_id', formularioId)
  if (errLd) throw new Error('Erro ao reler as linhas: ' + errLd.message)
  const linhaId: Record<string, string> = {}
  for (const l of (linhasDb || []) as any[]) linhaId[l.codigo] = l.id

  // ── 5 · apaga só o que um wizard gerou antes
  const ids = Object.values(linhaId)
  if (ids.length) {
    const { error } = await supabase.from('formulario_valor').delete()
      .eq('formulario_id', formularioId).eq('versao_id', args.versaoId)
      .eq('ano', args.ano).eq('gerado', true).in('linha_id', ids)
    if (error) throw new Error('Erro ao limpar a geração anterior: ' + error.message)
  }

  // ── 6 · valores
  const base = { tenant_id: TENANT_ID, formulario_id: formularioId, versao_id: args.versaoId, ano: args.ano, gerado: true, dims: {}, expressao: null }
  const recs = prep.valores
    .filter(v => linhaId[v.linha])
    .map(v => ({
      ...base, linha_id: linhaId[v.linha],
      // escopo global 🌐 = premissa que vale para todas as empresas (v3_050)
      empresa_id: v.escopoGlobal ? null : v.e,
      filial_id:  v.escopoGlobal ? null : v.f,
      cc_id:      v.escopoGlobal ? null : v.c,
      mes: v.m, valor: v.v,
    }))
  for (let i = 0; i < recs.length; i += 500) {
    const { error } = await supabase.from('formulario_valor').insert(recs.slice(i, i + 500))
    if (error) throw new Error('Erro ao gravar os valores: ' + error.message)
  }

  return { formularioId: formularioId!, escopos: prep.escopos, celulas: recs.length, linhas: prep.linhas.length, avisos: prep.avisos }
}
