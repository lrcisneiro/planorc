import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { supabase, TENANT_ID } from '../../lib/supabase'
import { PostosPills, usePassoLabel } from './PostosPills'
import { pageAll } from '../../lib/pageAll'
import { Upload, AlertCircle, Trash2, FileDown } from 'lucide-react'

// Apontamento de horas (F5.2) — importa o "Extrato de Horas Apontadas" do TOTVS
// para fat_apontamento. Base da conciliação Apontamento × Folha.
//
// Lê o .xlsx DIRETO, sem conversor Python: diferente do prgper02, o extrato já
// vem tabular e não precisa de transformação — só de resolução de códigos.
//
// Desenho e medições em docs/DESIGN_conciliacao_apontamento.md.

declare const XLSX: any

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const money = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const hrs = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

// Colunas do extrato. Há nomes repetidos ('Descricao' aparece 5x), então o
// índice é o da PRIMEIRA ocorrência — que é sempre a que interessa.
const COL = {
  empresa: 'Empresa', filial: 'Filial', data: 'Data', os: 'ORDEM_SERVICO',
  recurso: 'Recurso', nome: 'Descricao', custoHora: 'CUSTO_HORA',
  projeto: 'Projeto', horasRv: 'Horas RV', horas: 'Qt. Horas', custo: 'Custo',
  tarefa: 'Tarefa', status: 'Status Aprov', ccProjeto: 'CC_PROJETO', ccRecurso: 'CC_RECURSO',
  // "Cargo" aqui é a FUNÇÃO no projeto (CONSULTOR(A), GESTOR DE PROJETOS…), não
  // o cargo do cadastro de funcionários. É ela que decide quem o ERP paga por
  // hora — e portanto quem entra na conferência contra a folha.
  funcao: 'Cargo',
}

type Carga = { ano: number; mes: number; lote: string | null; linhas: number; horas: number; valor: number }
type Funcao = { id: string; funcao: string; recebe_hora: boolean; pessoas: number; horas: number }

