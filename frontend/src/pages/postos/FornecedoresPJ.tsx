import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { supabase, TENANT_ID } from '../../lib/supabase'
import { pageAll } from '../../lib/pageAll'
import { AlertCircle, Download, Upload, Trash2, Search, CheckCircle2 } from 'lucide-react'

// De-para pessoa × fornecedor (v3_083/086) — a ponte que dá nome ao terceiro.
//
// O terceiro não passa pela contabilização da folha: chega ao razão como nota
// fiscal, num lote de contas a pagar. Sem esta tabela ele é uma massa anônima;
// com ela, cada lançamento ganha matrícula e a conciliação por pessoa fecha.
//
// Duas formas de contratação, e o histórico do razão as distingue:
//   PJ puro    traz o NOME FANTASIA do fornecedor — é a chave
//   Cooperado  traz "<COOPERATIVA>-<NOME DO FUNCIONÁRIO>", e quem decide é o
//              nome do funcionário: o fornecedor é a cooperativa, dividida por
//              todos os cooperados, e não identifica ninguém sozinho
//
// A planilha é o export cru do Protheus (SRA × Fornecedores) — sem conversor,
// porque as colunas já vêm limpas. Quem não tem fornecedor é CLT (contabiliza
// pela folha) e não entra aqui.

declare const XLSX: any

type Row = {
  id: string; empresa_cod: string; filial_cod: string; matricula: string | null; matricula_folha: string
  nome: string | null; nome_sra: string | null; cpf: string | null
  fornecedor_cod: string; fornecedor_loja: string; cnpj: string | null
  nome_fantasia: string | null; ativo: boolean
}

// Aceita tanto o cabeçalho do export do ERP quanto o nome da coluna do Planorc,
// para a planilha exportada por esta tela poder ser reimportada.
const DE_PARA: Record<string, string> = {
  EMPRESA: 'empresa_cod', EMPRESA_COD: 'empresa_cod',
  FILIAL: 'filial_cod', FILIAL_COD: 'filial_cod',
  CODIGO: 'matricula', RD0_CODIGO: 'matricula',
  NOME: 'nome', RD0_NOME: 'nome',
  // a identidade da FOLHA — a chave, presente inclusive para o cooperado, que
  // não existe no RD0 porque o fornecedor dele é a cooperativa
  MATRICULA: 'matricula_folha', NOME_SRA: 'nome_sra',
  CPF: 'cpf', RD0_CPF: 'cpf',
  COD_FORNECEDOR: 'fornecedor_cod', FORNECEDOR_COD: 'fornecedor_cod', RD0_COD_FORNECEDOR: 'fornecedor_cod',
  LOJA: 'fornecedor_loja', FORNECEDOR_LOJA: 'fornecedor_loja', RD0_LOJA: 'fornecedor_loja',
  CNPJ: 'cnpj', CNPJ_FORNECEDOR: 'cnpj', SA2_CNPJ_FORNECEDOR: 'cnpj',
  FANTASIA: 'nome_fantasia', NOME_FANTASIA: 'nome_fantasia', SA2_NOME_FANTASIA: 'nome_fantasia',
  // o par do SRA — a chave que identifica a pessoa na folha
  MATRICULA_FOLHA: 'matricula_folha', MATRICULA_SRA: 'matricula_folha', MAT_FOLHA: 'matricula_folha', SRA_MATRICULA: 'matricula_folha',
  SRA_FILIAL: 'filial_sra', FILIAL_SRA: 'filial_sra', SRA_NOME: 'nome_sra',
  // RD0_FILIAL fica de fora de propósito: vem vazia e não é a filial da folha
}
const COLS_EXPORT = ['empresa_cod', 'filial_cod', 'matricula_folha', 'nome_sra', 'matricula', 'nome', 'cpf', 'fornecedor_cod', 'fornecedor_loja', 'cnpj', 'nome_fantasia']

