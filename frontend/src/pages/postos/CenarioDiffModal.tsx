import { useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { X, Download, Scissors, TrendingUp, CalendarRange, Gauge, Pause, Check, RotateCcw, Undo2 } from 'lucide-react'
import { calcularPosto } from '../../lib/motorFolha'
import { resolvePosto, camposAlterados, type PostoVersao, type CampoCenario } from '../../lib/postoVersao'
import { downloadSheet } from '../../lib/planilha'
import { exportarPdf } from '../../lib/exportarDash'

// ============================================================
// O que esta área quer mudar — cadastro (ERP) × cenário.
//
// Serve para APROVAR: o gerente decide no cenário, e quem aprova precisa ver,
// por pessoa, o que muda e quanto custa antes de carimbar.
//
// ⚠ O CUSTO VEM DO MOTOR, NOS DOIS LADOS — nunca de `salário × 12`. Um corte em
// maio não é 7/12 do ano: tem aviso prévio, 13º e férias proporcionais, multa
// de FGTS. Um reajuste em setembro não é proporcional linear, porque incide
// sobre encargos e provisões. Derivar o Δ de qualquer atalho produz um número
// plausível e errado — e aqui o número é o que decide a aprovação.
//
// ⚠ Agrupa por TIPO DE DECISÃO e não por centro de custo. "Cortou três" e
// "reajustou cinco" são conversas diferentes, e quem aprova decide uma de cada
// vez. Por CC, as duas ficariam embaralhadas em cada caixa.
//
// Leitura pura: não grava nada. A aprovação em si é a fase seguinte.
// ============================================================

const money = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
// O sinal vem ANTES do símbolo: "−R$ 250.866,42", não "R$ -250.866,42".
const mil = (v: number) => {
  const s = v < 0 ? '−' : ''
  const a = Math.abs(v)
  return a >= 1e6
    ? `${s}R$ ${(a / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} mi`
    : `${s}R$ ${money(a)}`
}
const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

type Tipo = 'corte' | 'vigencia' | 'reajuste' | 'fte' | 'afastamento'
const TIPOS: { k: Tipo; nome: string; icone: any; cor: string }[] = [
  { k: 'corte',       nome: 'Cortes',                icone: Scissors,      cor: 'var(--red)' },
  { k: 'vigencia',    nome: 'Entrada e saída',       icone: CalendarRange, cor: 'var(--orange)' },
  { k: 'reajuste',    nome: 'Reajustes e promoções', icone: TrendingUp,    cor: 'var(--violet)' },
  { k: 'fte',         nome: 'Jornada (FTE)',         icone: Gauge,         cor: 'var(--blue)' },
  { k: 'afastamento', nome: 'Afastamentos',          icone: Pause,         cor: 'var(--muted)' },
]

// Um posto pode mudar várias coisas; a classificação é por PRECEDÊNCIA, para
// cada linha aparecer uma vez só. Corte domina: quem sai não interessa o
// reajuste que teria recebido.
function tipoDe(campos: CampoCenario[]): Tipo {
  if (campos.includes('ativo')) return 'corte'
  if (campos.some(c => c.startsWith('fim_') || c.startsWith('ini_'))) return 'vigencia'
  if (campos.some(c => c === 'salario_base' || c.startsWith('reajuste_') || c === ('cargo_id' as any))) return 'reajuste'
  if (campos.includes('fte')) return 'fte'
  return 'afastamento'
}

const S: Record<string, CSSProperties> = {
  fundo: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 },
  cx:    { width: 'min(1120px, 100%)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', background: 'var(--panel)', border: '1px solid var(--border-strong)', borderRadius: 14, overflow: 'hidden' },
  topo:  { display: 'flex', alignItems: 'flex-start', gap: 14, padding: '18px 22px', borderBottom: '1px solid var(--border)' },
  corpo: { overflowY: 'auto', padding: '18px 22px 24px' },
  kpis:  { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginBottom: 20 },
  kpi:   { background: 'var(--bg-soft)', border: '1px solid var(--border)', borderRadius: 10, padding: '13px 15px' },
  kl:    { fontSize: 10.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  kv:    { fontSize: 19, fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' },
  sec:   { display: 'flex', alignItems: 'center', gap: 8, margin: '22px 0 8px', fontSize: 13.5, fontWeight: 700, color: 'var(--text)' },
  tab:   { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 },
  th:    { textAlign: 'left', padding: '6px 9px', fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' },
  td:    { padding: '8px 9px', borderBottom: '1px solid var(--panel-2)', color: 'var(--text-mid)', verticalAlign: 'top' },
  btn:   { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', fontSize: 12.5, background: 'var(--panel)', color: 'var(--text-mid)', border: '1px solid var(--border-strong)', borderRadius: 8, cursor: 'pointer' },
  de:    { color: 'var(--muted)', textDecoration: 'line-through' },
  para:  { color: 'var(--text)', fontWeight: 600 },
}

export default function CenarioDiffModal(props: any) {
  const { postos, overlays, verbas, dissidio, sindMesBase, anoCalc, postoVerbas,
          empPais, empById, ccById, cargoNome, versaoLabel, onClose,
          aprovadoEm, aprovacaoNota, podeAprovar, onDecidir, onVeredito, vereditos,
          podeDecidir, onAbandonar, onReabrir } = props
  const [nota, setNota] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erroAprov, setErroAprov] = useState('')
  // Recusa escreve NA LINHA. `window.prompt` resolvia e destoava — e, pior,
  // uma caixa do sistema sobre uma tela escura tira a pessoa do contexto
  // justamente quando ela precisa olhar o número que está recusando.
  const [recusando, setRecusando] = useState<{ id: string; texto: string } | null>(null)
  // Responder e reenviar são o MESMO ato. Editor na linha, pelo mesmo motivo da
  // recusa: a resposta se escreve olhando para o que foi objetado.
  const [respondendo, setRespondendo] = useState<{ id: string; texto: string } | null>(null)

  const decidir = async (aprovar: boolean) => {
    setErroAprov(''); setSalvando(true)
    try { await onDecidir(aprovar, nota); setNota('') }
    catch (e: any) { setErroAprov(e?.message || 'Não foi possível concluir.') }
    finally { setSalvando(false) }
  }
  // O PDF captura ESTE nó. O cabeçalho e os botões ficam fora dele: o título
  // vai no cabeçalho do próprio PDF, e botão impresso em papel é ruído.
  const corpoRef = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState(false)
  const [gerando, setGerando] = useState(false)

  const calc = (p: any) => calcularPosto(
    { ...p, pais: empPais.get(p.empresa_id) ?? null }, verbas,
    { dissidioPct: p.sindicato_id ? (dissidio[p.sindicato_id] || 0) : 0,
      mesBase: p.sindicato_id ? (sindMesBase[p.sindicato_id] || 1) : 1,
      ano: anoCalc, valoresFixos: postoVerbas[p.id] || {} })

  // Rótulo do campo, com o valor já legível. `null` = "limpo pelo cenário".
  const valor = (campo: string, v: any): string => {
    if (v === null || v === undefined || v === '') return '—'
    if (campo === 'salario_base') return `R$ ${money(Number(v))}`
    if (campo === 'reajuste_pct') return `${v}%`
    if (campo === 'reajuste_valor') return `R$ ${money(Number(v))}`
    if (campo === 'reajuste_mes' || campo.endsWith('_mes')) return MES[Number(v) - 1] || String(v)
    if (campo === 'ativo') return v === false ? 'cortado' : 'ativo'
    if (campo === 'cargo_id') return cargoNome?.(v) || String(v)
    return String(v)
  }
  const rotulo: Record<string, string> = {
    salario_base: 'Salário', fte: 'FTE', ativo: 'Situação', cargo_id: 'Cargo',
    ini_ano: 'Início (ano)', ini_mes: 'Início', fim_ano: 'Saída (ano)', fim_mes: 'Saída',
    reajuste_mes: 'Reajuste em', reajuste_pct: 'Reajuste %', reajuste_valor: 'Reajuste R$',
    afast_ini_mes: 'Afast. de', afast_fim_mes: 'Afast. até',
    afast_ini_ano: 'Afast. de (ano)', afast_fim_ano: 'Afast. até (ano)',
  }

  // ⚠ A recusa EXIGE motivo. Reprovar sem dizer o quê devolve o cenário e não
  // devolve a informação — o gerente fica adivinhando, e o ciclo não fecha.
  const marcar = async (l: any, aprovado: boolean | null, motivo: string | null = null) => {
    if (!l.ovId) return
    setErroAprov(''); setSalvando(true)
    try { await onVeredito(l.ovId, aprovado, motivo); setRecusando(null) }
    catch (e: any) { setErroAprov(e?.message || 'Não foi possível gravar o veredito.') }
    finally { setSalvando(false) }
  }
  const abrirRecusa = (l: any) => setRecusando({ id: l.ovId, texto: l.aprovNota || '' })

  // A recusa tem duas saídas: corrigir (na grade) ou abandonar (aqui). Sem a
  // segunda à mão, quem propôs tem de sair do comparativo, achar o posto na
  // grade e desfazer campo a campo — e o motivo da recusa fica para trás.
  const reabrir = async (l: any, texto: string) => {
    setErroAprov(''); setSalvando(true)
    try { await onReabrir(l.ovId, texto.trim() || null); setRespondendo(null) }
    catch (e: any) { setErroAprov(e?.message || 'Não foi possível reabrir.') }
    finally { setSalvando(false) }
  }

  const abandonar = async (l: any) => {
    if (!window.confirm(`Abandonar a decisão de ${l.nome}?\n\nO posto volta a herdar tudo do cadastro: ${l.campos.length} campo(s) decidido(s) são descartados${l.aprovNota ? ', junto com a recusa' : ''}.`)) return
    setErroAprov(''); setSalvando(true)
    try { await onAbandonar(l.id) }
    catch (e: any) { setErroAprov(e?.message || 'Não foi possível abandonar a decisão.') }
    finally { setSalvando(false) }
  }

  const bt = (ativo: boolean, cor: string): CSSProperties => ({
    padding: '3px 8px', fontSize: 11, fontWeight: 700, borderRadius: 6, cursor: podeAprovar ? 'pointer' : 'default',
    border: '1px solid ' + (ativo ? cor : 'var(--border)'),
    background: ativo ? cor.replace(')', ', 0.14)').replace('var(--', 'rgba(') : 'transparent',
    color: ativo ? cor : 'var(--muted)', opacity: podeAprovar ? 1 : 0.55,
  })

  const veredito = (l: any) => {
    const selo = l.aprovado === true
      ? <span style={{ color: 'var(--green)', fontSize: 11, fontWeight: 700 }}>✓ aprovada</span>
      : l.aprovado === false
      ? <span style={{ color: 'var(--red)', fontSize: 11, fontWeight: 700 }}>✗ recusada</span>
      : <span style={{ color: 'var(--muted)', fontSize: 11 }}>pendente</span>
    // Aprovada já virou acordo: abandonar aqui desfaria o que foi carimbado
    // sem passar por quem carimbou.
    const podeAbandonar = podeDecidir && l.aprovado !== true
    if (!podeAprovar) return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        {selo}
        {/* Responder a uma recusa costuma ser justificar, não mudar número — e
            aí nada dispara o gatilho. Sem este botão, a decisão ficaria recusada
            para sempre mesmo depois de respondida. */}
        {podeDecidir && l.aprovado === false && (
          <button disabled={salvando} onClick={() => setRespondendo({ id: l.ovId, texto: l.nota || '' })} data-noexport
            title="Devolver para análise: o aprovador vê de novo, com a sua justificativa no cenário"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none',
                     color: 'var(--violet)', cursor: 'pointer', padding: 0, fontSize: 10.5, textDecoration: 'underline' }}>
            <RotateCcw size={11} /> reenviar para análise
          </button>
        )}
        {podeAbandonar && (
          <button disabled={salvando} onClick={() => abandonar(l)} data-noexport
            title="Descartar esta decisão: o posto volta a herdar tudo do cadastro"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none',
                     color: 'var(--muted)', cursor: 'pointer', padding: 0, fontSize: 10.5, textDecoration: 'underline' }}>
            <Undo2 size={11} /> voltar ao cadastro
          </button>
        )}
      </div>
    )
    return (
      <div style={{ display: 'inline-flex', gap: 4 }}>
        <button disabled={salvando} style={bt(l.aprovado === true, 'var(--green)')}
          title="Aprovar esta decisão" onClick={() => marcar(l, l.aprovado === true ? null : true)}>✓</button>
        <button disabled={salvando} style={bt(l.aprovado === false, 'var(--red)')}
          title={l.aprovado === false ? 'Desfazer a recusa' : 'Recusar, dizendo o motivo'}
          onClick={() => l.aprovado === false ? marcar(l, null, null) : abrirRecusa(l)}>✗</button>
      </div>
    )
  }

  const linhas = useMemo(() => {
    const out: any[] = []
    for (const m of postos as any[]) {
      const ov: PostoVersao | undefined = overlays.get(m.id)
      const campos = camposAlterados(m, ov)
      if (!campos.length) continue
      const ef = resolvePosto(m, ov)
      // Posto cortado não some do orçamento: o motor o calcula com o custo da
      // rescisão no mês da saída. Por isso os dois lados vão ao motor igual.
      const cm = calc(m).totalAno
      const ce = calc(ef).totalAno
      out.push({
        id: m.id, codigo: m.codigo, nome: m.nome || 'VAGA',
        cc: ccById.get(m.cc_id)?.codigo || '—',
        emp: empById.get(m.empresa_id)?.codigo || '—',
        cargo: cargoNome?.(ef.cargo_id) || '—',
        campos, tipo: tipoDe(campos), mestre: m, ef,
        custoM: cm, custoE: ce, delta: ce - cm,
        nota: ov?.nota || '',
        ovId: ov?.id, aprovado: (ov as any)?.aprovado ?? null, aprovNota: (ov as any)?.aprov_nota || '',
      })
    }
    return out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
  }, [postos, overlays, verbas, dissidio, sindMesBase, anoCalc, postoVerbas]) // eslint-disable-line

  // ⚠ O escopo sai do DADO, não do filtro da tela. Filtro é vista: muda com
  // quem abriu e produziria outro PDF do mesmo cenário amanhã. O que foi
  // efetivamente tocado é propriedade do cenário, e é o que quem aprova precisa
  // saber que está carimbando.
  // Ele diz o que foi TOCADO, não o que poderia ter sido: se a pessoa alcançava
  // doze centros de custo e mexeu em três, aparecem três.
  const escopo = useMemo(() => {
    const emp = new Set<string>(), fil = new Set<string>(), cc = new Map<string, string>()
    for (const l of linhas) {
      const m: any = l.mestre
      if (m.empresa_id) emp.add(empById.get(m.empresa_id)?.codigo || '?')
      if (m.filial_id) fil.add((props.filById?.get(m.filial_id)?.codigo) || '')
      if (m.cc_id) {
        const c = ccById.get(m.cc_id)
        cc.set(c?.codigo || '?', c?.descricao || '')
      }
    }
    fil.delete('')
    const ccs = [...cc.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    return {
      emp: [...emp].sort(), fil: [...fil].sort(), ccs,
      texto: ccs.map(([c, d]) => d ? `${c} ${d}` : c).join(' · '),
    }
  }, [linhas, empById, ccById]) // eslint-disable-line

  // ⚠ OS TOTAIS SEGUEM O VEREDITO. Recusada não entra no orçado — aquele posto
  // vai com o cadastro —, então ela contribui ZERO. Somá-la faria o cartão
  // anunciar um efeito que não vai acontecer, logo acima do botão que fecha o
  // cenário. Sem veredito nenhum, tudo conta: é a proposta inteira, que era o
  // comportamento anterior e continua certo enquanto ninguém decidiu.
  const valem = linhas.filter(l => l.aprovado !== false)
  const total = valem.reduce((s, l) => s + l.delta, 0)
  const sobe = valem.filter(l => l.delta > 0).reduce((s, l) => s + l.delta, 0)
  const desce = valem.filter(l => l.delta < 0).reduce((s, l) => s + l.delta, 0)
  // O proposto continua à vista quando difere: quem aprova precisa saber o
  // tamanho do que foi pedido, não só o do que passou.
  const totalProposto = linhas.reduce((s, l) => s + l.delta, 0)
  const nRecusadas = linhas.length - valem.length

  const nomeArq = `cenario_${(versaoLabel || 'versao').replace(/\W+/g, '_')}_para_aprovacao`

  const exportarPdfTela = async () => {
    if (!corpoRef.current) return
    setMenu(false); setGerando(true)
    try {
      await exportarPdf(corpoRef.current, {
        nome: nomeArq,
        titulo: 'O que esta área quer mudar',
        // O PDF sai da tela e perde o contexto do cabeçalho — a legenda o
        // devolve, senão a folha circula sem dizer de qual cenário se trata.
        legenda: `Cadastro (ERP) × cenário ${versaoLabel} · ${linhas.length} posto(s) decidido(s)`
          + ` · efeito no ano ${mil(total)} · CC: ${escopo.ccs.map(([c]) => c).join(', ')}`,
      })
    } finally { setGerando(false) }
  }

  const exportar = () => {
    setMenu(false)
    const aoa: any[][] = [[
      'Posto', 'Ocupante', 'Empresa', 'CC', 'Cargo (cenário)', 'Tipo', 'O que muda',
      'Custo ano — cadastro', 'Custo ano — cenário', 'Δ', 'Veredito', 'Motivo da recusa', 'Justificativa',
    ]]
    for (const t of TIPOS) for (const l of linhas.filter(x => x.tipo === t.k)) {
      aoa.push([l.codigo, l.nome, l.emp, l.cc, l.cargo, t.nome,
        l.campos.map((c: string) => `${rotulo[c] || c}: ${valor(c, (l.mestre as any)[c])} → ${valor(c, (l.ef as any)[c])}`).join(' · '),
        l.custoM, l.custoE, l.delta,
        l.aprovado === true ? 'aprovada' : l.aprovado === false ? 'recusada' : 'pendente',
        l.aprovNota, l.nota])
    }
    aoa.push([], ['TOTAL (o que entra no orçado)', '', '', '', '', '', '', '', '', total, ''])
    if (nRecusadas) aoa.push(['TOTAL proposto (inclui recusadas)', '', '', '', '', '', '', '', '', totalProposto, ''])
    aoa.push([], ['Escopo alcançado'], ['Empresas', escopo.emp.join(', ')],
             ['Filiais', escopo.fil.join(', ')], ['Centros de custo', escopo.texto])
    downloadSheet(`${nomeArq}.xlsx`, aoa, 'Decisões')
  }

  return (
    <div style={S.fundo} onClick={onClose}>
      <div style={S.cx} onClick={e => e.stopPropagation()}>
        <div style={S.topo}>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>
              O que esta área quer mudar
            </h2>
            <p style={{ margin: '5px 0 0', fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.6, maxWidth: '72ch' }}>
              Cadastro (o que o RH manda do ERP) × cenário <b style={{ color: 'var(--text-mid)' }}>{versaoLabel}</b>.
              O custo dos dois lados sai do motor da folha — inclui encargos, provisões e a
              rescisão de quem é cortado, que é por onde um corte no meio do ano deixa de ser
              proporcional.
            </p>
          </div>
          <div style={{ position: 'relative' }} data-noexport>
            <button style={S.btn} onClick={() => setMenu(v => !v)} disabled={gerando || !linhas.length}>
              <Download size={13} /> {gerando ? 'Gerando…' : 'Exportar'} ▾
            </button>
            {menu && (<>
              <div style={{ position: 'fixed', inset: 0, zIndex: 70 }} onClick={() => setMenu(false)} />
              <div style={{ position: 'absolute', top: 34, right: 0, zIndex: 71, width: 250, background: 'var(--panel)', border: '1px solid var(--border-strong)', borderRadius: 10, padding: 6, boxShadow: '0 10px 30px rgba(0,0,0,0.45)' }}>
                <button style={{ ...S.btn, width: '100%', border: 'none', background: 'transparent', justifyContent: 'flex-start', padding: '8px 10px' }}
                        onClick={exportarPdfTela}>
                  <span style={{ textAlign: 'left' }}>
                    <b style={{ color: 'var(--text)' }}>PDF</b>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>igual à tela, para circular e aprovar</div>
                  </span>
                </button>
                <button style={{ ...S.btn, width: '100%', border: 'none', background: 'transparent', justifyContent: 'flex-start', padding: '8px 10px' }}
                        onClick={exportar}>
                  <span style={{ textAlign: 'left' }}>
                    <b style={{ color: 'var(--text)' }}>Planilha</b>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>uma linha por posto, para recalcular</div>
                  </span>
                </button>
              </div>
            </>)}
          </div>
          <button style={{ ...S.btn, padding: '7px 9px' }} onClick={onClose} data-noexport><X size={14} /></button>
        </div>

        <div style={S.corpo} ref={corpoRef}>
          {!linhas.length ? (
            <div style={{ color: 'var(--muted)', fontSize: 13, padding: '30px 0', textAlign: 'center' }}>
              Este cenário ainda não decide nada — nenhum posto difere do cadastro.
            </div>
          ) : (<>
            <div style={S.kpis}>
              <div style={S.kpi}><div style={S.kl}>Postos decididos</div>
                <div style={S.kv}>{linhas.length}</div>
                {nRecusadas > 0 && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                  {valem.length} entra(m) · {nRecusadas} recusada(s)</div>}</div>
              <div style={S.kpi}><div style={S.kl}>Encarece</div>
                <div style={{ ...S.kv, color: 'var(--red)' }}>{sobe ? `+${mil(sobe)}` : '—'}</div></div>
              <div style={S.kpi}><div style={S.kl}>Economiza</div>
                <div style={{ ...S.kv, color: 'var(--green)' }}>{desce ? mil(desce) : '—'}</div></div>
              <div style={S.kpi}><div style={S.kl}>Efeito no ano</div>
                <div style={{ ...S.kv, color: total > 0 ? 'var(--red)' : total < 0 ? 'var(--green)' : undefined }}>
                  {total > 0 ? '+' : ''}{mil(total)}</div>
                {nRecusadas > 0 && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                  proposto: {totalProposto > 0 ? '+' : ''}{mil(totalProposto)}</div>}</div>
            </div>

            {escopo.ccs.length > 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-mid)', background: 'var(--bg-soft)',
                            border: '1px solid var(--border)', borderRadius: 9, padding: '10px 13px',
                            lineHeight: 1.65, marginBottom: 4 }}>
                <b style={{ color: 'var(--text)' }}>Alcança</b> {escopo.emp.length} empresa(s) ·
                {' '}{escopo.fil.length} filial(is) · {escopo.ccs.length} centro(s) de custo
                <div style={{ color: 'var(--muted)', marginTop: 3 }}>{escopo.texto}</div>
              </div>
            )}

            {TIPOS.map(t => {
              const ls = linhas.filter(l => l.tipo === t.k)
              if (!ls.length) return null
              const sub = ls.filter(l => l.aprovado !== false).reduce((s, l) => s + l.delta, 0)
              const Icone = t.icone
              return (
                <div key={t.k}>
                  <div style={S.sec}>
                    <Icone size={15} style={{ color: t.cor }} />
                    {t.nome}
                    <span style={{ fontWeight: 400, color: 'var(--muted)' }}>· {ls.length}</span>
                    <div style={{ flex: 1 }} />
                    <span style={{ fontSize: 12.5, fontVariantNumeric: 'tabular-nums',
                                   color: sub > 0 ? 'var(--red)' : sub < 0 ? 'var(--green)' : 'var(--muted)' }}>
                      {sub > 0 ? '+' : ''}{mil(sub)}</span>
                  </div>
                  <table style={S.tab}>
                    <thead><tr>
                      <th style={S.th}>Pessoa</th><th style={S.th}>Emp·CC</th><th style={S.th}>O que muda</th>
                      <th style={{ ...S.th, textAlign: 'right' }}>Cadastro</th>
                      <th style={{ ...S.th, textAlign: 'right' }}>Cenário</th>
                      <th style={{ ...S.th, textAlign: 'right' }}>Δ ano</th>
                      <th style={{ ...S.th, textAlign: 'center' }} data-noexport>Veredito</th>
                    </tr></thead>
                    <tbody>
                      {ls.map(l => (
                        <tr key={l.id}>
                          <td style={S.td}>
                            <div style={{ color: 'var(--text)' }}>{l.nome}</div>
                            <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'ui-monospace, monospace' }}>{l.codigo}</div>
                            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{l.cargo}</div>
                          </td>
                          <td style={{ ...S.td, fontFamily: 'ui-monospace, monospace', fontSize: 11.5 }}>{l.emp}·{l.cc}</td>
                          <td style={S.td}>
                            {l.campos.map((c: string) => (
                              <div key={c} style={{ marginBottom: 2 }}>
                                <span style={{ color: 'var(--muted)' }}>{rotulo[c] || c}: </span>
                                <span style={S.de}>{valor(c, (l.mestre as any)[c])}</span>
                                <span style={{ color: 'var(--muted)' }}> → </span>
                                <span style={S.para}>{valor(c, (l.ef as any)[c])}</span>
                              </div>
                            ))}
                            {/* A justificativa já existe no cenário (`posto_versao.nota`)
                                e é o que torna a aprovação uma conversa e não um palpite. */}
                            {l.nota && <div style={{ marginTop: 5, fontSize: 11.5, color: 'var(--muted)', fontStyle: 'italic' }}>“{l.nota}”</div>}
                            {/* A recusa aparece NA LINHA, junto do que foi proposto:
                                é assim que quem propôs entende o que precisa mudar. */}
                            {l.aprovado === null && l.aprovNota && (
                              <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--muted)', background: 'var(--bg-soft)',
                                            border: '1px dashed var(--border-strong)', borderRadius: 7, padding: '6px 9px', lineHeight: 1.55 }}>
                                <b>Reenviada.</b> Recusa anterior: “{l.aprovNota}”
                              </div>
                            )}
                            {l.aprovado === false && l.aprovNota && recusando?.id !== l.ovId && (
                              <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--red)', background: 'rgba(248,113,113,0.10)',
                                            border: '1px solid rgba(248,113,113,0.3)', borderRadius: 7, padding: '6px 9px', lineHeight: 1.55 }}>
                                <b>Recusada:</b> {l.aprovNota}
                                {podeAprovar && <button onClick={() => abrirRecusa(l)} data-noexport
                                  style={{ marginLeft: 7, background: 'none', border: 'none', color: 'var(--red)',
                                           textDecoration: 'underline', cursor: 'pointer', padding: 0, fontSize: 11 }}>editar</button>}
                              </div>
                            )}
                            {respondendo?.id === l.ovId && (
                              <div data-noexport style={{ marginTop: 6, background: 'rgba(139,92,246,0.08)',
                                border: '1px solid var(--violet)55', borderRadius: 8, padding: 9 }}>
                                <div style={{ fontSize: 11, color: 'var(--violet)', fontWeight: 700, marginBottom: 5 }}>
                                  Sua justificativa — vai para quem recusou
                                </div>
                                <textarea autoFocus rows={2} value={respondendo!.texto}
                                  onChange={e => setRespondendo({ id: l.ovId, texto: e.target.value })}
                                  onKeyDown={e => {
                                    if (e.key === 'Escape') setRespondendo(null)
                                    if (e.key === 'Enter' && !e.shiftKey && respondendo!.texto.trim()) {
                                      e.preventDefault(); reabrir(l, respondendo!.texto)
                                    }
                                  }}
                                  placeholder="ex.: assumiu a equipe de contratos em março; faixa do cargo novo começa em 21.500"
                                  style={{ width: '100%', boxSizing: 'border-box', fontSize: 12, padding: '6px 8px', resize: 'vertical',
                                           background: 'var(--bg-soft)', color: 'var(--text)',
                                           border: '1px solid var(--border-strong)', borderRadius: 7, fontFamily: 'inherit' }} />
                                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                                  <button disabled={salvando || !respondendo!.texto.trim()}
                                    onClick={() => reabrir(l, respondendo!.texto)}
                                    title={respondendo!.texto.trim() ? undefined : 'Reenviar sem responder devolve à fila sem dizer o que mudou no argumento.'}
                                    style={{ ...S.btn, padding: '4px 10px', fontSize: 11.5, borderColor: 'var(--violet)', color: 'var(--violet)',
                                             opacity: respondendo!.texto.trim() ? 1 : 0.45,
                                             cursor: respondendo!.texto.trim() ? 'pointer' : 'not-allowed' }}>
                                    Responder e reenviar
                                  </button>
                                  <button onClick={() => setRespondendo(null)}
                                    style={{ ...S.btn, padding: '4px 10px', fontSize: 11.5 }}>Cancelar</button>
                                </div>
                              </div>
                            )}
                            {recusando?.id === l.ovId && (
                              <div data-noexport style={{ marginTop: 6, background: 'rgba(248,113,113,0.08)',
                                border: '1px solid rgba(248,113,113,0.35)', borderRadius: 8, padding: 9 }}>
                                <div style={{ fontSize: 11, color: 'var(--red)', fontWeight: 700, marginBottom: 5 }}>
                                  Por que não passa? Este texto vai para quem propôs.
                                </div>
                                <textarea autoFocus rows={2} value={recusando!.texto}
                                  onChange={e => setRecusando({ id: l.ovId, texto: e.target.value })}
                                  onKeyDown={e => {
                                    if (e.key === 'Escape') setRecusando(null)
                                    // Enter confirma; Shift+Enter quebra linha. Motivo costuma
                                    // ser uma frase, e obrigar a pegar o mouse trava o ritmo
                                    // de quem está revisando quatorze decisões.
                                    if (e.key === 'Enter' && !e.shiftKey && recusando!.texto.trim()) {
                                      e.preventDefault(); marcar(l, false, recusando!.texto.trim())
                                    }
                                  }}
                                  placeholder="ex.: reajuste acima da faixa do cargo — rever para 8%"
                                  style={{ width: '100%', boxSizing: 'border-box', fontSize: 12, padding: '6px 8px', resize: 'vertical',
                                           background: 'var(--bg-soft)', color: 'var(--text)',
                                           border: '1px solid var(--border-strong)', borderRadius: 7, fontFamily: 'inherit' }} />
                                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                                  <button disabled={salvando || !recusando!.texto.trim()}
                                    onClick={() => marcar(l, false, recusando!.texto.trim())}
                                    title={recusando!.texto.trim() ? undefined : 'Recusar sem motivo devolve o cenário sem devolver a informação.'}
                                    style={{ ...S.btn, padding: '4px 10px', fontSize: 11.5, borderColor: 'var(--red)', color: 'var(--red)',
                                             opacity: recusando!.texto.trim() ? 1 : 0.45,
                                             cursor: recusando!.texto.trim() ? 'pointer' : 'not-allowed' }}>
                                    Recusar
                                  </button>
                                  <button onClick={() => setRecusando(null)}
                                    style={{ ...S.btn, padding: '4px 10px', fontSize: 11.5 }}>Cancelar</button>
                                </div>
                              </div>
                            )}
                          </td>
                          <td style={{ ...S.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(l.custoM)}</td>
                          <td style={{ ...S.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text)' }}>{money(l.custoE)}</td>
                          <td style={{ ...S.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700,
                                       color: l.delta > 0 ? 'var(--red)' : l.delta < 0 ? 'var(--green)' : 'var(--muted)' }}>
                            {l.delta > 0 ? '+' : ''}{money(l.delta)}</td>
                          <td style={{ ...S.td, textAlign: 'center', whiteSpace: 'nowrap' }} data-noexport>
                            {veredito(l)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            })}

            {/* A aprovação fecha o ciclo aqui, onde se vê o que se aprova —
                não num botão solto na barra, longe dos números. */}
            <div style={{ marginTop: 26, paddingTop: 18, borderTop: '1px solid var(--border)' }} data-noexport>
              {erroAprov && <div style={{ fontSize: 12.5, color: 'var(--red)', background: 'rgba(248,113,113,0.10)',
                border: '1px solid rgba(248,113,113,0.4)', borderRadius: 8, padding: '9px 12px', marginBottom: 12 }}>{erroAprov}</div>}

              {aprovadoEm ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                  padding: '12px 14px', borderRadius: 10, border: '1px solid rgba(52,211,153,0.35)', background: 'rgba(52,211,153,0.10)' }}>
                  <Check size={16} style={{ color: 'var(--green)' }} />
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <b style={{ color: 'var(--green)', fontSize: 13 }}>Cenário aprovado</b>
                    <div style={{ fontSize: 12, color: 'var(--text-mid)' }}>
                      em {new Date(aprovadoEm).toLocaleString('pt-BR')} · o <b>Aplicar no orçado</b> está liberado
                    </div>
                    {/* Fechar é carimbo, não cadeado — e quem lê "aprovado" tende a
                        achar que acabou. Dizer o que ainda dá para fazer evita o
                        chamado "como reabro?". */}
                    <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 3, lineHeight: 1.6 }}>
                      Não congela nada: qualquer alteração numa decisão ou num veredito derruba este
                      carimbo sozinho, e a discussão reabre. Para congelar de vez, bloqueie a versão
                      em Cadastros → Versões.
                    </div>
                    {aprovacaoNota && <div style={{ fontSize: 11.5, color: 'var(--muted)', fontStyle: 'italic', marginTop: 3 }}>“{aprovacaoNota}”</div>}
                  </div>
                  {podeAprovar && (
                    <button style={S.btn} disabled={salvando} onClick={() => decidir(false)}>
                      <RotateCcw size={13} /> Revogar
                    </button>
                  )}
                </div>
              ) : podeAprovar ? (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>Fechar este cenário</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.65, marginBottom: 10, maxWidth: '76ch' }}>
                    A aprovação libera o <b>Aplicar no orçado</b> desta versão. ⚠ Ela cai sozinha se
                    qualquer decisão do cenário for alterada depois — o carimbo nunca fica valendo
                    para um conteúdo que mudou.
                  </div>
                  {/* ⚠ O carimbo exige unanimidade — é o que impede aprovar um
                      cenário que contém decisão recusada. O banco recusa também;
                      aqui o botão já diz por quê, em vez de deixar o erro falar. */}
                  {/* ⚠ A versão anterior dizia só "quem propôs precisa corrigir",
                      e o aprovador lia que estava bloqueado esperando alguém.
                      Ele pode resolver as duas: aprovar a pendente e mudar de
                      ideia na recusada — foi ele que recusou.
                      ⚠ E diz QUAIS, não só quantas: com o contador no rodapé e a
                      linha fora da tela, "1 recusada" vira caça ao tesouro, e quem
                      rolou até aqui acha que já decidiu tudo. */}
                  {vereditos?.pend > 0 && (
                    <div style={{ fontSize: 12, color: 'var(--orange)', marginBottom: 10, lineHeight: 1.65 }}>
                      Sem veredito: {linhas.filter((x: any) => x.aprovado === null).map((x: any, i: number, a: any[]) => (
                        <span key={x.id}><b>{x.nome}</b>{i < a.length - 1 ? ' · ' : ''}</span>
                      ))}
                      <div style={{ color: 'var(--muted)', marginTop: 3 }}>
                        Decida cada uma com <b style={{ color: 'var(--green)' }}>✓</b> ou
                        {' '}<b style={{ color: 'var(--red)' }}>✗</b> na coluna Veredito. Recusar também é decidir —
                        o cenário fecha, e o posto recusado entra no orçado com o valor do <b>cadastro</b>.
                      </div>
                    </div>
                  )}
                  {vereditos?.pend === 0 && vereditos?.repr > 0 && (
                    <div style={{ fontSize: 12, color: 'var(--text-mid)', background: 'var(--bg-soft)',
                                  border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px',
                                  marginBottom: 10, lineHeight: 1.65 }}>
                      <b style={{ color: 'var(--red)' }}>{vereditos.repr} recusada(s)</b> — ao aprovar, esses postos
                      entram no orçado com o valor do <b>cadastro</b>, não com o do cenário. A proposta fica
                      registrada com o motivo da recusa.
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <input value={nota} onChange={e => setNota(e.target.value)}
                      placeholder="observação (opcional na aprovação, recomendada ao devolver)"
                      style={{ flex: 1, minWidth: 240, padding: '8px 11px', fontSize: 12.5, background: 'var(--bg-soft)',
                               color: 'var(--text)', border: '1px solid var(--border-strong)', borderRadius: 8 }} />
                    {/* Devolver o cenário inteiro, com recado — era o que faltava
                        para o ciclo fechar: antes só dava para aprovar. */}
                    <button disabled={salvando} onClick={() => decidir(false)}
                      style={{ ...S.btn, borderColor: 'var(--orange)', color: 'var(--orange)' }}
                      title="Registra a observação na versão sem aprovar. Use para devolver com um recado geral; o motivo de cada recusa vai na linha.">
                      <RotateCcw size={13} /> Devolver com observação
                    </button>
                    <button disabled={salvando || !vereditos?.ok} onClick={() => decidir(true)}
                      title={vereditos?.ok ? undefined : 'Aprove todas as linhas antes de carimbar o cenário.'}
                      style={{ ...S.btn, borderColor: vereditos?.ok ? 'var(--green)' : 'var(--border)',
                               color: vereditos?.ok ? 'var(--green)' : 'var(--muted)', fontWeight: 600,
                               opacity: vereditos?.ok ? 1 : 0.5, cursor: vereditos?.ok ? 'pointer' : 'not-allowed' }}>
                      <Check size={14} /> {salvando ? 'Aprovando…' : `Fechar cenário (${linhas.filter((x: any) => x.aprovado === true).length} de ${linhas.length})`}
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 12.5, color: 'var(--orange)' }}>
                  <b>Aguardando aprovação.</b> Você pode revisar e exportar, mas não aprovar —
                  o <b>Aplicar no orçado</b> fica bloqueado até alguém com essa permissão carimbar.
                </div>
              )}
            </div>

            <p style={{ marginTop: 18, fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.7 }}>
              O cenário decide salário, cargo, jornada, vigência e afastamento. Centro de custo,
              empresa, filial, regime, benefícios e rateio continuam sendo <b>fato</b> e moram no
              cadastro, que vem do ERP.
            </p>
          </>)}
        </div>
      </div>
    </div>
  )
}
