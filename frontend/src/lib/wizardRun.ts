// ============================================================
// Executor dos wizards de formulário (catálogo em ./wizards.ts).
//
// Cria a estrutura, lê as fontes, grava os valores com `gerado = true` e
// devolve um resumo com os avisos que o usuário precisa ver.
//
// Re-gerar é a mesma rotina com `formularioId`: apaga SÓ as células geradas e
// escreve de novo. Correção feita à mão (gerado = false) sobrevive — é o que
// torna o dado copiado aceitável, porque a exceção por filial não se perde.
// ============================================================
import { supabase, TENANT_ID } from './supabase'
import { contasDeDestino, type Fonte, type Wizard, type WizardLinha } from './wizards'

export type WizardParams = {
  codigo: string
  nome: string
  versaoId: string
  ano: number
  /** re-geração: preenche este formulário em vez de criar um novo */
  formularioId?: string
}
export type WizardResultado = {
  formularioId: string
  escopos: number
  celulas: number
  avisos: string[]
}

type Escopo = { e: string; f: string | null; c: string | null }
const chave = (x: Escopo) => `${x.e}|${x.f ?? ''}|${x.c ?? ''}`

/** Soma do orçado por escopo × mês, via RPC (devolve jsonb: sem o corte de 1000 do PostgREST). */
async function lerOrcado(f: Extract<Fonte, { tipo: 'ORCADO' }>, w: Wizard, p: WizardParams) {
  const { data, error } = await supabase.rpc('wizard_orcado_por_escopo', {
    p_versao: p.versaoId,
    p_ano: p.ano,
    p_natureza: f.natureza ?? null,
    // A INVARIANTE: um wizard nunca lê o que ele escreve. Sem excluir as contas
    // de destino, o resultado entraria na própria base na segunda geração e
    // cresceria a cada execução.
    p_excluir_contas: contasDeDestino(w),
    p_excluir_linhas: f.excluirLinhas ?? [],
  })
  if (error) throw new Error('Erro ao ler o orçado: ' + error.message)
  return (data || []) as { e: string; f: string | null; c: string | null; m: number; v: number }[]
}