const S: Record<string, CSSProperties> = {
  page:  { padding: 24, fontFamily: 'system-ui, sans-serif' },
  top:   { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' },
  title: { fontSize: 22, fontWeight: 700, color: 'var(--text)', margin: 0 },
  sub:   { fontSize: 13, color: 'var(--muted)', margin: '4px 0 0', maxWidth: 780, lineHeight: 1.5 },
  bar:   { display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap', margin: '20px 0 16px' },
  fld:   { display: 'flex', flexDirection: 'column', gap: 4 },
  lbl:   { fontSize: 10.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 },
  sel:   { padding: '7px 10px', fontSize: 13, border: '1px solid var(--border-strong)', borderRadius: 8, background: 'var(--panel)', color: 'var(--text)' },
  btn:   { padding: '7px 12px', fontSize: 13, border: '1px solid var(--border-strong)', borderRadius: 8, background: 'var(--panel)', color: 'var(--text)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600 },
  card:  { background: 'var(--panel)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden', marginBottom: 16 },
  cardT: { padding: '10px 14px', fontSize: 12.5, fontWeight: 600, color: 'var(--text)', borderBottom: '1px solid var(--border)' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th:    { textAlign: 'left', padding: '8px 12px', color: 'var(--muted)', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' },
  td:    { padding: '6px 12px', borderBottom: '1px solid var(--panel-2)', color: 'var(--text)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
  erro:  { display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.35)', borderRadius: 8, padding: '10px 14px', color: 'var(--red)', fontSize: 13, margin: '0 0 16px' },
  ok:    { background: 'rgba(52,211,153,0.10)', border: '1px solid rgba(52,211,153,0.35)', borderRadius: 8, padding: '10px 14px', color: 'var(--green)', fontSize: 13, margin: '0 0 16px', lineHeight: 1.7 },
  aviso: { background: 'rgba(251,146,60,0.10)', border: '1px solid rgba(251,146,60,0.35)', borderRadius: 8, padding: '10px 14px', color: 'var(--orange)', fontSize: 13, margin: '0 0 16px', lineHeight: 1.7 },
  kpis:  { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, margin: '0 0 16px' },
  kpi:   { background: 'linear-gradient(180deg, var(--panel), var(--bg-soft))', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' },
  kpiL:  { fontSize: 10.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 },
  kpiV:  { fontSize: 24, fontWeight: 700, color: 'var(--text)', margin: '4px 0 2px' },
  kpiS:  { fontSize: 11, color: 'var(--faint)' },
  empty: { padding: '30px 20px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 },
}

// A competência vem do NOME do arquivo (yyyyMMdd_yyyyMMdd). Não há coluna de
// competência no conteúdo e Dt. Pgto Fol vem vazia — então é isto ou perguntar.
function compDoNome(nome: string): { ano: number; mes: number } | null {
  const m = nome.match(/(\d{4})(\d{2})(\d{2})[_-](\d{4})(\d{2})(\d{2})/)
  if (!m) return null
  return { ano: parseInt(m[1], 10), mes: parseInt(m[2], 10) }
}

export default function ApontamentoPage() {
  const passoLabel = usePassoLabel()
  const [empresas, setEmpresas] = useState<any[]>([])
  const [filiais, setFiliais] = useState<any[]>([])
  const [ccs, setCcs] = useState<any[]>([])
  const [postos, setPostos] = useState<any[]>([])
  const [cargas, setCargas] = useState<Carga[]>([])
  const [funcoes, setFuncoes] = useState<Funcao[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [info, setInfo] = useState<string[] | null>(null)
  const [avisos, setAvisos] = useState<string[]>([])
  const [lote, setLote] = useState('EXTRATO')
  const [modo, setModo] = useState<'substituir' | 'adicionar'>('substituir')
  const [ocupado, setOcupado] = useState(false)

  const carregar = async () => {
    try {
    const [e, f, c, p, ap, fn] = await Promise.all([
      supabase.from('empresa').select('id,codigo').eq('ativo', true),
      supabase.from('filial').select('id,codigo'),
      supabase.from('centro_custo').select('id,codigo').eq('ativo', true),
      pageAll(() => supabase.from('posto').select('id,codigo,matricula,recurso_cod,filial_id,regime,ativo')),
      pageAll(() => supabase.from('fat_apontamento').select('ano,mes,lote,horas,valor,funcao,recurso_cod')),
      supabase.from('apontamento_funcao').select('id,funcao,recebe_hora').order('funcao'),
    ])
    setEmpresas(e.data || []); setFiliais(f.data || []); setCcs(c.data || []); setPostos(p)
    const m = new Map<string, Carga>()
    // peso de cada função, para a marcação ser decidida com o tamanho à vista
    const fh = new Map<string, { pessoas: Set<string>; horas: number }>()
    for (const r of ap) {
      const k = `${r.ano}|${r.mes}|${r.lote || ''}`
      const g = m.get(k) || { ano: r.ano, mes: r.mes, lote: r.lote, linhas: 0, horas: 0, valor: 0 }
      g.linhas++; g.horas += Number(r.horas) || 0; g.valor += Number(r.valor) || 0
      m.set(k, g)
      const fk = r.funcao || '(sem função)'
      const x = fh.get(fk) || { pessoas: new Set<string>(), horas: 0 }
      x.pessoas.add(r.recurso_cod || ''); x.horas += Number(r.horas) || 0
      fh.set(fk, x)
    }
    setCargas([...m.values()].sort((a, b) => b.ano - a.ano || b.mes - a.mes))
    setFuncoes(((fn.data || []) as any[]).map(x => ({
      ...x, pessoas: fh.get(x.funcao)?.pessoas.size || 0, horas: fh.get(x.funcao)?.horas || 0,
    })).sort((a, b) => b.horas - a.horas))
    } catch (e: any) {
      setErro('Erro ao carregar: ' + (e?.message || e) + '. Se a tabela ainda não existe, rode a migration schema_v3_112_fat_apontamento.sql.')
    }
  }
  useEffect(() => { carregar() }, [])

  const totalCarregado = useMemo(() => cargas.reduce((s, c) => ({ linhas: s.linhas + c.linhas, horas: s.horas + c.horas, valor: s.valor + c.valor }), { linhas: 0, horas: 0, valor: 0 }), [cargas])

  // ── resolução do recurso → posto ──
  // A ordem importa, e ela começa pelo caso comum: UM candidato só, ativo ou
  // não. Quem foi demitido em junho apontou horas em junho — o posto inativo é
  // a pessoa certa. Medido em jun/2026: exigir posto ativo antes de conferir se
  // havia um só candidato deixava 6 pessoas e 800,4 h sem dono, rotuladas de
  // "ambíguas" sem que houvesse nada a desambiguar.
  // Os desempates (filial, depois atividade) só entram quando o recurso aparece
  // em mais de um posto — sócio em duas filiais, transferência com o antigo
  // demitido, duplicidade histórica. Ver DESIGN_conciliacao_apontamento.md.
  const resolvePosto = (recurso: string, filialApontId: string | null) => {
    const cands = postos.filter(p => (p.recurso_cod || '').trim() === recurso)
    if (!cands.length) return { posto: null, motivo: 'sem posto' as const }
    if (cands.length === 1) return { posto: cands[0], motivo: 'único' as const }
    const naFilial = cands.filter(p => p.filial_id === filialApontId)
    if (naFilial.length === 1) return { posto: naFilial[0], motivo: 'filial' as const }
    const ativos = cands.filter(p => p.ativo !== false)
    if (ativos.length === 1) return { posto: ativos[0], motivo: 'único ativo' as const }
    // Escolher o primeiro aqui seria decidir no escuro para o lado errado
    // metade das vezes. Fica sem posto, e a tela diz quem é.
    return { posto: null, motivo: 'ambíguo' as const }
  }

  // PJ recebe 1 mês depois do apontamento; CLT, 2. A defasagem do PJ foi medida
  // (julho contra a folha de agosto: 146 chaves conciliam; junho, 4).
  const compFolha = (ano: number, mes: number, regime: string | null) => {
    const soma = (regime || '').toUpperCase().includes('CLT') ? 2 : 1
    const m0 = (mes - 1) + soma
    return { ano: ano + Math.floor(m0 / 12), mes: (m0 % 12) + 1 }
  }

  const importar = async (file: File) => {
    setErro(null); setInfo(null); setAvisos([]); setOcupado(true)
    try {
      const comp = compDoNome(file.name)
      if (!comp) {
        setErro(`Não consegui ler a competência do nome do arquivo. Esperado algo como "Extrato_Horas_Apontadas_20260701_20260731.xlsx" — o período no nome é o que define a competência.`)
        return
      }
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array', cellDates: true })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const aoa: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false })
      if (aoa.length < 2) { setErro('Planilha vazia.'); return }

      // índice da PRIMEIRA ocorrência de cada cabeçalho (há nomes repetidos)
      const hdr = (aoa[0] || []).map((v: any) => String(v ?? '').trim())
      const idx: Record<string, number> = {}
      hdr.forEach((h, i) => { if (!(h in idx)) idx[h] = i })
      const faltando = Object.values(COL).filter(c => !(c in idx))
      if (faltando.length) { setErro(`Colunas não encontradas no extrato: ${faltando.join(', ')}.`); return }
      const g = (r: any[], c: string) => r[idx[c]]
      const num = (v: any) => { const n = parseFloat(String(v ?? '0').replace(',', '.')); return isNaN(n) ? 0 : n }

      const empByCod = new Map(empresas.map(e => [String(e.codigo).trim(), e.id]))
      const filByCod = new Map(filiais.map(f => [String(f.codigo).trim(), f.id]))
      const ccByCod = new Map(ccs.map(c => [String(c.codigo).trim(), c.id]))

      const payload: any[] = []
      const semPosto = new Set<string>(), semFilial = new Set<string>(), semCc = new Set<string>()
      const ambiguos = new Set<string>()
      const funcoesVistas = new Set<string>()
      let rejeitados = 0, foraDaComp = 0, inter = 0, foraDaFilial = 0
      let horas = 0, valor = 0

      for (let li = 1; li < aoa.length; li++) {
        const r = aoa[li]; if (!r || !r.length) continue
        const recurso = String(g(r, COL.recurso) ?? '').trim()
        if (!recurso) continue
        // o integrador só considera aprovado — rejeitado não vira folha
        const status = String(g(r, COL.status) ?? '').trim().toUpperCase()
        if (status !== 'A') { rejeitados++; continue }

        const d = g(r, COL.data)
        const dt = d instanceof Date ? d : (String(d ?? '').slice(0, 10) ? new Date(String(d).slice(0, 10)) : null)
        // o nome do arquivo manda, mas linha de outro mês é erro de arquivo e
        // precisa aparecer — importar em silêncio esconderia a troca de extrato
        if (dt && !isNaN(dt.getTime()) && (dt.getFullYear() !== comp.ano || dt.getMonth() + 1 !== comp.mes)) foraDaComp++

        const filCod = String(g(r, COL.empresa) ?? '').trim() + String(g(r, COL.filial) ?? '').trim()
        const filial_apont_id = filByCod.get(filCod) || null
        if (!filial_apont_id) semFilial.add(filCod)
        const ccProjCod = String(g(r, COL.ccProjeto) ?? '').trim()
        const ccRecCod = String(g(r, COL.ccRecurso) ?? '').trim()
        const cc_projeto_id = ccByCod.get(ccProjCod) || null
        if (ccProjCod && !cc_projeto_id) semCc.add(ccProjCod)

        const { posto, motivo } = resolvePosto(recurso, filial_apont_id)
        const rotulo = `${recurso} ${String(g(r, COL.nome) ?? '').trim()}`
        if (motivo === 'ambíguo') ambiguos.add(rotulo)
        else if (!posto) semPosto.add(rotulo)
        // a folha paga na filial DA PESSOA; a do apontamento fica guardada ao lado
        const filial_id = posto?.filial_id || filial_apont_id
        if (posto && filial_apont_id && posto.filial_id !== filial_apont_id) foraDaFilial++

        const funcao = String(g(r, COL.funcao) ?? '').trim().toUpperCase() || null
        if (funcao) funcoesVistas.add(funcao)
        const projeto = String(g(r, COL.projeto) ?? '').trim()
        const ehInter = projeto === '9999999999'
        if (ehInter) inter++
        const h = num(g(r, COL.horas)), hrv = num(g(r, COL.horasRv)), v = num(g(r, COL.custo))
        horas += h; valor += v
        const cf = compFolha(comp.ano, comp.mes, posto?.regime || null)

        payload.push({
          tenant_id: TENANT_ID, ano: comp.ano, mes: comp.mes,
          comp_folha_ano: cf.ano, comp_folha_mes: cf.mes,
          recurso_cod: recurso, nome: String(g(r, COL.nome) ?? '').trim() || null,
          posto_id: posto?.id || null, matricula: posto?.matricula || null,
          empresa_id: empByCod.get(String(g(r, COL.empresa) ?? '').trim()) || null,
          filial_id, filial_apont_id, cc_projeto_id, cc_recurso_id: ccByCod.get(ccRecCod) || null,
          funcao, projeto_cod: projeto || null, projeto_desc: null,
          os_num: String(g(r, COL.os) ?? '').trim() || null,
          tarefa: String(g(r, COL.tarefa) ?? '').trim() || null,
          data: dt && !isNaN(dt.getTime()) ? dt.toISOString().slice(0, 10) : null,
          horas: h, horas_rv: hrv, custo_hora: num(g(r, COL.custoHora)), valor: v,
          status_aprov: status, intercambio: ehInter,
          lote: lote.trim().toUpperCase() || 'EXTRATO', origem: 'EXTRATO',
          dims: motivo === 'ambíguo' ? { posto_ambiguo: true } : {},
        })
      }

      if (!payload.length) { setErro('Nenhuma linha aprovada no arquivo.'); return }

      if (modo === 'substituir') {
        const lt = lote.trim().toUpperCase() || 'EXTRATO'
        const { error } = await supabase.from('fat_apontamento').delete()
          .eq('ano', comp.ano).eq('mes', comp.mes).eq('lote', lt)
        if (error) { setErro('Erro ao limpar o lote: ' + error.message); return }
      }

      // mesma disciplina do import da folha: lotes pequenos, repetir o que for
      // falha de rede, e dizer quanto entrou se ainda assim falhar — "substituir"
      // apaga antes de gravar, então parar no meio deixa a competência incompleta
      let gravados = 0
      for (let i = 0; i < payload.length; i += 200) {
        const fatia = payload.slice(i, i + 200)
        let err: any = null
        for (let tent = 1; tent <= 3; tent++) {
          const res = await supabase.from('fat_apontamento').insert(fatia)
          if (!res.error) { err = null; break }
          err = res.error
          if (res.error.code || tent === 3) break
          await new Promise(x => setTimeout(x, 400 * tent))
        }
        if (err) {
          setErro(`Erro ao gravar: ${err.message}. Entraram ${gravados} de ${payload.length} linha(s) — a competência ficou INCOMPLETA. Importe de novo em "Substituir".`)
          carregar(); return
        }
        gravados += fatia.length
      }

      // catálogo de funções: função nova entra como "recebe por hora" e aparece
      // na tela para ser marcada. ignoreDuplicates porque a marcação é de quem
      // confere — reimportar não pode desmarcar o que já foi decidido.
      const jaVistas = new Set(funcoes.map(f => f.funcao))
      const novas = [...funcoesVistas].filter(f => !jaVistas.has(f))
      if (novas.length) {
        await supabase.from('apontamento_funcao')
          .upsert(novas.map(f => ({ tenant_id: TENANT_ID, funcao: f, recebe_hora: true })),
            { onConflict: 'tenant_id,funcao', ignoreDuplicates: true })
      }

      const lista = (s: Set<string>, n = 6) => `${[...s].slice(0, n).join(' · ')}${s.size > n ? ' …' : ''}`
      const av: string[] = []
      // o código do recurso tem numeração PRÓPRIA — medido: 0 de 303 batem com
      // a matrícula (recurso 001090 é a matrícula 900027). Por isso o aviso não
      // tenta adivinhar se a pessoa é nossa pelo formato do código.
      if (semPosto.size) av.push(`${semPosto.size} recurso(s) sem posto — ou são de empresa terceira (não passam pela nossa folha), ou é alguém nosso cujo posto está sem o código do recurso. Até resolver, essas horas não conciliam: ${lista(semPosto)}`)
      if (ambiguos.size) av.push(`${ambiguos.size} recurso(s) em mais de um posto, sem como desempatar por filial nem por atividade — ficaram sem posto de propósito, escolher no escuro erraria metade: ${lista(ambiguos)}`)
      if (semFilial.size) av.push(`Filial não cadastrada: ${[...semFilial].join(', ')}`)
      if (semCc.size) av.push(`CC de projeto não cadastrado: ${[...semCc].slice(0, 10).join(', ')}`)
      if (foraDaFilial) av.push(`${foraDaFilial} linha(s) apontadas numa filial diferente da do posto — é o normal, não erro: a filial do extrato é a do projeto e a folha paga na filial da pessoa. A conciliação usa a do posto; medido em jun/2026, eram 56 pessoas e 14% das horas, que virariam diferença falsa nas duas pontas.`)
      if (foraDaComp) av.push(`${foraDaComp} linha(s) com data fora de ${MESES[comp.mes - 1]}/${comp.ano} — confira se o arquivo é o da competência do nome.`)
      setAvisos(av)
      setInfo([
        `${gravados} apontamento(s) de ${MESES[comp.mes - 1]}/${comp.ano} · ${hrs(horas)} h · R$ ${money(valor)}`,
        `${rejeitados} linha(s) rejeitada(s) no ERP (status ≠ A) não entraram — o integrador também as ignora.`,
        `${inter} linha(s) de intercâmbio (projeto 9999999999) marcadas.`,
      ])
      carregar()
    } catch (e: any) {
      setErro('Erro ao ler o arquivo: ' + (e?.message || e))
    } finally { setOcupado(false) }
  }

  const marcarFuncao = async (f: Funcao, v: boolean) => {
    setFuncoes(fs => fs.map(x => x.id === f.id ? { ...x, recebe_hora: v } : x))   // responde na hora
    const { error } = await supabase.from('apontamento_funcao').update({ recebe_hora: v }).eq('id', f.id)
    if (error) { setErro(error.message); setFuncoes(fs => fs.map(x => x.id === f.id ? { ...x, recebe_hora: !v } : x)) }
  }

  const excluir = async (c: Carga) => {
    if (!confirm(`Excluir ${c.linhas} apontamento(s) de ${MESES[c.mes - 1]}/${c.ano}${c.lote ? ` (lote ${c.lote})` : ''}?`)) return
    let q = supabase.from('fat_apontamento').delete().eq('ano', c.ano).eq('mes', c.mes)
    q = c.lote ? q.eq('lote', c.lote) : q.is('lote', null)
    const { error } = await q
    if (error) { setErro(error.message); return }
    carregar()
  }

  return (
    <div style={S.page}>
      <div style={S.top}>
        <div>
          <h1 style={S.title}>Apontamento de horas</h1>
          <p style={S.sub}>
            Importa o <b>Extrato de Horas Apontadas</b> do TOTVS. A competência vem do <b>nome do arquivo</b>
            {' '}(<code>…_20260701_20260731.xlsx</code>) — não há competência no conteúdo. Base da conciliação
            {' '}<b>Apontamento × Folha</b>, que compara em <b>horas</b>: a folha usa outro valor-hora, então
            comparar valor compararia duas taxas para a mesma hora.
          </p>
        </div>
        <PostosPills />
      </div>

      <div style={S.bar}>
        <div style={S.fld}><span style={S.lbl}>Lote</span>
          <input style={S.sel} value={lote} onChange={e => setLote(e.target.value)}
            title="Separa cargas da mesma competência. 'Substituir' troca só o lote que está entrando." />
        </div>
        <div style={S.fld}><span style={S.lbl}>Modo</span>
          <select style={S.sel} value={modo} onChange={e => setModo(e.target.value as any)}>
            <option value="substituir">Substituir este lote</option>
            <option value="adicionar">Adicionar</option>
          </select>
        </div>
        <div style={S.fld}><span style={S.lbl}>Arquivo</span>
          <label style={{ ...S.btn, color: 'var(--violet)', opacity: ocupado ? 0.5 : 1 }}>
            <Upload size={14} /> {ocupado ? 'Importando…' : 'Importar extrato (XLSX)'}
            <input type="file" accept=".xlsx,.xls" style={{ display: 'none' }} disabled={ocupado}
              onChange={e => { const f = e.target.files?.[0]; if (f) importar(f); e.currentTarget.value = '' }} />
          </label>
        </div>
      </div>

      {erro && <div style={S.erro}><AlertCircle size={16} /> {erro}</div>}
      {info && <div style={S.ok}>{info.map((t, i) => <div key={i}>{t}</div>)}</div>}
      {!!avisos.length && <div style={S.aviso}>{avisos.map((t, i) => <div key={i}>{t}</div>)}</div>}

      <div style={S.kpis}>
        <div style={S.kpi}><div style={S.kpiL}>Apontamentos</div><div style={S.kpiV}>{totalCarregado.linhas.toLocaleString('pt-BR')}</div><div style={S.kpiS}>{cargas.length} competência(s)</div></div>
        <div style={S.kpi}><div style={S.kpiL}>Horas</div><div style={S.kpiV}>{hrs(totalCarregado.horas)}</div></div>
        <div style={S.kpi}><div style={S.kpiL}>Custo</div><div style={S.kpiV}>R$ {money(totalCarregado.valor)}</div><div style={S.kpiS}>horas × custo/hora do apontamento</div></div>
      </div>

      {!!funcoes.length && <div style={S.card}>
        <div style={S.cardT}>Funções · quem recebe por hora
          <span style={{ fontWeight: 400, color: 'var(--muted)' }}> — é a função, não o cargo do cadastro, que decide
            quem o ERP paga por hora. Quem não recebe aponta para dizer <b>onde</b> o custo cai, e fica fora da
            conferência contra a folha em vez de aparecer como divergente todo mês.</span></div>
        <table style={S.table}>
          <thead><tr>
            <th style={S.th}>Função</th>
            <th style={{ ...S.th, textAlign: 'right' }}>Pessoas</th>
            <th style={{ ...S.th, textAlign: 'right' }}>Horas</th>
            <th style={S.th}>Recebe por hora</th>
          </tr></thead>
          <tbody>
            {funcoes.map(f => (
              <tr key={f.id}>
                <td style={S.td}>{f.funcao}</td>
                <td style={{ ...S.td, textAlign: 'right', color: 'var(--muted)' }}>{f.pessoas || '—'}</td>
                <td style={{ ...S.td, textAlign: 'right', color: 'var(--muted)' }}>{f.horas ? hrs(f.horas) : '—'}</td>
                <td style={S.td}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12.5, color: f.recebe_hora ? 'var(--text)' : 'var(--muted)' }}>
                    <input type="checkbox" checked={f.recebe_hora} onChange={e => marcarFuncao(f, e.target.checked)} />
                    {f.recebe_hora ? 'confere contra a folha' : 'só aponta'}
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ padding: '8px 14px', fontSize: 11.5, color: 'var(--faint)', lineHeight: 1.6 }}>
          Função nova entra marcada como <b>confere</b>: uma função desconhecida que sumisse da conferência em silêncio
          seria pior do que uma que aparece indevidamente e você corrige aqui. Para a exceção de uma pessoa só —
          alguém que foge do padrão da função dela — use a coluna <b>Recebe por hora</b> em {passoLabel('/postos')}.
        </div>
      </div>}

      <div style={S.card}>
        <div style={S.cardT}>Competências carregadas <span style={{ fontWeight: 400, color: 'var(--muted)' }}>— o custo aqui é o do apontamento, não o da folha</span></div>
        <table style={S.table}>
          <thead><tr>
            <th style={S.th}>Competência</th><th style={S.th}>Lote</th>
            <th style={{ ...S.th, textAlign: 'right' }}>Linhas</th>
            <th style={{ ...S.th, textAlign: 'right' }}>Horas</th>
            <th style={{ ...S.th, textAlign: 'right' }}>Custo</th>
            <th style={S.th} />
          </tr></thead>
          <tbody>
            {cargas.map((c, i) => (
              <tr key={i}>
                <td style={S.td}>{MESES[c.mes - 1]}/{c.ano}</td>
                <td style={{ ...S.td, color: 'var(--muted)' }}>{c.lote || '(sem lote)'}</td>
                <td style={{ ...S.td, textAlign: 'right' }}>{c.linhas.toLocaleString('pt-BR')}</td>
                <td style={{ ...S.td, textAlign: 'right' }}>{hrs(c.horas)}</td>
                <td style={{ ...S.td, textAlign: 'right' }}>{money(c.valor)}</td>
                <td style={{ ...S.td, textAlign: 'right' }}>
                  <button style={{ ...S.btn, padding: '3px 8px', fontSize: 11.5, color: 'var(--red)' }}
                    onClick={() => excluir(c)}><Trash2 size={12} /> Excluir</button>
                </td>
              </tr>
            ))}
            {!cargas.length && <tr><td colSpan={6} style={S.empty}>
              Nenhum apontamento importado. Gere o <b>Extrato de Horas Apontadas</b> no TOTVS e traga o arquivo —
              ele vai direto, sem conversão. Depois use <b>{passoLabel('/postos/conciliacao')}</b> para comparar com a folha.
            </td></tr>}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.7, maxWidth: 820 }}>
        <FileDown size={12} style={{ verticalAlign: -2 }} /> <b>O que a importação faz com cada linha:</b> descarta as
        rejeitadas no ERP (status ≠ A), porque o integrador da folha também as ignora; resolve o <b>recurso</b> para o
        posto — pela filial, senão pelo único posto ativo, e marca quando fica ambíguo; grava os <b>dois</b> centros de
        custo (o do projeto, que é de quem se pergunta, e o do recurso, que explica boa parte das diferenças); e calcula
        a <b>competência da folha</b> correspondente — 1 mês depois para PJ, 2 para CLT.
      </div>
    </div>
  )
}
