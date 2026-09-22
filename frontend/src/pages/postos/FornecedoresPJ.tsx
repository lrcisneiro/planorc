import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { supabase, TENANT_ID } from '../../lib/supabase'
import { pageAll } from '../../lib/pageAll'
import { AlertCircle, Download, Upload, Trash2, Search, CheckCircle2 } from 'lucide-react'

// De-para participante × fornecedor (v3_083) — a ponte que dá nome ao PJ.
//
// O PJ não passa pela contabilização da folha: chega ao razão como nota fiscal,
// num lote de contas a pagar, com o histórico "<FORNECEDOR>-<PARTICIPANTE>".
// Sem esta tabela ele é uma massa anônima em "outras origens"; com ela, cada
// lançamento ganha matrícula e a conciliação por pessoa fecha.
//
// A planilha importada é o export cru do Protheus (RD0 × SA2) — sem conversor
// intermediário, porque as colunas já vêm limpas. Quem não tem fornecedor
// amarrado é CLT (contabiliza pela folha) e não entra aqui.

declare const XLSX: any

type Row = {
  id: string; empresa_cod: string; filial_cod: string | null; matricula: string; matricula_folha: string | null
  nome: string | null; cpf: string | null; fornecedor_cod: string; fornecedor_loja: string; cnpj: string | null
  nome_fantasia: string | null; ativo: boolean
}

// Aceita tanto o cabeçalho do export do ERP quanto o nome da coluna do Planorc,
// para a planilha exportada por esta tela poder ser reimportada.
const DE_PARA: Record<string, string> = {
  EMPRESA: 'empresa_cod', EMPRESA_COD: 'empresa_cod',
  FILIAL: 'filial_cod', FILIAL_COD: 'filial_cod',
  CODIGO: 'matricula', MATRICULA: 'matricula',
  // a matrícula do SRA, quando o export a trouxer: é o elo confiável com a folha
  MATRICULA_FOLHA: 'matricula_folha', MATRICULA_SRA: 'matricula_folha', MAT_FOLHA: 'matricula_folha',
  NOME: 'nome', CPF: 'cpf',
  COD_FORNECEDOR: 'fornecedor_cod', FORNECEDOR_COD: 'fornecedor_cod',
  LOJA: 'fornecedor_loja', FORNECEDOR_LOJA: 'fornecedor_loja',
  CNPJ_FORNECEDOR: 'cnpj', CNPJ: 'cnpj',
  NOME_FANTASIA: 'nome_fantasia', FANTASIA: 'nome_fantasia',
}
const COLS_EXPORT = ['empresa_cod', 'filial_cod', 'matricula', 'matricula_folha', 'nome', 'cpf', 'fornecedor_cod', 'fornecedor_loja', 'cnpj', 'nome_fantasia']

const norm = (s: any) => String(s ?? '').trim()
// célula numérica come o zero à esquerda: 000076 volta como 76 (ou "76.0")
const zfill = (v: any, n: number) => { const s = norm(v).split('.')[0]; return s ? s.padStart(n, '0') : '' }
const chaveDe = (r: any) => `${r.empresa_cod}|${r.matricula}|${r.fornecedor_cod}|${r.fornecedor_loja}`