export async function executarWizard(w: Wizard, p: WizardParams): Promise<WizardResultado> {
  const avisos: string[] = []

  // ── 1 · contas de destino: resolver ANTES de criar nada
  const codigos = contasDeDestino(w)
  const contaId: Record<string, string> = {}
  if (codigos.length) {
    const { data, error } = await supabase.from('conta_orcamentaria').select('id,codigo').in('codigo', codigos)
    if (error) throw new Error('Erro ao buscar as contas de destino: ' + error.message)
    for (const c of data || []) contaId[c.codigo] = c.id
    const faltando = codigos.filter(c => !contaId[c])
    if (faltando.length) {
      throw new Error(
        `Conta orçamentária não encontrada: ${faltando.join(', ')}. ` +
        'Cadastre-a em Cadastros › Estrutura antes de gerar — sem ela o Aplicar não teria onde gravar.')
    }
  }

  // ── 2 · ler as fontes ANTES de criar o formulário.
  // Se a versão estiver vazia, é melhor falhar aqui do que deixar um
  // formulário vazio no hub para o usuário descobrir depois.
  const dadosOrcado = new Map<string, { e: string; f: string | null; c: string | null; m: number; v: number }[]>()
  for (const l of w.linhas) {
    if (l.fonte?.tipo === 'ORCADO') dadosOrcado.set(l.codigo, await lerOrcado(l.fonte, w, p))
  }
  const escopos = new Map<string, Escopo>()
  for (const linhas of dadosOrcado.values())
    for (const r of linhas) escopos.set(chave(r), { e: r.e, f: r.f, c: r.c })

  if (dadosOrcado.size && !escopos.size) {
    throw new Error(
      'Nenhum escopo com valor nessa versão e ano — nada a gerar. ' +
      'Confira se o orçado já foi aplicado na versão escolhida.')
  }

  // ── 3 · cadastro (hoje só filial): valor por filial, repetido nos 12 meses
  const porFilial: Record<string, number> = {}
  const precisaCadastro = w.linhas.some(l => l.fonte?.tipo === 'CADASTRO')
  if (precisaCadastro) {
    const campo = (w.linhas.find(l => l.fonte?.tipo === 'CADASTRO')!.fonte as any).campo as string
    // catálogo pequeno: dispensa pageAll (convenção do CLAUDE.md)
    const { data, error } = await supabase.from('filial').select(`id,codigo,descricao,${campo}`)
    if (error) throw new Error('Erro ao ler o cadastro de filiais: ' + error.message)
    // ZERO é alíquota real (exterior, compartilhada), NULO é cadastro faltando.
    // Tratar os dois igual acusaria quem está certo e esconderia quem não está.
    const semValor: string[] = []
    const zerados: string[] = []
    const comEscopo = new Set(Array.from(escopos.values()).map(x => x.f).filter(Boolean) as string[])
    for (const fi of (data || []) as any[]) {
      if (fi[campo] == null) {
        if (comEscopo.has(fi.id)) semValor.push(`${fi.codigo} · ${fi.descricao}`)
        continue
      }
      porFilial[fi.id] = Number(fi[campo])
      if (Number(fi[campo]) === 0 && comEscopo.has(fi.id)) zerados.push(`${fi.codigo} · ${fi.descricao}`)
    }
    if (semValor.length) {
      avisos.push(
        `${semValor.length} filial(is) têm receita orçada e estão SEM o campo "${campo}" no cadastro, ` +
        `então o resultado delas sai zero: ${semValor.join(' · ')}.`)
    }
    if (zerados.length) {
      avisos.push(
        `${zerados.length} filial(is) estão com "${campo}" = 0 e têm receita: ${zerados.join(' · ')}. ` +
        'Se for alíquota zero mesmo (exterior, compartilhada), está certo — o aviso é só para o zero ser uma decisão e não um esquecimento.')
    }
    const semFilial = Array.from(escopos.values()).filter(x => !x.f).length
    if (semFilial) {
      avisos.push(
        `${semFilial} escopo(s) têm receita lançada SEM filial. Como a alíquota vem da filial, ` +
        'esses ficam sem percentual — vale conferir o grão desses lançamentos.')
    }
  }

  // ── 4 · criar (ou reaproveitar) o formulário
  let formularioId = p.formularioId
  if (!formularioId) {
    const { data, error } = await supabase.from('formulario').insert({
      tenant_id: TENANT_ID, codigo: p.codigo, nome: p.nome, descricao: w.descricao,
      wizard: w.codigo, wizard_params: { versao_id: p.versaoId, ano: p.ano, gerado_em: new Date().toISOString() },
    }).select('id').single()
    if (error) {
      throw new Error(error.code === '23505'
        ? `Já existe um formulário com o código "${p.codigo}". Escolha outro.`
        : 'Erro ao criar o formulário: ' + error.message)
    }
    formularioId = data!.id
  } else {
    await supabase.from('formulario').update({
      wizard: w.codigo, wizard_params: { versao_id: p.versaoId, ano: p.ano, gerado_em: new Date().toISOString() },
    }).eq('id', formularioId)
  }

  // ── 5 · estrutura
  const linhaPayload = w.linhas.map((l: WizardLinha, i) => ({
    formulario_id: formularioId, codigo: l.codigo, descricao: l.descricao,
    ordem: (i + 1) * 10, nivel: 1, tipo_linha: l.tipo_linha,
    expressao: l.expressao ?? null, natureza: l.natureza,
    formato: l.formato, casas_decimais: l.casas ?? 2,
    conta_destino_id: l.contaDestino ? contaId[l.contaDestino] : null,
  }))
  const { error: errL } = await supabase.from('formulario_linha')
    .upsert(linhaPayload, { onConflict: 'formulario_id,codigo' })
  if (errL) throw new Error('Erro ao criar as linhas: ' + errL.message)

  const { data: linhasDb, error: errLd } = await supabase.from('formulario_linha')
    .select('id,codigo').eq('formulario_id', formularioId)
  if (errLd) throw new Error('Erro ao reler as linhas: ' + errLd.message)
  const linhaId: Record<string, string> = {}
  for (const l of linhasDb || []) linhaId[l.codigo] = l.id

  // ── 6 · apagar só o que um wizard gerou antes (re-geração)
  const ids = Object.values(linhaId)
  if (ids.length) {
    const { error } = await supabase.from('formulario_valor').delete()
      .eq('formulario_id', formularioId).eq('versao_id', p.versaoId)
      .eq('ano', p.ano).eq('gerado', true).in('linha_id', ids)
    if (error) throw new Error('Erro ao limpar a geração anterior: ' + error.message)
  }

  // ── 7 · valores
  const base = { tenant_id: TENANT_ID, formulario_id: formularioId, versao_id: p.versaoId, ano: p.ano, gerado: true, dims: {} }
  const recs: any[] = []
  for (const l of w.linhas) {
    if (!l.fonte) continue
    if (l.fonte.tipo === 'ORCADO') {
      for (const r of dadosOrcado.get(l.codigo) || [])
        recs.push({ ...base, linha_id: linhaId[l.codigo], empresa_id: r.e, filial_id: r.f, cc_id: r.c, mes: r.m, valor: r.v, expressao: null })
    } else if (l.fonte.tipo === 'CADASTRO') {
      // Nos DOZE meses, não só nos que têm base: se depois alguém digitar
      // receita num mês vazio, a alíquota já está lá para calcular.
      for (const x of escopos.values()) {
        const pct = x.f ? porFilial[x.f] : undefined
        if (pct == null) continue
        for (let m = 1; m <= 12; m++)
          recs.push({ ...base, linha_id: linhaId[l.codigo], empresa_id: x.e, filial_id: x.f, cc_id: x.c, mes: m, valor: pct, expressao: null })
      }
    }
  }
  for (let i = 0; i < recs.length; i += 500) {
    const { error } = await supabase.from('formulario_valor').insert(recs.slice(i, i + 500))
    if (error) throw new Error('Erro ao gravar os valores: ' + error.message)
  }

  return { formularioId: formularioId!, escopos: escopos.size, celulas: recs.length, avisos }
}
