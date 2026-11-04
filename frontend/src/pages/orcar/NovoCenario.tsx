import { useEffect, useState } from 'react'
import { GitBranch, X, Loader2, AlertTriangle } from 'lucide-react'
import { supabase } from '../../lib/supabase'

// ============================================================
// Novo cenário de orçamento (B1).
//
// Semear o cenário é o ato de **liberar o orçamento para a área**: a versão
// passa a existir, a área ganha `ORCAR` nela por cadastro, e a baseline fica
// intacta. Por isso o botão vive ao lado do seletor de versão — é dali que se
// escolhe a baseline que vai ser copiada.
//
// ⚠ SÓ ADMIN. A trava que vale é a do banco (`copiar_versao` levanta 42501),
// mas o botão não aparece para quem não pode: oferecer e negar depois é pior
// que não oferecer.
//
// ⚠ A PRÉVIA VEM ANTES. "Vai copiar 24.454 células de Orçado2027" é a única
// coisa que distingue semear da baseline certa de semear da errada — e as duas
// parecem iguais depois de feitas. Mesma razão de `orcado_resumo_versao` na
// hora de apagar (v3_127): o número antes, não o estrago depois.
// ============================================================

type Versao = { id: string; codigo: string; ano?: number; bloqueada?: boolean; origem_versao_id?: string | null }

const S = {
  lbl: { fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: 0.6, color: 'var(--muted)', marginBottom: 5, fontWeight: 600 },
  inp: { height: 34, padding: '0 10px', borderRadius: 8, border: '1px solid var(--border-strong)', background: 'var(--panel-2)', color: 'var(--text)', fontSize: 13, width: '100%', boxSizing: 'border-box' as const },
}