const S: Record<string, CSSProperties> = {
  card:    { background: 'var(--panel)', borderRadius: 10, border: '1px solid var(--border)', overflow: 'hidden' },
  toolbar: { display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid var(--panel)', flexWrap: 'wrap' },
  table:   { width: '100%', borderCollapse: 'collapse', fontSize: 13.5 },
  th:      { textAlign: 'left', padding: '9px 14px', color: 'var(--muted)', fontWeight: 500, fontSize: 12, background: 'var(--bg)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' },
  td:      { padding: '6px 14px', borderBottom: '1px solid var(--panel)', color: 'var(--text)' },
  mono:    { padding: '6px 14px', borderBottom: '1px solid var(--panel)', color: 'var(--muted)', fontFamily: 'monospace', fontSize: 12.5, whiteSpace: 'nowrap' },
  btn:     { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: 13, background: 'var(--panel)', color: 'var(--text-mid)', border: '1px solid var(--border-strong)', borderRadius: 6, cursor: 'pointer' },
  input:   { padding: '6px 10px 6px 28px', fontSize: 13, border: '1px solid var(--border-strong)', borderRadius: 6, outline: 'none', background: 'var(--panel)', color: 'var(--text)', width: 230 },
  erro:    { display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.35)', borderRadius: 8, padding: '10px 14px', margin: '12px 16px 0', color: 'var(--red)', fontSize: 13 },
  ok:      { display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(52,211,153,0.10)', border: '1px solid rgba(52,211,153,0.30)', borderRadius: 8, padding: '10px 14px', margin: '12px 16px 0', color: 'var(--green)', fontSize: 13 },
  hint:    { fontSize: 12, color: 'var(--muted)', padding: '10px 16px 0', lineHeight: 1.5 },
  empty:   { padding: '40px 24px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 },
}

export function FornecedoresPJ({ editavel }: { editavel: boolean }) {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [substituir, setSubstituir] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    setLoading(true)
    // cresce com o quadro de PJ — passa de 1000 sem avisar
    const d = await pageAll(() => supabase.from('posto_fornecedor')
      .select('id,empresa_cod,filial_cod,matricula,matricula_folha,nome,cpf,fornecedor_cod,fornecedor_loja,cnpj,nome_fantasia,ativo')
      .order('matricula'))
    setRows(d as Row[]); setLoading(false)
  }
  useEffect(() => { load() }, [])

  const shown = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(r => [r.matricula, r.matricula_folha, r.nome, r.fornecedor_cod, r.nome_fantasia, r.cnpj]
      .some(v => String(v || '').toLowerCase().includes(q)))
  }, [rows, busca])

  const exportar = () => {
    const aoa = [COLS_EXPORT, ...rows.map(r => COLS_EXPORT.map(c => (r as any)[c] ?? ''))]
    const ws = XLSX.utils.aoa_to_sheet(aoa); const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Dados'); XLSX.writeFile(wb, 'posto_fornecedor.xlsx')
  }

  const importar = async (file: File) => {
    setErro(null); setAviso(null)
    let brutos: any[]
    try {
      brutos = await new Promise<any[]>((res, rej) => {
        const rd = new FileReader()
        rd.onload = e => { try {
          const wb = XLSX.read(e.target?.result, { type: 'binary' })
          res(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }) as any[])
        } catch (x) { rej(x) } }
        rd.readAsBinaryString(file)
      })
    } catch (e: any) { setErro('Erro ao ler o arquivo: ' + (e?.message || e)); return }
    if (!brutos.length) { setErro('Planilha vazia.'); return }

    const cab = Object.keys(brutos[0]).map(k => k.trim().toUpperCase())
    if (!cab.some(k => DE_PARA[k] === 'matricula') || !cab.some(k => DE_PARA[k] === 'fornecedor_cod')) {
      setErro(`Cabeçalho não reconhecido. Esperado o export RD0 × SA2 (EMPRESA, CODIGO, NOME, COD_FORNECEDOR, LOJA, NOME_FANTASIA). Veio: ${cab.join(', ')}`)
      return
    }

    const vistos = new Map<string, any>()
    let semFornecedor = 0, semMatricula = 0, dup = 0
    for (const b of brutos) {
      const r: any = { tenant_id: TENANT_ID, empresa_cod: '', fornecedor_loja: '' }
      for (const [k, v] of Object.entries(b)) {
        const col = DE_PARA[k.trim().toUpperCase()]
        if (col) r[col] = v
      }
      r.matricula       = zfill(r.matricula, 6)
      r.matricula_folha = r.matricula_folha ? zfill(r.matricula_folha, 6) : null
      r.fornecedor_cod = zfill(r.fornecedor_cod, 6)
      r.fornecedor_loja = r.fornecedor_loja ? zfill(r.fornecedor_loja, 2) : ''
      r.empresa_cod    = r.empresa_cod ? zfill(r.empresa_cod, 2) : ''
      r.filial_cod     = norm(r.filial_cod) || null
      for (const c of ['nome', 'cpf', 'cnpj', 'nome_fantasia']) r[c] = norm(r[c]) || null
      // sem fornecedor = CLT: contabiliza pela folha e nunca aparece como NF
      if (!r.matricula || r.matricula === '000000') { semMatricula++; continue }
      if (!r.fornecedor_cod) { semFornecedor++; continue }
      const k = chaveDe(r)
      if (vistos.has(k)) { dup++; continue }
      vistos.set(k, r)
    }
    const payload = [...vistos.values()]
    if (!payload.length) { setErro(`Nenhuma linha com fornecedor amarrado (${semFornecedor} sem fornecedor, ${semMatricula} sem matrícula).`); return }

    if (substituir && !confirm(`Substituir a lista inteira? Os ${rows.length} registros atuais serão apagados e trocados pelos ${payload.length} da planilha.`)) return
    setLoading(true)
    if (substituir) {
      const { error } = await supabase.from('posto_fornecedor').delete().eq('tenant_id', TENANT_ID)
      if (error) { setErro('Ao limpar: ' + error.message); setLoading(false); return }
    }
    for (let i = 0; i < payload.length; i += 500) {
      const { error } = await supabase.from('posto_fornecedor')
        .upsert(payload.slice(i, i + 500), { onConflict: 'tenant_id,empresa_cod,matricula,fornecedor_cod,fornecedor_loja' })
      if (error) { setErro('Import: ' + error.message); setLoading(false); return }
    }
    const notas = [`${payload.length} amarração(ões) gravadas`]
    if (semFornecedor) notas.push(`${semFornecedor} sem fornecedor (CLT — contabiliza pela folha)`)
    if (dup) notas.push(`${dup} duplicada(s) na planilha, mantida a primeira`)
    if (semMatricula) notas.push(`${semMatricula} sem matrícula`)
    setAviso(notas.join(' · '))
    await load()
  }

  const limpar = async () => {
    if (!confirm(`Apagar as ${rows.length} amarrações? O PJ volta a aparecer sem nome na conciliação.`)) return
    const { error } = await supabase.from('posto_fornecedor').delete().eq('tenant_id', TENANT_ID)
    if (error) { setErro(error.message); return }
    setAviso(null); load()
  }

  return (
    <div style={S.card}>
      <div style={S.toolbar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            {shown.length}{busca ? ` de ${rows.length}` : ''} {shown.length === 1 ? 'amarração' : 'amarrações'}
          </span>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Search size={14} style={{ position: 'absolute', left: 8, color: 'var(--muted)' }} />
            <input style={S.input} value={busca} onChange={e => setBusca(e.target.value)} placeholder="matrícula, nome, fornecedor…" />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {editavel && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: 'var(--text-mid)', cursor: 'pointer' }}
              title="A lista é um espelho do ERP: marcando isto, quem saiu do export sai daqui também. Desmarcado, o import só acrescenta e atualiza.">
              <input type="checkbox" checked={substituir} onChange={e => setSubstituir(e.target.checked)} /> substituir tudo
            </label>
          )}
          <button style={S.btn} onClick={exportar} disabled={!rows.length}><Download size={14} /> Exportar</button>
          {editavel && <button style={S.btn} onClick={() => fileRef.current?.click()}><Upload size={14} /> Importar</button>}
          {editavel && !!rows.length && <button style={{ ...S.btn, color: 'var(--red)' }} onClick={limpar}><Trash2 size={14} /> Limpar</button>}
        </div>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) importar(f); e.target.value = '' }} />
      </div>

      <div style={S.hint}>
        Importe o export do Protheus que cruza <b>participantes (RD0)</b> com <b>fornecedores (SA2)</b> —
        colunas <code>EMPRESA, CODIGO, NOME, CPF, COD_FORNECEDOR, LOJA, CNPJ_FORNECEDOR, NOME_FANTASIA</code>.
        Quem vem sem fornecedor é CLT e é descartado: só o PJ chega ao razão por nota fiscal.
        É o <b>nome fantasia</b> que casa com o histórico do lançamento — sem ele a linha entra, mas não amarra.
        Se o export puder trazer também a <b>matrícula do SRA</b> (coluna <code>MATRICULA_FOLHA</code>), use: o código do
        participante do RD0 <i>não</i> é a matrícula da folha, e sem ela o elo com a pessoa é tentado por nome.
      </div>
      {erro && <div style={S.erro}><AlertCircle size={14} /> {erro}</div>}
      {aviso && <div style={S.ok}><CheckCircle2 size={14} /> {aviso}</div>}

      <div style={{ overflowX: 'auto', marginTop: 12 }}>
        <table style={S.table}>
          <thead><tr>
            <th style={S.th}>Empresa</th><th style={S.th}>Matrícula</th><th style={S.th} title="Matrícula do SRA — o elo com a folha. Vazia, o vínculo é tentado por nome.">Mat. folha</th><th style={S.th}>Nome</th>
            <th style={S.th}>Fornecedor</th><th style={S.th}>Nome fantasia</th><th style={S.th}>CNPJ</th>
          </tr></thead>
          <tbody>
            {shown.slice(0, 500).map(r => (
              <tr key={r.id}>
                <td style={S.mono}>{r.empresa_cod || '—'}</td>
                <td style={S.mono}>{r.matricula}</td>
                <td style={{ ...S.mono, color: r.matricula_folha ? 'var(--green)' : 'var(--muted)' }}>{r.matricula_folha || 'por nome'}</td>
                <td style={S.td}>{r.nome || '—'}</td>
                <td style={S.mono}>{r.fornecedor_cod}{r.fornecedor_loja ? `/${r.fornecedor_loja}` : ''}</td>
                <td style={{ ...S.td, color: r.nome_fantasia ? 'var(--text)' : 'var(--orange)' }}>{r.nome_fantasia || 'sem fantasia — não amarra'}</td>
                <td style={S.mono}>{r.cnpj || '—'}</td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={7} style={S.empty}>
              {loading ? 'Carregando…' : busca ? 'Nada com esse termo.' : 'Nenhuma amarração ainda — importe o export RD0 × SA2 para o PJ ganhar nome na conciliação.'}
            </td></tr>}
          </tbody>
        </table>
        {shown.length > 500 && <div style={{ ...S.hint, paddingBottom: 12 }}>mostrando as 500 primeiras de {shown.length} — use a busca para chegar a uma pessoa.</div>}
      </div>
    </div>
  )
}
