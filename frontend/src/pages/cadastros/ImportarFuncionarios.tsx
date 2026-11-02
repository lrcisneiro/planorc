import { useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { supabase } from '../../lib/supabase'
import { lerPlanilha } from '../../lib/planilha'
import { mapearColunas, aplicar, type PerfilImport } from '../../lib/importPerfil'
import { Upload, X, CheckCircle2, AlertTriangle } from 'lucide-react'

// ============================================================
// Importar a relação de funcionários (CPF) — o primeiro importador escrito como
// PADRÃO, e não como mais um caso particular.
//
// Três partes separadas de propósito, porque é o que permite trocar de ERP:
//   1. `lerPlanilha` — ler arquivo. Não sabe nada do conteúdo.
//   2. `PERFIL` abaixo — o de-para de COLUNAS deste ERP. Trocar de ERP é
//      acrescentar um perfil, não editar esta tela.
//   3. `importar_funcionarios` (v3_149) — o casamento, no banco, atômico, com
//      modo simulação. O navegador só traduz e envia.
//
// O CPF não encosta em arquivo nenhum: sai da planilha, vira JSON, entra no
// banco. Gerar um .sql com os CPFs os colocaria no histórico do git — era o
// caminho que eu ia tomar antes de ser (corretamente) barrado.
//
// `filial_cod` é montado AQUI, não no banco: concatenar "Código da empresa" com
// "Código da filial" é convenção desta instalação do Protheus. Mantê-la no
// perfil, perto das colunas, é o que faz o banco continuar genérico.
// ============================================================

const PERFIL: PerfilImport = {
  id: 'protheus.relacao_funcionario',
  nome: 'Protheus · Relação de Funcionários',
  origem: 'Protheus → Relatórios → Relação de Funcionários (SRA), com CPF',
  campos: [
    { campo: 'cpf',       aliases: ['CPF do funcionário', 'CPF', 'RA_CIC'], obrigatorio: true },
    { campo: 'nome',      aliases: ['Nome do funcionário', 'Nome', 'RA_NOME'], obrigatorio: true },
    { campo: 'matricula', aliases: ['Matrícula do funcionário', 'Matrícula', 'Matricula', 'RA_MAT'], obrigatorio: true },
    { campo: 'empresa',   aliases: ['Código da empresa', 'Empresa', 'Cod. Empresa'], obrigatorio: true },
    { campo: 'filial',    aliases: ['Código da filial', 'Filial', 'Cod. Filial', 'RA_FILIAL'], obrigatorio: true },
  ],
}

type Previa = {
  simulado: boolean; linhas: number; pessoas: number; pessoas_novas: number
  postos_chave: number; postos_nome: number; postos_sem: number
  sem_detalhe: { posto: string; nome: string }[]
}

const S: Record<string, CSSProperties> = {
  btn:   { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', fontSize: 13, background: 'var(--panel)', color: 'var(--text-mid)', border: '1px solid var(--border-strong)', borderRadius: 8, cursor: 'pointer' },
  back:  { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 20 },
  modal: { background: 'var(--panel)', border: '1px solid var(--border-strong)', borderRadius: 14, padding: 20, width: 'min(620px, 100%)', maxHeight: '86vh', overflowY: 'auto' },
  tit:   { fontSize: 16, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, margin: '0 0 4px' },
  sub:   { fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.6, margin: '0 0 16px' },
  linha: { display: 'flex', justifyContent: 'space-between', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 13 },
  num:   { fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' },
  aviso: { fontSize: 12.5, color: 'var(--orange)', background: 'rgba(251,146,60,0.10)', border: '1px solid rgba(251,146,60,0.4)', borderRadius: 8, padding: '9px 12px', margin: '12px 0 0', lineHeight: 1.6 },
  ok:    { fontSize: 12.5, color: 'var(--green)', background: 'rgba(34,197,94,0.10)', border: '1px solid rgba(34,197,94,0.35)', borderRadius: 8, padding: '9px 12px', margin: '12px 0 0', lineHeight: 1.6 },
}

export function ImportarFuncionarios({ onFim }: { onFim: () => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const [linhas, setLinhas] = useState<any[] | null>(null)
  const [prev, setPrev] = useState<Previa | null>(null)
  const [erro, setErro] = useState('')
  const [feito, setFeito] = useState(false)
  const [ocupado, setOcupado] = useState(false)

  const chamar = async (dados: any[], simular: boolean) => {
    const { data, error } = await supabase.rpc('importar_funcionarios', { p_linhas: dados, p_simular: simular })
    if (error) throw new Error(error.message)
    return data as Previa
  }

  const escolher = async (f: File) => {
    setErro(''); setPrev(null); setFeito(false); setOcupado(true)
    try {
      const brutas = await lerPlanilha(f)
      if (!brutas.length) throw new Error('A planilha está vazia.')
      const mapa = mapearColunas(PERFIL, Object.keys(brutas[0]))
      if (mapa.faltando.length) {
        throw new Error(`Faltam colunas: ${mapa.faltando.join(', ')}.\n\nEsperado de: ${PERFIL.origem}`)
      }
      // `filial_cod` = empresa + filial com zero à esquerda ("20"+"01" = "2001").
      // Convenção desta instalação; mora no perfil, não no banco.
      const dados = brutas.map(b => {
        const r = aplicar(mapa, b)
        return {
          cpf: String(r.cpf ?? ''), nome: String(r.nome ?? ''),
          matricula: String(r.matricula ?? '').trim(),
          filial_cod: String(r.empresa ?? '').trim().padStart(2, '0')
                    + String(r.filial ?? '').trim().padStart(2, '0'),
        }
      }).filter(r => r.cpf && r.nome)
      setLinhas(dados)
      setPrev(await chamar(dados, true))
    } catch (e: any) { setErro(e?.message || String(e)) }
    finally { setOcupado(false) }
  }

  const aplicarAgora = async () => {
    if (!linhas) return
    setOcupado(true); setErro('')
    try { setPrev(await chamar(linhas, false)); setFeito(true); onFim() }
    catch (e: any) { setErro(e?.message || String(e)) }
    finally { setOcupado(false) }
  }

  return (
    <>
      <button style={S.btn} onClick={() => ref.current?.click()} disabled={ocupado}
              title={PERFIL.origem}>
        <Upload size={14} /> {ocupado ? 'Lendo…' : 'Importar relação (CPF)'}
      </button>
      <input ref={ref} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
             onChange={e => { const f = e.target.files?.[0]; if (f) escolher(f); e.target.value = '' }} />

      {(prev || erro) && (
        <div style={S.back} onClick={e => { if (e.target === e.currentTarget) { setPrev(null); setErro('') } }}>
          <div style={S.modal}>
            <div style={S.tit}>
              <span>{feito ? 'Importado' : 'Prévia da importação'}</span>
              <X size={18} style={{ cursor: 'pointer', color: 'var(--muted)' }}
                 onClick={() => { setPrev(null); setErro('') }} />
            </div>
            <p style={S.sub}>{PERFIL.nome}</p>

            {erro && <div style={S.aviso}><AlertTriangle size={14} style={{ verticalAlign: -2 }} /> {erro}</div>}

            {prev && <>
              <div style={S.linha}><span>Linhas lidas</span><span style={S.num}>{prev.linhas}</span></div>
              <div style={S.linha}><span>Pessoas (CPF distinto)</span><span style={S.num}>{prev.pessoas}</span></div>
              <div style={S.linha}><span>Pessoas novas no cadastro</span><span style={S.num}>{prev.pessoas_novas}</span></div>
              <div style={S.linha}><span>Postos casados por <b>filial + matrícula</b></span><span style={S.num}>{prev.postos_chave}</span></div>
              <div style={S.linha}><span>Postos casados por <b>nome</b> <span style={{ color: 'var(--muted)' }}>(pró-labore)</span></span><span style={S.num}>{prev.postos_nome}</span></div>
              <div style={S.linha}><span>Postos ativos que ficam sem CPF</span><span style={{ ...S.num, color: prev.postos_sem ? 'var(--orange)' : 'var(--green)' }}>{prev.postos_sem}</span></div>

              {prev.sem_detalhe?.length > 0 && (
                <div style={S.aviso}>
                  <b>Ficam sem identidade</b> — confira se é cadastro errado ou gente que não está na relação:
                  <div style={{ marginTop: 6 }}>
                    {prev.sem_detalhe.slice(0, 12).map((d, i) =>
                      <div key={i}>· {d.nome} <span style={{ opacity: 0.7 }}>[{d.posto}]</span></div>)}
                    {prev.sem_detalhe.length > 12 && <div>· e mais {prev.sem_detalhe.length - 12}…</div>}
                  </div>
                </div>
              )}

              {feito
                ? <div style={S.ok}><CheckCircle2 size={14} style={{ verticalAlign: -2 }} /> Gravado. O headcount passa a contar pessoas, não matrículas.</div>
                : <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                    <button style={{ ...S.btn, borderColor: 'var(--violet)', color: 'var(--violet)' }}
                            onClick={aplicarAgora} disabled={ocupado}>
                      {ocupado ? 'Gravando…' : 'Aplicar'}
                    </button>
                    <button style={S.btn} onClick={() => { setPrev(null); setErro('') }}>Cancelar</button>
                  </div>}
            </>}
          </div>
        </div>
      )}
    </>
  )
}