export default function NovoCenario({ versoes, baseSugerida, onCriado }: {
  versoes: Versao[]
  baseSugerida?: string
  onCriado: (id: string) => void
}) {
  const [aberto, setAberto] = useState(false)
  // Só versão BASELINE pode ser semeada: cenário de cenário empilharia Δ sobre
  // Δ e o comparativo não saberia mais contra o que medir.
  const bases = versoes.filter(v => !v.origem_versao_id)
  const [base, setBase] = useState('')
  const [codigo, setCodigo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [semear, setSemear] = useState(true)
  const [previa, setPrevia] = useState<number | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => {
    if (!aberto) return
    setErro(''); setSalvando(false)
    const b = baseSugerida && bases.some(v => v.id === baseSugerida) ? baseSugerida : (bases[0]?.id || '')
    setBase(b)
  }, [aberto]) // eslint-disable-line

  // Prévia do peso da baseline escolhida.
  useEffect(() => {
    if (!aberto || !base) { setPrevia(null); return }
    let vivo = true
    setPrevia(null)
    supabase.from('fat_orcado').select('id', { count: 'exact', head: true }).eq('versao_id', base)
      .then(({ count }) => { if (vivo) setPrevia(count ?? 0) })
    return () => { vivo = false }
  }, [aberto, base])

  const baseObj = bases.find(v => v.id === base)

  async function criar() {
    if (!base || !codigo.trim()) { setErro('Escolha a baseline e dê um código ao cenário.'); return }
    setSalvando(true); setErro('')
    const { data, error } = await supabase.rpc('copiar_versao', {
      p_origem: base, p_codigo: codigo.trim(), p_descricao: descricao.trim() || null, p_semear: semear,
    })
    setSalvando(false)
    if (error) { setErro(error.message); return }
    const r: any = Array.isArray(data) ? data[0] : data
    if (!r?.versao_id) { setErro('O banco não devolveu a versão criada.'); return }
    setAberto(false); setCodigo(''); setDescricao('')
    onCriado(r.versao_id)
  }

  return (<>
    <button onClick={() => setAberto(true)} title="Criar uma versão de cenário a partir de uma baseline"
      style={{ height: 34, padding: '0 12px', borderRadius: 8, border: '1px solid var(--border-strong)',
               background: 'var(--panel-2)', color: 'var(--text)', fontSize: 13, cursor: 'pointer',
               display: 'inline-flex', alignItems: 'center', gap: 7 }}>
      <GitBranch size={14} /> Novo cenário
    </button>

    {aberto && (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 60,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 }}
           onClick={() => !salvando && setAberto(false)}>
        <div onClick={e => e.stopPropagation()}
             style={{ width: 'min(520px, 100%)', background: 'var(--panel)', border: '1px solid var(--border-strong)',
                      borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '15px 18px', borderBottom: '1px solid var(--border)' }}>
            <GitBranch size={17} style={{ color: 'var(--violet)' }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--text)' }}>Novo cenário de orçamento</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>A baseline não é alterada. A área propõe aqui.</div>
            </div>
            <button onClick={() => setAberto(false)} disabled={salvando}
              style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: 4 }}>
              <X size={17} />
            </button>
          </div>

          <div style={{ padding: 18, display: 'grid', gap: 14 }}>
            <div>
              <div style={S.lbl}>Semear a partir de (baseline)</div>
              <select style={{ ...S.inp, cursor: 'pointer' }} value={base} onChange={e => setBase(e.target.value)}>
                {!bases.length && <option value="">— nenhuma baseline no seu escopo —</option>}
                {bases.map(v => <option key={v.id} value={v.id}>{v.codigo}{v.ano ? ` · ${v.ano}` : ''}</option>)}
              </select>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 5, minHeight: 16 }}>
                {base && (previa === null
                  ? 'Contando as células…'
                  : `${previa.toLocaleString('pt-BR')} células em ${baseObj?.codigo}.`)}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 12 }}>
              <div>
                <div style={S.lbl}>Código</div>
                <input style={S.inp} value={codigo} maxLength={40} placeholder="ex.: 2027_COMERCIAL"
                  onChange={e => setCodigo(e.target.value.toUpperCase())} />
              </div>
              <div>
                <div style={S.lbl}>Descrição</div>
                <input style={S.inp} value={descricao} placeholder="ex.: 2027 · Comercial"
                  onChange={e => setDescricao(e.target.value)} />
              </div>
            </div>

            <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', fontSize: 12.5, color: 'var(--text)', cursor: 'pointer' }}>
              <input type="checkbox" checked={semear} onChange={e => setSemear(e.target.checked)} style={{ marginTop: 2 }} />
              <span>Copiar o orçado da baseline
                <span style={{ color: 'var(--muted)' }}> — copia a <b>baseline inteira</b>, todas as
                origens (posto, formulário, manual). <b>O filtro da tela não entra aqui:</b> o cenário é
                a versão inteira, e quem enxerga e edita o quê continua sendo o escopo de acesso de cada
                pessoa. A liberação depois escreve só o que é manual e só o que foi alterado.</span></span>
            </label>

            {/* ⚠ Cenário vazio é só ADITIVO, e isso precisa ser dito: do
                contrário parece que ele "parte do zero" e que apagar é
                possível por omissão — que é justamente o que a v3_175
                impediu no banco. */}
            {!semear && (
              <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', fontSize: 12,
                            color: 'var(--orange)', background: 'rgba(245,158,11,0.10)',
                            border: '1px solid rgba(245,158,11,0.4)', borderRadius: 8, padding: '9px 11px', lineHeight: 1.5 }}>
                <AlertTriangle size={14} style={{ marginTop: 1, flexShrink: 0 }} />
                <span>O cenário nasce <b>vazio</b>: o comparativo mostrará a área toda como corte, e a
                liberação será <b>só aditiva</b> — o que não estiver nele não é tratado como proposta de
                apagar.</span>
              </div>
            )}

            {erro && <div style={{ fontSize: 12.5, color: 'var(--red)' }}>{erro}</div>}

            <div style={{ display: 'flex', gap: 9, justifyContent: 'flex-end' }}>
              <button onClick={() => setAberto(false)} disabled={salvando}
                style={{ height: 34, padding: '0 14px', borderRadius: 8, border: '1px solid var(--border-strong)',
                         background: 'transparent', color: 'var(--text)', fontSize: 13, cursor: 'pointer' }}>Cancelar</button>
              {/* ⚠ Botão desabilitado tem de PARECER desabilitado: antes só
                  esmaecia durante o salvamento, então sem código ele ficava
                  roxo, convidativo e inerte — e quem clica e não vê nada
                  acontecer procura defeito em vez de preencher o campo. */}
              <button onClick={criar} disabled={salvando || !base || !codigo.trim()}
                title={!codigo.trim() ? 'Dê um código ao cenário para continuar' : undefined}
                style={{ height: 34, padding: '0 16px', borderRadius: 8, border: 'none',
                         background: !base || !codigo.trim() ? 'var(--panel-2)' : 'var(--violet)',
                         color: !base || !codigo.trim() ? 'var(--muted)' : '#fff', fontSize: 13, fontWeight: 600,
                         cursor: salvando || !base || !codigo.trim() ? 'default' : 'pointer', opacity: salvando ? 0.7 : 1,
                         display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                {salvando && <Loader2 size={14} className="animate-spin" />}
                {salvando ? 'Criando…' : 'Criar cenário'}
              </button>
            </div>
          </div>
        </div>
      </div>
    )}
  </>)
}
