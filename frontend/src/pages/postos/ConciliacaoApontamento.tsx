import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { supabase } from '../../lib/supabase'
import { pageAll } from '../../lib/pageAll'
import { useLocalPref } from '../../lib/uiPrefs'
import { AlertCircle, ChevronDown, ChevronRight, FileDown, Search, X } from 'lucide-react'
import { usePassoLabel } from './PostosPills'

declare const XLSX: any

// Conciliação APONTAMENTO × FOLHA.
//
// A pergunta: as horas que o líder aprovou viraram custo na empresa e no centro
// de custo DAQUELE projeto? Quem responde hoje não tem como saber — o razão
// chega consolidado e a folha calcula sozinha.
//
// Três decisões que explicam o formato da tela:
//
// 1. CONFERE EM HORAS, nunca em valor. O extrato traz CUSTO_HORA (o custo
//    congelado do apontamento) e a folha usa o valor-hora do CADASTRO
//    (RetValHr): são duas taxas para a mesma hora, por desenho. Medido, comparar
//    valor deixava ~353 mil sem explicação; em horas a diferença some.
//
// 2. A COMPETÊNCIA É A DA FOLHA. O apontamento vem pela comp_folha gravada na
//    importação, que já embute a defasagem por tipo de contrato (PJ 1 mês, CLT
//    2). A tela não sabe da defasagem, e é por isso que ela não quebra quando um
//    regime novo tiver outra.
//
// 3. O ACHADO PRINCIPAL NÃO É "FALTOU HORA", É "FOI PARA O CC ERRADO". Daí o
//    status DESLOCADO: a pessoa recebeu todas as horas, mas num centro de custo
//    diferente do que ela apontou. O total fecha e mesmo assim o rateio da DRE
//    está errado — é o caso que nenhuma conferência por total pega.

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

// Verbas que o integrador gera a partir do apontamento (OEFOLM02.PRW):
// MV_XVBHRNO = hora normal, MV_XVBHRTR = traslado. As demais verbas de hora da
// folha vêm do cadastro, não do apontamento, e não entram nesta conta.
const VERBAS_HORA = ['222', '223']

export type ApontParams = {
  ano: number
  mes: number                      // competência da FOLHA
  empresaSel: string[]             // [] = todas as permitidas
  filialFilter: string[] | null    // null = sem filtro
  ccFilter: string[] | null
}

type Status = 'OK' | 'DESLOCADO' | 'DIVERGE' | 'SEM_FOLHA' | 'SEM_APONT' | 'NAO_HORA'
type LinhaCc = { ccId: string | null; empCod: string; filCod: string; ccCod: string; ccRec: string; hAp: number; hFo: number; delta: number; ok: boolean }
type Pessoa = {
  key: string; postoId: string | null; matricula: string; nome: string; local: string; regime: string
  funcao: string
  recebeHora: boolean        // o valor EFETIVO, já com a precedência resolvida
  funcaoRecebe: boolean      // o padrão da função, para onde desfazer a exceção volta
  porFuncao: boolean         // true = herdado da função; false = exceção gravada no posto
  hAp: number; hFo: number; delta: number; status: Status; ccs: LinhaCc[]
}
type Fora = { tipo: string; rotulo: string; linhas: number; horas: number }