// o export traz 'NULL' como texto e campos preenchidos com espaços à direita
const norm = (s: any) => { const t = String(s ?? '').trim(); return t.toUpperCase() === 'NULL' ? '' : t }
// célula numérica come o zero à esquerda: 000076 volta como 76 (ou "76.0")
const zfill = (v: any, n: number) => { const s = norm(v).split('.')[0]; return s ? s.padStart(n, '0') : '' }
const chaveDe = (r: any) => `${r.empresa_cod}|${r.filial_cod}|${r.matricula_folha}|${r.fornecedor_cod}|${r.fornecedor_loja}`

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
      .select('id,empresa_cod,filial_cod,matricula,matricula_folha,nome,nome_sra,cpf,fornecedor_cod,fornecedor_loja,cnpj,nome_fantasia,ativo')
      .order('matricula'))
    setRows(d as Row[]); setLoading(false)
  }
  useEffect(() => { load() }, [])

  const shown = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(r => [r.matricula, r.matricula_folha, r.nome, r.nome_sra, r.fornecedor_cod, r.nome_fantasia, r.cnpj]
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
    if (!cab.some(k => DE_PARA[k] === 'matricula_folha') || !cab.some(k => DE_PARA[k] === 'fornecedor_cod')) {
      setErro(`Cabeçalho não reconhecido. Esperado o export SRA × Fornecedores (EMPRESA, FILIAL_SRA, MATRICULA, NOME_SRA, COD_FORNECEDOR, LOJA, NOME_FANTASIA). Veio: ${cab.join(', ')}`)
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
      r.matricula       = norm(r.matricula) ? zfill(r.matricula, 6) : null
      r.matricula_folha = zfill(r.matricula_folha, 6)
      r.fornecedor_cod = zfill(r.fornecedor_cod, 6)
      r.fornecedor_loja = r.fornecedor_loja ? zfill(r.fornecedor_loja, 2) : ''
      r.empresa_cod    = r.empresa_cod ? zfill(r.empresa_cod, 2) : ''
      // a filial da folha é EMPRESA + filial do SRA: o export traz '20' e '01',
      // e tanto a folha quanto o cadastro de filial usam '2001'
      const fs = norm(r.filial_sra)
      if (fs) r.filial_cod = (r.empresa_cod && fs.length <= 2) ? r.empresa_cod + zfill(fs, 2) : fs
      r.filial_cod = norm(r.filial_cod)
      delete r.filial_sra
      for (const c of ['nome', 'nome_sra', 'cpf', 'cnpj', 'nome_fantasia']) r[c] = norm(r[c]) || null
      // sem fornecedor = CLT: contabiliza pela folha e nunca aparece como NF
      if (!r.matricula_folha || r.matricula_folha === '000000') { semMatricula++; continue }
      if (!r.fornecedor_cod) { semFornecedor++; continue }
      const k = chaveDe(r)
      if (vistos.has(k)) { dup++; continue }
      vistos.set(k, r)
    }
    const payload = [...vistos.values()]
    if (!payload.length) { setErro(`Nenhuma linha com fornecedor amarrado (${semFornecedor} sem fornecedor, ${semMatricula} sem matrícula).`); return }

    // a filial tem de existir no cadastro, senão a chave não alcança a folha —
    // melhor dizer isso na hora do que deixar a conciliação silenciosamente vazia
    const cadastradas = new Set((await pageAll(() => supabase.from('filial').select('codigo'))).map((f: any) => String(f.codigo)))
    const filiaisRuins = [...new Set(payload.map(r => r.filial_cod).filter(f => f && !cadastradas.has(f)))]

    if (substituir && !confirm(`Substituir a lista inteira? Os ${rows.length} registros atuais serão apagados e trocados pelos ${payload.length} da planilha.`)) return
    setLoading(true)
    if (substituir) {
      const { error } = await supabase.from('posto_fornecedor').delete().eq('tenant_id', TENANT_ID)
      if (error) { setErro('Ao limpar: ' + error.message); setLoading(false); return }
    }
    for (let i = 0; i < payload.length; i += 500) {
      const { error } = await supabase.from('posto_fornecedor')
        .upsert(payload.slice(i, i + 500), { onConflict: 'tenant_id,empresa_cod,filial_cod,matricula_folha,fornecedor_cod,fornecedor_loja' })
      if (error) { setErro('Import: ' + error.message); setLoading(false); return }
    }
    const coop = payload.filter(r => /COOPERATIV/i.test(r.nome_fantasia || '')).length
    const notas = [`${payload.length} amarração(ões) gravadas`]
    if (coop) notas.push(`${coop} cooperado(s) — casam pelo nome do funcionário, não pelo fornecedor`)
    const semNome = payload.filter(r => !r.nome_sra && !r.nome).length
    if (semNome) notas.push(`${semNome} sem nome nenhum — não amarram`)
    if (semFornecedor) notas.push(`${semFornecedor} sem fornecedor (CLT — contabiliza pela folha)`)
    if (dup) notas.push(`${dup} duplicada(s) na planilha, mantida a primeira`)
    if (semMatricula) notas.push(`${semMatricula} sem matrícula`)
    setAviso(notas.join(' · '))
    if (filiaisRuins.length) setErro(`Filial não cadastrada: ${filiaisRuins.join(', ')}. Estas linhas entraram, mas a chave não alcança a folha — confira o cadastro de filiais.`)
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
        Importe o export do Protheus <b>SRA × Fornecedores</b> — colunas <code>EMPRESA, FILIAL_SRA, MATRICULA, NOME_SRA,
        RD0_CODIGO, RD0_NOME, CPF, COD_FORNECEDOR, LOJA, CNPJ_FORNECEDOR, NOME_FANTASIA</code>.
        Quem vem sem fornecedor é CLT e é descartado: só o terceiro chega ao razão por nota fiscal.
        A chave é <b>FILIAL_SRA + MATRICULA</b> (a filial é montada como <b>EMPRESA + FILIAL_SRA</b>: 20 + 01 → 2001) —
        matrícula sozinha não identifica ninguém, a 900000 é três pessoas diferentes.
        O <b>cooperado</b> não tem RD0 e é normal: o fornecedor dele é a cooperativa, e quem o identifica no
        histórico é o <b><code>NOME_SRA</code></b>, depois do traço.
      </div>
      {erro && <div style={S.erro}><AlertCircle size={14} /> {erro}</div>}
      {aviso && <div style={S.ok}><CheckCircle2 size={14} /> {aviso}</div>}

      <div style={{ overflowX: 'auto', marginTop: 12 }}>
        <table style={S.table}>
          <thead><tr>
            <th style={S.th}>Empresa</th>
            <th style={S.th} title="Filial + matrícula do SRA: a chave que identifica a pessoa na folha.">Filial · matrícula</th>
            <th style={S.th}>Nome (folha)</th>
            <th style={S.th}>Fornecedor</th><th style={S.th}>Nome fantasia</th><th style={S.th}>CNPJ</th>
          </tr></thead>
          <tbody>
            {shown.slice(0, 500).map(r => (
              <tr key={r.id}>
                <td style={S.mono}>{r.empresa_cod || '—'}</td>
                <td style={{ ...S.mono, color: r.matricula_folha && r.filial_cod ? 'var(--green)' : 'var(--muted)' }}>
                  {r.matricula_folha ? `${r.filial_cod || '??'}-${r.matricula_folha}` : 'sem chave'}
                </td>
                <td style={S.td}>{r.nome_sra || r.nome || '—'}</td>
                <td style={S.mono}>{r.fornecedor_cod}{r.fornecedor_loja ? `/${r.fornecedor_loja}` : ''}</td>
                <td style={{ ...S.td, color: r.nome_fantasia ? 'var(--text)' : 'var(--orange)' }}>{r.nome_fantasia || 'sem fantasia — não amarra'}</td>
                <td style={S.mono}>{r.cnpj || '—'}</td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={6} style={S.empty}>
              {loading ? 'Carregando…' : busca ? 'Nada com esse termo.' : 'Nenhuma amarração ainda — importe o export RD0 × SA2 para o PJ ganhar nome na conciliação.'}
            </td></tr>}
          </tbody>
        </table>
        {shown.length > 500 && <div style={{ ...S.hint, paddingBottom: 12 }}>mostrando as 500 primeiras de {shown.length} — use a busca para chegar a uma pessoa.</div>}
      </div>
    </div>
  )
}