const hrs = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
// busca por nome tem de achar "JOAO" digitando "joão" e vice-versa — quem
// procura uma pessoa não sabe como o ERP gravou o acento dela
const norm = (s: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const S: Record<string, CSSProperties> = {
  kpis:  { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, margin: '0 0 16px' },
  kpi:   { background: 'linear-gradient(180deg, var(--panel), var(--bg-soft))', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' },
  kpiL:  { fontSize: 10.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 },
  kpiV:  { fontSize: 24, fontWeight: 700, color: 'var(--text)', margin: '4px 0 2px' },
  kpiS:  { fontSize: 11, color: 'var(--faint)' },
  card:  { background: 'var(--panel)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden', marginBottom: 16 },
  head:  { display: 'flex', alignItems: 'baseline', gap: 10, padding: '12px 14px', flexWrap: 'wrap' },
  h2:    { fontSize: 14, fontWeight: 700, color: 'var(--text)', margin: 0 },
  hsub:  { fontSize: 11.5, color: 'var(--muted)', flex: 1, minWidth: 200, lineHeight: 1.5 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th:    { textAlign: 'left', padding: '8px 12px', color: 'var(--muted)', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' },
  td:    { padding: '6px 12px', borderBottom: '1px solid var(--panel-2)', color: 'var(--text)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
  gh:    { padding: '7px 12px', background: 'var(--bg)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', cursor: 'pointer', fontSize: 12.5, color: 'var(--text)', fontWeight: 600, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
  dh:    { textAlign: 'left', padding: '4px 8px', fontSize: 10.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.3, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' },
  dt:    { padding: '3px 8px', borderBottom: '1px solid var(--panel-2)', color: 'var(--text)', fontVariantNumeric: 'tabular-nums' },
  erro:  { display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.35)', borderRadius: 8, padding: '10px 14px', color: 'var(--red)', fontSize: 13, margin: '0 0 16px' },
  aviso: { display: 'flex', alignItems: 'flex-start', gap: 8, background: 'rgba(251,146,60,0.10)', border: '1px solid rgba(251,146,60,0.35)', borderRadius: 8, padding: '10px 14px', color: 'var(--orange)', fontSize: 12.5, margin: '0 0 16px', lineHeight: 1.6 },
  empty: { padding: '30px 24px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 },
  fld:   { display: 'flex', flexDirection: 'column', gap: 4 },
  lbl:   { fontSize: 10.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 },
  inp:   { padding: '7px 10px', fontSize: 13, border: '1px solid var(--border-strong)', borderRadius: 8, background: 'var(--panel)', color: 'var(--text)', width: 90 },
  btn:   { padding: '7px 12px', fontSize: 13, border: '1px solid var(--border-strong)', borderRadius: 8, background: 'var(--panel)', color: 'var(--text)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600 },
  mono:  { fontFamily: 'monospace', color: 'var(--muted)' },
  prova: { display: 'flex', gap: 18, flexWrap: 'wrap', padding: '10px 14px', fontSize: 12, color: 'var(--text-mid)', background: 'var(--bg)', borderTop: '1px solid var(--border)', fontVariantNumeric: 'tabular-nums' },
}

const chip = (cor: string, fundo: string): CSSProperties => ({ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 8px', borderRadius: 99, fontSize: 10, fontWeight: 700, color: cor, background: fundo, whiteSpace: 'nowrap' })
const ST: Record<Status, { txt: string; est: CSSProperties; ajuda: string }> = {
  OK:        { txt: 'confere',    est: chip('var(--green)',  'rgba(52,211,153,0.14)'), ajuda: 'as horas apontadas viraram folha, no mesmo centro de custo' },
  DESLOCADO: { txt: 'outro CC',   est: chip('var(--orange)', 'rgba(251,146,60,0.14)'), ajuda: 'recebeu todas as horas, mas em centro de custo diferente do apontado — o total fecha e o rateio da DRE fica errado' },
  DIVERGE:   { txt: 'diverge',    est: chip('var(--red)',    'rgba(248,113,113,0.14)'), ajuda: 'a quantidade de horas não bate' },
  SEM_FOLHA: { txt: 'sem folha',  est: chip('var(--red)',    'rgba(248,113,113,0.14)'), ajuda: 'apontou horas aprovadas e a folha não pagou nenhuma' },
  SEM_APONT: { txt: 'sem apont.', est: chip('var(--blue)',   'rgba(59,130,246,0.14)'), ajuda: 'a folha pagou hora que não tem apontamento nesta competência' },
  NAO_HORA:  { txt: 'não por hora', est: chip('var(--muted)', 'rgba(148,163,184,0.14)'), ajuda: 'aponta horas mas recebe salário — o integrador do ERP não gera verba de hora para quem não tem roteiro AUT' },
}
const ORDEM: Status[] = ['DIVERGE', 'SEM_FOLHA', 'DESLOCADO', 'SEM_APONT', 'OK', 'NAO_HORA']

export function ConciliacaoApontamento({ params: p }: { params: ApontParams }) {
  const passoLabel = usePassoLabel()
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [pessoas, setPessoas] = useState<Pessoa[]>([])
  const [fora, setFora] = useState<Fora[]>([])
  const [totApont, setTotApont] = useState(0)      // horas do apontamento desta competência, TUDO
  const [totFolha, setTotFolha] = useState(0)      // horas 222/223 da folha, TUDO
  const [aberto, setAberto] = useState<Set<string>>(new Set())
  const [recolhidos, setRecolhidos] = useLocalPref<string[]>('planorc_apont_recolhidos', [])
  // busca por pessoa: não fica no localStorage — é uma pergunta do momento,
  // e uma busca lembrada de ontem esconderia a tela inteira sem explicar por quê
  const [busca, setBusca] = useState('')
  const alvo = norm(busca.trim())
  // procurando alguém, o quadro recolhido esconderia justamente quem se procura
  const recolhido = (k: string) => !alvo && recolhidos.includes(k)
  const alternarQuadro = (k: string) => setRecolhidos(r => r.includes(k) ? r.filter(x => x !== k) : [...r, k])
  // tolerância em HORAS — outra grandeza, outro número: a do tenant é em reais.
  // Meia hora cobre arredondamento de fração sem esconder meio expediente.
  const [tolH, setTolH] = useLocalPref('planorc_apont_tol_h', 0.5)
  const [soDif, setSoDif] = useLocalPref('planorc_apont_so_dif', true)

  const alternar = (k: string) => setAberto(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })

  useEffect(() => {
    let vivo = true
    ;(async () => {
      setLoading(true); setErro(null)
      try {
        const [postos, ccs, filiais, empresas, funcoes] = await Promise.all([
          pageAll(() => supabase.from('posto').select('id,matricula,filial_id,regime,nome,recebe_hora')),
          supabase.from('centro_custo').select('id,codigo,descricao'),
          supabase.from('filial').select('id,codigo,empresa_id'),
          supabase.from('empresa').select('id,codigo'),
          supabase.from('apontamento_funcao').select('funcao,recebe_hora'),
        ])
        if (!vivo) return

        // ── o filtro de empresa vira filtro de FILIAL, nos dois lados ──
        // A empresa gravada no apontamento é a do PROJETO; a da folha é a
        // gerencial da filial. Filtrar cada lado pela sua daria recortes
        // diferentes na mesma tela — a folha traria a pessoa e o apontamento
        // não, e a diferença seria do filtro, não do dado. Traduzir para filial
        // resolve: a filial é a mesma coisa nos dois.
        const filDaEmp = (p.empresaSel.length
          ? (filiais.data || []).filter((f: any) => p.empresaSel.includes(f.empresa_id)).map((f: any) => f.id)
          : null) as string[] | null
        const filAlvo = filDaEmp && p.filialFilter ? filDaEmp.filter(x => p.filialFilter!.includes(x))
          : filDaEmp ?? p.filialFilter
        const esc = (q: any, colFil: string, colCc: string) => {
          if (filAlvo) q = q.in(colFil, filAlvo)
          if (p.ccFilter) q = q.in(colCc, p.ccFilter)
          return q
        }

        const [ap, fo] = await Promise.all([
          // o apontamento vem pela competência-ALVO, não pela sua própria:
          // é comp_folha que carrega a defasagem por tipo de contrato
          pageAll(() => esc(supabase.from('fat_apontamento')
            .select('posto_id,matricula,nome,recurso_cod,filial_id,cc_projeto_id,cc_recurso_id,horas,horas_rv,intercambio,funcao,ano,mes')
            .eq('comp_folha_ano', p.ano).eq('comp_folha_mes', p.mes),
            'filial_id', 'cc_projeto_id')),
          // tipo = REALIZADO: fat_folha guarda também o orçado do motor de
          // postos, e sem este filtro a folha apareceria com o dobro das horas
          pageAll(() => esc(supabase.from('fat_folha')
            .select('posto_id,matricula,nome,empresa_id,filial_id,cc_id,verba_cod,horas,valor')
            .eq('tipo', 'REALIZADO').eq('ano', p.ano).eq('mes', p.mes).in('verba_cod', VERBAS_HORA),
            'filial_id', 'cc_id')),
        ])
        if (!vivo) return

        const ccCod = new Map((ccs.data || []).map((c: any) => [c.id, c.codigo as string]))
        const filCod = new Map((filiais.data || []).map((f: any) => [f.id, f.codigo as string]))
        const empCod = new Map((empresas.data || []).map((e: any) => [e.id, e.codigo as string]))

        // ── empresa: derivada da FILIAL, igual dos dois lados ──
        // O apontamento grava a empresa do PROJETO e a filial do POSTO — usar as
        // duas juntas daria um par incoerente ("empresa do cliente, filial da
        // pessoa"). Aqui a empresa sai sempre da filial, pelo de-para que a folha
        // usa de fato; a FK do cadastro entra só onde a folha não tem exemplo.
        const empDaFilial = new Map<string, string>()
        for (const r of fo as any[]) if (r.filial_id && r.empresa_id && !empDaFilial.has(r.filial_id)) empDaFilial.set(r.filial_id, r.empresa_id)
        for (const f of (filiais.data || []) as any[]) if (f.empresa_id && !empDaFilial.has(f.id)) empDaFilial.set(f.id, f.empresa_id)

        const regimeDe = new Map<string, string>()      // por posto
        const regimeFm = new Map<string, string>()      // por filial+matrícula, p/ folha sem posto casado
        // Quem recebe por hora sai da FUNÇÃO; o posto só entra como exceção.
        //   posto.recebe_hora > apontamento_funcao.recebe_hora > true
        // Função sem cadastro e posto NULL caem em "entra": esconder por
        // omissão seria pior do que acusar de mais.
        const horaFuncao = new Map<string, boolean>()
        for (const f of (funcoes.data || []) as any[]) horaFuncao.set(f.funcao, f.recebe_hora !== false)
        const horaDe = new Map<string, boolean | null>()
        const horaFm = new Map<string, boolean | null>()
        for (const q of postos as any[]) {
          const fm = `${q.filial_id}|${(q.matricula || '').trim()}`
          regimeDe.set(q.id, q.regime || ''); regimeFm.set(fm, q.regime || '')
          horaDe.set(q.id, q.recebe_hora ?? null); horaFm.set(fm, q.recebe_hora ?? null)
        }

        // ── o que fica FORA da conferência, e por quê ──
        // Some do quadro principal mas não do total: a prova de soma no rodapé
        // só fecha porque cada hora está em exatamente um lugar.
        const f: Record<string, Fora> = {}
        const põeFora = (tipo: string, rotulo: string, h: number) => {
          const k = tipo
          const g = f[k] || (f[k] = { tipo, rotulo, linhas: 0, horas: 0 })
          g.linhas++; g.horas += h
        }

        type Ag = { emp: string; fil: string; cc: string; hAp: number; hFo: number; ccRec: Set<string> }
        // pessoa -> (empresa·filial·CC) -> horas. O detalhe é o MESMO grão do
        // razão: lá a divergência aparece como "caiu na filial errada" tanto
        // quanto "caiu no CC errado", e com só o CC aqui o primeiro caso ficaria
        // invisível — as duas pontas somariam certo em lugares diferentes.
        const grade = new Map<string, Map<string, Ag>>()
        const infoP = new Map<string, { postoId: string | null; matricula: string; nome: string; regime: string; funcao: string; recebeHora: boolean; funcaoRecebe: boolean; porFuncao: boolean }>()
        const cel = (pk: string, emp: string, fil: string, cc: string) => {
          let m = grade.get(pk); if (!m) { m = new Map(); grade.set(pk, m) }
          const ck = `${emp}|${fil}|${cc}`
          let c = m.get(ck); if (!c) { c = { emp, fil, cc, hAp: 0, hFo: 0, ccRec: new Set() }; m.set(ck, c) }
          return c
        }
        // a PESSOA é o posto, não o par filial+matrícula: quem foi pago numa
        // filial diferente da do posto viraria duas pessoas — uma sem folha e
        // outra sem apontamento — e a divergência real ficaria escondida atrás
        // de dois falsos positivos.
        const chaveP = (postoId: string | null, filial: string | null, mat: string) =>
          postoId || `fm:${filial}|${mat}`

        let tAp = 0, tFo = 0
        for (const r of ap as any[]) {
          const h = (Number(r.horas) || 0) + (Number(r.horas_rv) || 0)
          tAp += h
          if (!r.posto_id || !r.matricula) { põeFora('sem_posto', 'Recurso sem posto — não passa pela nossa folha, ou falta o código do recurso no cadastro', h); continue }
          if (r.intercambio) { põeFora('intercambio', 'Intercâmbio (projeto 9999999999) — hora apontada que não é de projeto de cliente', h); continue }
          const pk = chaveP(r.posto_id, r.filial_id, (r.matricula || '').trim())
          const c = cel(pk, empDaFilial.get(r.filial_id) || '', r.filial_id || '', r.cc_projeto_id || '')
          c.hAp += h
          if (r.cc_recurso_id && r.cc_recurso_id !== r.cc_projeto_id) c.ccRec.add(ccCod.get(r.cc_recurso_id) || '')
          const fm = `${r.filial_id}|${(r.matricula || '').trim()}`
          if (!infoP.has(pk)) {
            const exc = horaDe.has(r.posto_id) ? horaDe.get(r.posto_id)! : (horaFm.get(fm) ?? null)
            const pad = r.funcao ? horaFuncao.get(r.funcao) ?? true : true
            infoP.set(pk, {
              postoId: r.posto_id, matricula: (r.matricula || '').trim(), nome: r.nome || '',
              regime: regimeDe.get(r.posto_id) || regimeFm.get(fm) || '',
              funcao: r.funcao || '',
              recebeHora: exc ?? pad, funcaoRecebe: pad, porFuncao: exc === null,
            })
          }
        }
        for (const r of fo as any[]) {
          const h = Number(r.horas) || 0
          tFo += h
          const mat = (r.matricula || '').trim()
          const pk = chaveP(r.posto_id, r.filial_id, mat)
          const c = cel(pk, empDaFilial.get(r.filial_id) || r.empresa_id || '', r.filial_id || '', r.cc_id || '')
          c.hFo += h
          const fm = `${r.filial_id}|${mat}`
          // quem só aparece na folha não tem função (ela vem do apontamento):
          // entra na conferência, e é justamente o "pagou hora sem apontamento"
          if (!infoP.has(pk)) {
            const exc = horaDe.has(r.posto_id) ? horaDe.get(r.posto_id)! : (horaFm.get(fm) ?? null)
            infoP.set(pk, {
              postoId: r.posto_id, matricula: mat, nome: r.nome || '',
              regime: regimeDe.get(r.posto_id) || regimeFm.get(fm) || '',
              funcao: '', recebeHora: exc ?? true, funcaoRecebe: true, porFuncao: exc === null,
            })
          }
        }

        const out: Pessoa[] = []
        for (const [pk, m] of grade) {
          const i = infoP.get(pk)!
          const ccs_: LinhaCc[] = [...m.values()].map(c => ({
            ccId: c.cc || null,
            empCod: c.emp ? (empCod.get(c.emp) || '—') : '—',
            filCod: c.fil ? (filCod.get(c.fil) || '—') : '—',
            ccCod: c.cc ? (ccCod.get(c.cc) || c.cc.slice(0, 8)) : '(sem CC)',
            ccRec: [...c.ccRec].filter(Boolean).join(', '),
            hAp: c.hAp, hFo: c.hFo, delta: c.hAp - c.hFo, ok: Math.abs(c.hAp - c.hFo) <= tolH,
          })).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)
            || a.empCod.localeCompare(b.empCod) || a.filCod.localeCompare(b.filCod) || a.ccCod.localeCompare(b.ccCod))
          const hAp = ccs_.reduce((s, c) => s + c.hAp, 0)
          const hFo = ccs_.reduce((s, c) => s + c.hFo, 0)
          const delta = hAp - hFo
          // a ordem dos testes é a leitura: primeiro quem nem devia estar aqui,
          // depois se existe dos dois lados, se o total fecha, e só então se foi
          // para o lugar certo
          const status: Status =
            !i.recebeHora ? 'NAO_HORA'
            : hFo === 0 ? 'SEM_FOLHA'
            : hAp === 0 ? 'SEM_APONT'
            : Math.abs(delta) > tolH ? 'DIVERGE'
            : ccs_.some(c => !c.ok) ? 'DESLOCADO'
            : 'OK'
          // o cabeçalho da pessoa mostra empresa · filial quando é uma só, e
          // "vários" quando não é — nesse caso o número que importa está no
          // detalhe, e um rótulo único ali seria mentira
          const pares = [...new Set(ccs_.map(c => `${c.empCod} · ${c.filCod}`))]
          const local = pares.length === 1 ? pares[0] : `${pares.length} locais`
          out.push({ key: pk, ...i, local, hAp, hFo, delta, status, ccs: ccs_ })
        }
        out.sort((a, b) => ORDEM.indexOf(a.status) - ORDEM.indexOf(b.status)
          || Math.abs(b.delta) - Math.abs(a.delta) || a.nome.localeCompare(b.nome))

        setPessoas(out)
        setFora(Object.values(f).sort((a, b) => b.horas - a.horas))
        setTotApont(tAp); setTotFolha(tFo)
      } catch (e: any) {
        if (vivo) setErro((e?.message || String(e)) + (String(e?.message).includes('fat_apontamento') ? ' — rode a migration schema_v3_112_fat_apontamento.sql.' : ''))
      } finally { if (vivo) setLoading(false) }
    })()
    return () => { vivo = false }
  }, [p.ano, p.mes, JSON.stringify(p.empresaSel), JSON.stringify(p.filialFilter), JSON.stringify(p.ccFilter), tolH])

  // PJ e CLT respondem à mesma pergunta com naturezas diferentes: o terceiro é
  // pago POR hora, o CLT tem salário e aponta para saber onde o custo dele cai.
  // Separados, um não esconde o outro — e se um dia o CLT passar a gerar verba
  // de hora, o quadro dele deixa de estar vazio sozinho.
  const grupos = useMemo(() => {
    const naoHora = pessoas.filter(x => x.status === 'NAO_HORA')
    const resto = pessoas.filter(x => x.status !== 'NAO_HORA')
    const clt = resto.filter(x => x.regime.toUpperCase().includes('CLT'))
    const pj = resto.filter(x => !x.regime.toUpperCase().includes('CLT'))
    return { pj, clt, naoHora }
  }, [pessoas])

  // EXCEÇÃO por pessoa. O normal é marcar a função inteira, na tela de
  // importação — aqui é para quem foge do padrão da própria função. Gravar null
  // desfaz a exceção e devolve a pessoa ao que a função dela diz.
  const [salvando, setSalvando] = useState<string | null>(null)
  const marcarHora = async (g: Pessoa, recebe: boolean | null) => {
    if (!g.postoId) return
    setSalvando(g.key)
    const { error } = await supabase.from('posto').update({ recebe_hora: recebe }).eq('id', g.postoId)
    setSalvando(null)
    if (error) { setErro('Não consegui gravar: ' + error.message); return }
    setPessoas(ps => ps.map(x => {
      if (x.key !== g.key) return x
      const ef = recebe ?? x.funcaoRecebe
      return {
        ...x, recebeHora: ef, porFuncao: recebe === null,
        status: !ef ? 'NAO_HORA'
          : x.hFo === 0 ? 'SEM_FOLHA' : x.hAp === 0 ? 'SEM_APONT'
          : Math.abs(x.delta) > tolH ? 'DIVERGE' : x.ccs.some(c => !c.ok) ? 'DESLOCADO' : 'OK',
      }
    }))
  }

  const resumo = useMemo(() => {
    const c = (l: Pessoa[]) => ({
      n: l.length, hAp: l.reduce((s, x) => s + x.hAp, 0), hFo: l.reduce((s, x) => s + x.hFo, 0),
      dif: l.filter(x => x.status !== 'OK').length,
    })
    return { pj: c(grupos.pj), clt: c(grupos.clt), nh: c(grupos.naoHora), foraH: fora.reduce((s, x) => s + x.horas, 0) }
  }, [grupos, fora])

  const exportarXlsx = () => {
    const wb = XLSX.utils.book_new()
    const add = (nome: string, linhas: any[][]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(linhas), nome)
    const comp = `${MESES[p.mes - 1]}/${p.ano}`
    const escopoTxt = (v: string[] | null) => v === null || !v.length ? 'todas' : `${v.length} selecionada(s)`
    add('Resumo', [
      ['Conciliação Apontamento × Folha'],
      ['Competência da folha', comp],
      ['Verbas de hora consideradas', VERBAS_HORA.join(', ')],
      ['Tolerância (horas)', tolH],
      ['Empresas', escopoTxt(p.empresaSel)], ['Filiais', escopoTxt(p.filialFilter)], ['Centros de custo', escopoTxt(p.ccFilter)],
      [],
      ['', 'Pessoas', 'Horas apontadas', 'Horas na folha', 'Diferença', 'Com pendência'],
      ['Terceiros (PJ) — conferência', resumo.pj.n, resumo.pj.hAp, resumo.pj.hFo, resumo.pj.hAp - resumo.pj.hFo, resumo.pj.dif],
      ['CLT — distribuição (sem verba de hora a comparar)', resumo.clt.n, resumo.clt.hAp, '', '', ''],
      ['Não recebem por hora', resumo.nh.n, resumo.nh.hAp, resumo.nh.hFo, '', ''],
      ['Outras horas fora da conferência', '', resumo.foraH, '', '', ''],
      [],
      ['Prova de soma — horas do apontamento', totApont],
      ['  conferidas (PJ)', conferidas],
      ['  CLT (distribuição)', resumo.clt.hAp],
      ['  não recebem por hora', resumo.nh.hAp],
      ['  fora da conferência', resumo.foraH],
      ['  sobra (deve ser zero)', sobra],
      ['Prova de soma — horas da folha (222/223)', totFolha],
      [],
      ['Exportado em', new Date().toLocaleString('pt-BR')],
      ['Obs.', 'A conferência é em HORAS: o apontamento usa o custo/hora congelado e a folha o valor-hora do cadastro — comparar valor compara duas taxas para a mesma hora.'],
    ])
    const pes: any[][] = [['Regime', 'Função', 'Empresa · Filial', 'Matrícula', 'Nome', 'Horas apontadas', 'Horas na folha', 'Diferença', 'Situação', 'O que significa']]
    for (const g of [...grupos.pj, ...grupos.clt, ...grupos.naoHora])
      pes.push([g.regime || '—', g.funcao || '—', g.local, g.matricula, g.nome, g.hAp, g.hFo, g.delta, ST[g.status].txt, ST[g.status].ajuda])
    add('Pessoas', pes)
    // a proporção do CLT é o número que o rateio manual deveria usar — sai em
    // aba própria para poder ser colada na planilha que faz o rateio hoje
    const prop: any[][] = [['Matrícula', 'Nome', 'Empresa', 'Filial', 'CC do projeto', 'Horas', 'Proporção %']]
    for (const g of grupos.clt)
      for (const c of g.ccs)
        prop.push([g.matricula, g.nome, c.empCod, c.filCod, c.ccCod, c.hAp, g.hAp ? 100 * c.hAp / g.hAp : 0])
    add('CLT · proporção por CC', prop)
    // achatado: empresa, filial e CC em colunas próprias, para a planilha
    // dinâmica poder girar por qualquer uma delas
    const det: any[][] = [['Regime', 'Matrícula', 'Nome', 'Empresa', 'Filial', 'CC do projeto', 'CC do recurso', 'Horas apontadas', 'Horas na folha', 'Diferença', 'Fora da tolerância']]
    for (const g of [...grupos.pj, ...grupos.clt, ...grupos.naoHora])
      for (const c of g.ccs)
        det.push([g.regime || '—', g.matricula, g.nome, c.empCod, c.filCod, c.ccCod, c.ccRec, c.hAp, c.hFo, c.delta, c.ok ? '' : 'sim'])
    add('Empresa · filial · CC', det)
    add('Fora da conferência', [['Motivo', 'Linhas', 'Horas'], ...fora.map(x => [x.rotulo, x.linhas, x.horas])])
    XLSX.writeFile(wb, `conciliacao_apontamento_${p.ano}_${String(p.mes).padStart(2, '0')}.xlsx`)
  }

  if (loading) return <div style={S.empty}>Carregando…</div>
  if (erro) return <div style={S.erro}><AlertCircle size={16} /> {erro}</div>
  if (!pessoas.length && !fora.length) return (
    <div style={S.empty}>
      Nenhum apontamento para a folha de <b>{MESES[p.mes - 1]}/{p.ano}</b>. O extrato da competência correspondente
      ainda não foi importado — para a folha de um mês, o apontamento é o do mês anterior (PJ) ou de dois meses antes (CLT).
    </div>
  )

  // função, não componente: declarado aqui dentro, <Quadro/> seria um tipo novo
  // a cada render e o React remontaria a tabela inteira a cada tecla da busca
  const quadro = ({ k, titulo, sub, lista }: { k: string; titulo: string; sub: any; lista: Pessoa[] }) => {
    // a busca IGNORA "só pendências": procurar alguém pelo nome e não achar
    // porque ele está conferindo faria a tela parecer dizer que a pessoa não existe
    const vis = alvo
      ? lista.filter(x => norm(x.nome).includes(alvo) || norm(x.matricula).includes(alvo))
      : soDif ? lista.filter(x => x.status !== 'OK') : lista
    const t = { hAp: lista.reduce((s, x) => s + x.hAp, 0), hFo: lista.reduce((s, x) => s + x.hFo, 0) }
    return (
      <div style={S.card}>
        <div style={{ ...S.head, cursor: 'pointer', borderBottom: recolhido(k) ? 'none' : '1px solid var(--border)' }} onClick={() => alternarQuadro(k)}>
          {recolhido(k) ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
          <h2 style={S.h2}>{titulo}</h2>
          <span style={S.hsub}>{sub}</span>
          <span style={{ fontSize: 12, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
            {lista.length} pessoa(s) · {hrs(t.hAp)} h apontadas · {hrs(t.hFo)} h na folha
          </span>
        </div>
        {!recolhido(k) && (!lista.length
          ? <div style={S.empty}>Ninguém neste grupo nesta competência.</div>
          : <table style={S.table}>
            <thead><tr>
              <th style={S.th}>Pessoa</th>
              <th style={S.th}>Empresa · Filial</th>
              <th style={{ ...S.th, textAlign: 'right' }}>Apontado</th>
              <th style={{ ...S.th, textAlign: 'right' }}>Folha</th>
              <th style={{ ...S.th, textAlign: 'right' }}>Diferença</th>
              <th style={S.th}>Situação</th>
            </tr></thead>
            <tbody>
              {vis.map(g => {
                const ab = aberto.has(g.key)
                return [
                  <tr key={g.key}>
                    <td style={{ ...S.td, cursor: 'pointer' }} onClick={() => alternar(g.key)}>
                      {ab ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{' '}
                      <span style={S.mono}>{g.matricula}</span> {g.nome}
                      <span style={{ ...S.mono, fontSize: 11, marginLeft: 6 }}>{g.ccs.length} linha(s)</span>
                    </td>
                    <td style={{ ...S.td, ...S.mono }}>{g.local}</td>
                    <td style={{ ...S.td, textAlign: 'right' }}>{hrs(g.hAp)}</td>
                    <td style={{ ...S.td, textAlign: 'right' }}>{hrs(g.hFo)}</td>
                    <td style={{ ...S.td, textAlign: 'right', color: Math.abs(g.delta) > tolH ? 'var(--red)' : 'var(--muted)' }}>{hrs(g.delta)}</td>
                    <td style={S.td}>
                      <span style={ST[g.status].est} title={ST[g.status].ajuda}>{ST[g.status].txt}</span>
                      {/* atalho onde o erro aparece: "sem folha" é exatamente
                          a cara de quem não recebe por hora */}
                      {g.postoId && g.status === 'SEM_FOLHA' && <button
                        style={{ marginLeft: 8, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 11, color: 'var(--muted)', textDecoration: 'underline' }}
                        disabled={salvando === g.key} onClick={() => marcarHora(g, false)}
                        title="Gerente, coordenador e afins apontam horas e recebem salário. Marcar tira a pessoa da conferência em todas as competências.">
                        {salvando === g.key ? 'salvando…' : 'não recebe por hora'}
                      </button>}
                    </td>
                  </tr>,
                  ab && <tr key={g.key + ':d'}>
                    <td colSpan={6} style={{ padding: '2px 12px 10px 34px', background: 'var(--bg-soft)' }}>
                      <table style={{ ...S.table, fontSize: 12 }}>
                        <thead><tr>
                          <th style={S.dh}>Empresa · Filial · CC</th>
                          <th style={S.dh}>CC do recurso</th>
                          <th style={{ ...S.dh, textAlign: 'right' }}>Apontado</th>
                          <th style={{ ...S.dh, textAlign: 'right' }}>Folha</th>
                          <th style={{ ...S.dh, textAlign: 'right' }}>Diferença</th>
                        </tr></thead>
                        <tbody>
                          {g.ccs.map((c, i) => (
                            <tr key={i}>
                              <td style={{ ...S.dt, ...S.mono, color: c.ok ? 'var(--text-mid)' : 'var(--text)' }}>
                                {c.empCod} · {c.filCod} · {c.ccCod}</td>
                              <td style={{ ...S.dt, ...S.mono, fontSize: 11 }} title="o CC de lotação da pessoa, quando é diferente do CC do projeto — explica boa parte dos deslocamentos">{c.ccRec || ''}</td>
                              <td style={{ ...S.dt, textAlign: 'right' }}>{hrs(c.hAp)}</td>
                              <td style={{ ...S.dt, textAlign: 'right' }}>{hrs(c.hFo)}</td>
                              <td style={{ ...S.dt, textAlign: 'right', color: c.ok ? 'var(--muted)' : 'var(--red)' }}>{hrs(c.delta)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>,
                ]
              })}
              {!vis.length && <tr><td colSpan={6} style={S.empty}>
                {alvo
                  ? <>Ninguém com <b>{busca}</b> neste quadro — as {lista.length} pessoa(s) daqui não casam com a busca.</>
                  : <>Todas as {lista.length} pessoa(s) conferem. Desmarque <b>só pendências</b> para ver a lista completa.</>}
              </td></tr>}
            </tbody>
          </table>)}
      </div>
    )
  }

  // só o PJ é conferido: o CLT não tem verba de hora para comparar, e somá-lo
  // aqui faria a diferença parecer enorme todo mês por construção
  const conferidas = resumo.pj.hAp
  const sobra = totApont - conferidas - resumo.clt.hAp - resumo.nh.hAp - resumo.foraH
  const achados = alvo ? pessoas.filter(x => norm(x.nome).includes(alvo) || norm(x.matricula).includes(alvo)).length : 0

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', margin: '0 0 16px' }}>
        <div style={S.fld}><span style={S.lbl}>Pessoa</span>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Search size={13} style={{ position: 'absolute', left: 9, color: 'var(--muted)', pointerEvents: 'none' }} />
            <input style={{ ...S.inp, width: 220, paddingLeft: 27, paddingRight: alvo ? 26 : 10 }}
              placeholder="nome ou matrícula" value={busca} onChange={e => setBusca(e.target.value)}
              title="Procura nos dois quadros e ignora o filtro de pendências — quem procura uma pessoa quer achá-la mesmo que ela esteja conferindo." />
            {!!busca && <button onClick={() => setBusca('')} title="limpar"
              style={{ position: 'absolute', right: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', display: 'flex', padding: 2 }}>
              <X size={13} /></button>}
          </div>
        </div>
        <div style={S.fld}><span style={S.lbl}>Tolerância (horas)</span>
          <input style={S.inp} type="number" step="0.5" min="0" value={tolH}
            title="Abaixo disto a linha conta como conferida. Fração de hora e arredondamento não são divergência."
            onChange={e => setTolH(Math.max(0, parseFloat(e.target.value) || 0))} />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: alvo ? 'var(--faint)' : 'var(--text-mid)', cursor: alvo ? 'default' : 'pointer', paddingBottom: 8 }}
          title={alvo ? 'suspenso enquanto há busca por pessoa' : ''}>
          <input type="checkbox" checked={soDif} disabled={!!alvo} onChange={e => setSoDif(e.target.checked)} /> só pendências
        </label>
        {!!alvo && <span style={{ fontSize: 12, color: 'var(--violet)', paddingBottom: 8 }}>
          {achados} pessoa(s) encontrada(s){soDif ? ' · filtro de pendências suspenso' : ''}
        </span>}
        <div style={{ flex: 1 }} />
        <button style={{ ...S.btn, color: 'var(--violet)', marginBottom: 1 }} onClick={exportarXlsx}><FileDown size={14} /> Exportar</button>
      </div>

      <div style={S.kpis}>
        <div style={S.kpi}><div style={S.kpiL}>Horas apontadas</div><div style={S.kpiV}>{hrs(conferidas)}</div>
          <div style={S.kpiS}>conferíveis (PJ) · {hrs(resumo.clt.hAp + resumo.nh.hAp + resumo.foraH)} h fora</div></div>
        <div style={S.kpi}><div style={S.kpiL}>Horas na folha</div><div style={S.kpiV}>{hrs(resumo.pj.hFo)}</div>
          <div style={S.kpiS}>verbas {VERBAS_HORA.join(' + ')}
            {Math.abs(totFolha - resumo.pj.hFo) > 0.05 && ` · ${hrs(totFolha - resumo.pj.hFo)} h de quem está fora da conferência`}</div></div>
        <div style={S.kpi}><div style={S.kpiL}>Diferença</div>
          <div style={{ ...S.kpiV, color: Math.abs(conferidas - resumo.pj.hFo) > tolH ? 'var(--orange)' : 'var(--green)' }}>{hrs(conferidas - resumo.pj.hFo)}</div>
          <div style={S.kpiS}>apontado − folha</div></div>
        <div style={S.kpi}><div style={S.kpiL}>Pessoas com pendência</div>
          <div style={S.kpiV}>{resumo.pj.dif}</div>
          <div style={S.kpiS}>de {resumo.pj.n} conferidas</div></div>
      </div>

      {!grupos.naoHora.length && <div style={S.aviso}><AlertCircle size={16} />
        <span>Nenhuma <b>função</b> está marcada como "só aponta". Gerente de projeto, coordenador e afins apontam
          horas e recebem salário — sem marcá-los aparecem aqui como <b>sem folha</b> todo mês, sem que haja nada a
          corrigir. Marque a função em <b>{passoLabel('/postos/apontamento')}</b>: são poucas linhas, valem para
          todas as competências, e quem entrar depois já vem classificado.</span></div>}


      {quadro({ k: 'pj', titulo: 'Terceiros (PJ)', lista: grupos.pj,
        sub: <>Pagos <b>por hora</b>: o apontamento é o que gera a verba da folha, então aqui os dois lados têm de bater.
          Abra a pessoa para ver por centro de custo — é lá que aparece o caso em que o total fecha e o custo foi para o CC errado.</> })}

      {!!grupos.clt.length && <div style={S.card}>
        <div style={{ ...S.head, cursor: 'pointer', borderBottom: recolhido('clt') ? 'none' : '1px solid var(--border)' }} onClick={() => alternarQuadro('clt')}>
          {recolhido('clt') ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
          <h2 style={S.h2}>CLT · horas por centro de custo</h2>
          <span style={S.hsub}>Não é conferência, é <b>distribuição</b>. O CLT recebe fixo e o prêmio sai do
            apontamento, então não existe verba de hora para comparar — comparar contra ela acusaria divergência
            onde não há. O que estas horas dizem é a <b>proporção</b> em que o custo total da pessoa deveria ser
            rateado entre empresa, filial e CC. Hoje esse rateio é feito à mão depois da integração contábil, porque
            o ERP não faz; quando os valores entrarem dos dois lados, é aqui que a proporção esperada encontra o que
            foi de fato contabilizado.</span>
          <span style={{ fontSize: 12, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
            {grupos.clt.length} pessoa(s) · {hrs(resumo.clt.hAp)} h</span>
        </div>
        {!recolhido('clt') && <table style={S.table}>
          <thead><tr>
            <th style={S.th}>Pessoa</th><th style={S.th}>Empresa · Filial</th>
            <th style={{ ...S.th, textAlign: 'right' }}>Horas</th>
            <th style={{ ...S.th, textAlign: 'right' }}>Locais</th>
          </tr></thead>
          <tbody>
            {grupos.clt.filter(g => !alvo || norm(g.nome).includes(alvo) || norm(g.matricula).includes(alvo)).map(g => {
              const ab = aberto.has(g.key)
              return [
                <tr key={g.key}>
                  <td style={{ ...S.td, cursor: 'pointer' }} onClick={() => alternar(g.key)}>
                    {ab ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{' '}
                    <span style={S.mono}>{g.matricula}</span> {g.nome}
                  </td>
                  <td style={{ ...S.td, ...S.mono }}>{g.local}</td>
                  <td style={{ ...S.td, textAlign: 'right' }}>{hrs(g.hAp)}</td>
                  <td style={{ ...S.td, textAlign: 'right', color: 'var(--muted)' }}>{g.ccs.length}</td>
                </tr>,
                ab && <tr key={g.key + ':d'}>
                  <td colSpan={4} style={{ padding: '2px 12px 10px 34px', background: 'var(--bg-soft)' }}>
                    <table style={{ ...S.table, fontSize: 12 }}>
                      <thead><tr>
                        <th style={S.dh}>Empresa · Filial · CC</th>
                        <th style={{ ...S.dh, textAlign: 'right' }}>Horas</th>
                        {/* a proporção é o número que o rateio manual deveria usar */}
                        <th style={{ ...S.dh, textAlign: 'right' }}>Proporção</th>
                      </tr></thead>
                      <tbody>
                        {g.ccs.map((c, i) => (
                          <tr key={i}>
                            <td style={{ ...S.dt, ...S.mono }}>{c.empCod} · {c.filCod} · {c.ccCod}</td>
                            <td style={{ ...S.dt, textAlign: 'right' }}>{hrs(c.hAp)}</td>
                            <td style={{ ...S.dt, textAlign: 'right', fontWeight: 600 }}>
                              {g.hAp ? (100 * c.hAp / g.hAp).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '0,0'}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </td>
                </tr>,
              ]
            })}
          </tbody>
        </table>}
      </div>}

      {!!grupos.naoHora.length && <div style={S.card}>
        <div style={{ ...S.head, cursor: 'pointer', borderBottom: recolhido('nh') ? 'none' : '1px solid var(--border)' }} onClick={() => alternarQuadro('nh')}>
          {recolhido('nh') ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
          <h2 style={S.h2}>Não recebem por hora</h2>
          <span style={S.hsub}>Gerente de projeto, coordenador e afins: apontam horas para dizer <b>onde</b> o custo
            cai, e não são pagos por elas. Quem decide é a <b>função</b> — marque em {passoLabel('/postos/apontamento')};
            a marcação por pessoa aqui é só para quem foge do padrão da própria função.</span>
          <span style={{ fontSize: 12, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
            {grupos.naoHora.length} pessoa(s) · {hrs(grupos.naoHora.reduce((s, x) => s + x.hAp, 0))} h apontadas</span>
        </div>
        {!recolhido('nh') && <table style={S.table}>
          <thead><tr>
            <th style={S.th}>Pessoa</th><th style={S.th}>Empresa · Filial</th>
            <th style={S.th}>Por quê</th>
            <th style={{ ...S.th, textAlign: 'right' }}>Apontado</th>
            <th style={{ ...S.th, textAlign: 'right' }}>Folha</th>
            <th style={S.th} />
          </tr></thead>
          {/* também obedece à busca: procurar uma pessoa e não achá-la porque
              ela foi excluída da conferência daria a impressão de que sumiu */}
          <tbody>{grupos.naoHora.filter(g => !alvo || norm(g.nome).includes(alvo) || norm(g.matricula).includes(alvo)).map(g => (
            <tr key={g.key}>
              <td style={S.td}><span style={S.mono}>{g.matricula}</span> {g.nome}</td>
              <td style={{ ...S.td, ...S.mono }}>{g.local}</td>
              {/* herdado vs exceção: em itálico o que vem da função, como as
                  premissas globais do formulário já mostram herança */}
              <td style={{ ...S.td, fontSize: 11.5, color: 'var(--muted)', fontStyle: g.porFuncao ? 'italic' : 'normal' }}>
                {g.porFuncao ? (g.funcao || 'função') : 'exceção desta pessoa'}</td>
              <td style={{ ...S.td, textAlign: 'right', color: 'var(--muted)' }}>{hrs(g.hAp)}</td>
              <td style={{ ...S.td, textAlign: 'right', color: g.hFo ? 'var(--orange)' : 'var(--muted)' }}
                title={g.hFo ? 'recebeu verba de hora mesmo marcado como quem não recebe — confira a marcação ou o cadastro' : ''}>{hrs(g.hFo)}</td>
              <td style={{ ...S.td, textAlign: 'right' }}>
                {/* desfazer só faz sentido na exceção: se vem da função, voltar
                    à função devolveria a pessoa para cá no próximo render */}
                {!g.porFuncao && <button style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 11, color: 'var(--muted)', textDecoration: 'underline' }}
                  disabled={salvando === g.key} onClick={() => marcarHora(g, null)}
                  title="Desfaz a exceção e devolve a pessoa ao que a função dela diz">
                  {salvando === g.key ? 'salvando…' : 'seguir a função'}
                </button>}
              </td>
            </tr>
          ))}</tbody>
        </table>}
      </div>}

      {!!fora.length && <div style={S.card}>
        <div style={{ ...S.head, cursor: 'pointer', borderBottom: recolhido('fora') ? 'none' : '1px solid var(--border)' }} onClick={() => alternarQuadro('fora')}>
          {recolhido('fora') ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
          <h2 style={S.h2}>Fora da conferência</h2>
          <span style={S.hsub}>Horas que existem no extrato e não têm contraparte na folha <b>por desenho</b>, não por erro.
            Ficam aqui para a soma fechar — sem elas o total do apontamento nunca bateria com a soma dos quadros.</span>
          <span style={{ fontSize: 12, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>{hrs(resumo.foraH)} h</span>
        </div>
        {!recolhido('fora') && <table style={S.table}>
          <thead><tr><th style={S.th}>Motivo</th><th style={{ ...S.th, textAlign: 'right' }}>Linhas</th><th style={{ ...S.th, textAlign: 'right' }}>Horas</th></tr></thead>
          <tbody>{fora.map((x, i) => (
            <tr key={i}><td style={S.td}>{x.rotulo}</td>
              <td style={{ ...S.td, textAlign: 'right' }}>{x.linhas.toLocaleString('pt-BR')}</td>
              <td style={{ ...S.td, textAlign: 'right' }}>{hrs(x.horas)}</td></tr>
          ))}</tbody>
        </table>}
      </div>}

      {/* A prova de soma: cada hora do extrato está em exatamente um lugar.
          Se esta linha não fechar, o recorte da tela perdeu dado — e é melhor
          descobrir aqui do que numa reunião. */}
      <div style={{ ...S.card, marginBottom: 0 }}>
        <div style={S.prova}>
          <span>Apontamento da competência: <b>{hrs(totApont)} h</b></span>
          <span>= conferidas <b>{hrs(conferidas)} h</b></span>
          {!!resumo.clt.hAp && <span>+ CLT (distribuição) <b>{hrs(resumo.clt.hAp)} h</b></span>}
          {!!resumo.nh.hAp && <span>+ não recebem por hora <b>{hrs(resumo.nh.hAp)} h</b></span>}
          <span>+ fora da conferência <b>{hrs(resumo.foraH)} h</b></span>
          <span style={{ color: Math.abs(sobra) > 0.05 ? 'var(--red)' : 'var(--green)' }}>
            {Math.abs(sobra) > 0.05 ? `⚠ sobram ${hrs(sobra)} h sem lugar` : '✓ fecha'}
          </span>
        </div>
      </div>
    </>
  )
}
