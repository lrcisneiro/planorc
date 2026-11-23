// ============================================================
// A PONTE — de onde vem a variação, em cascata.
//
// Saiu de `OrcamentoDashPage` em 23/nov para o acompanhamento também poder
// montá-la. A extração só foi barata porque a Ponte já havia deixado de saber
// o que é orçado: ela recebe `origem`/`destino` e quem decide qual lado é qual
// é a PÁGINA — foi essa mudança (22/nov, o "sentido da leitura") que a tornou
// portátil sem reescrever nada.
//
// ⚠ `S` virou OPCIONAL, com um conjunto próprio de fallback. Um componente
// preso ao objeto de estilo de UMA tela não é montável em outra — e era isso,
// não a lógica, que o prendia ali. O `OrcamentoDashPage` continua passando o
// dele, então nada muda de aparência lá.
// ⚠ `Grupo`, `componentesDe`, `profDe` e as constantes vêm junto porque a
// Ponte os usa — e seguem exportados, porque a página também.
// ============================================================
import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { CornerDownRight, CornerLeftUp } from 'lucide-react'
import { emArvore, type LinhaRel } from './refRelatorio'

const fmt = (n: number, casas = 0) =>
  (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })
const fmtPct = (n: number) => (Number.isFinite(n) ? `${n >= 0 ? '+' : ''}${n.toFixed(1)}%` : '—')

export const S_PONTE: Record<string, CSSProperties> = {
  sec: { background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 14, padding: 20, marginBottom: 18 },
  secT: { fontSize: 15, fontWeight: 700, color: 'var(--text)' },
  secD: { fontSize: 12, color: 'var(--muted)', marginTop: 2 },
  secBarra: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '12px 0 16px' },
  th: { textAlign: 'right', padding: '6px 8px', fontSize: 11, textTransform: 'uppercase', letterSpacing: .4, color: 'var(--muted)', borderBottom: '1px solid var(--border)' },
  td: { textAlign: 'right', padding: '6px 8px', fontSize: 13, fontFamily: 'monospace', borderBottom: '1px solid var(--panel)' },
}

const vivas = (linhas: LinhaRel[]) => linhas.filter(x => !x.desativada)

export function componentesDe(l: LinhaRel | undefined, linhas: LinhaRel[]): string[] {
  if (!l) return []
  if ((l.tipo_linha === 'FORMULA' || l.tipo_linha === 'INDICADOR') && l.expressao) {
    const cods = new Set(Array.from(l.expressao.matchAll(/\[([^\]]+)\]/g), m => m[1]))
    return vivas(linhas).filter(x => cods.has(x.codigo)).map(x => x.id)
  }
  if (l.tipo_linha === 'SOMAR_FILHOS') return vivas(linhas).filter(x => x.pai_id === l.id).map(x => x.id)
  return []
}


export function Grupo({ opcoes, valor, onPick, rotulo }: {
  opcoes: readonly (readonly [any, string, string?])[]
  valor: any; onPick: (v: any) => void; rotulo?: string
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      {rotulo && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{rotulo}</span>}
      <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 7, overflow: 'hidden' }}>
        {opcoes.map(([k, rot, tit]) => (
          <button key={String(k)} onClick={() => onPick(k)} title={tit}
            style={{ padding: '5px 9px', fontSize: 11.5, border: 'none', cursor: 'pointer',
              fontWeight: valor === k ? 700 : 500,
              background: valor === k ? 'rgba(139,92,246,0.18)' : 'transparent',
              color: valor === k ? 'var(--violet)' : 'var(--muted)' }}>{rot}</button>
        ))}
      </div>
    </div>
  )
}

export const NATS = [['TODAS', 'Todas'], ['RECEITA', 'Receita'], ['DESPESA', 'Despesa']] as const
export const ABAS = [['LINHA', 'Linhas'], ['INDIC', 'Indicadores']] as const
export const NIVEIS = [[1, '1'], [2, '2'], [3, '3'],
                ['folhas', 'folhas', 'As linhas de lançamento — o grão mais fino']] as const

export function profDe(linhas: LinhaRel[]): (l: LinhaRel) => number {
  const byId: Record<string, LinhaRel> = Object.fromEntries(linhas.map(l => [l.id, l]))
  return (l: LinhaRel) => { let d = 1, p = l.pai_id; while (p && byId[p]) { d++; p = byId[p].pai_id } return d }
}

// ── 1 · A PONTE ─────────────────────────────────────────────
// O único gráfico que responde "de onde vem o crescimento" numa imagem.
// Sempre com a TABELA ao lado: cascata se lê por aproximação — a altura dá
// ordem de grandeza, não valor, e quem aprova precisa do número exato.
// ⚠⚠ A PONTE NÃO SABE O QUE É ORÇADO. Ela recebe `origem`/`destino` e desenha
// o caminho de um ao outro — quem decide qual lado é qual é a PÁGINA, porque a
// resposta depende da pergunta que a tela está fazendo. Foi o que permitiu o
// sentido virar um botão em vez de um `if` espalhado pelo componente.
export function Ponte({ S: Sx, cfg, setCfg, linhas, nome, origem, destino, rotOrigem, rotDestino,
                 trilha, setTrilha, navRef, nat, setNat, ate, setAte }: any) {
  const S = Sx || S_PONTE
  // ⚠ SINAL ECONÔMICO, não o de exibição. O resto da tela mostra despesa
  // positiva (fatorExibicao inverte), mas numa ponte isso quebra tudo: uma
  // despesa que CRESCE 20 viraria barra verde +20, sugerindo melhora, quando o
  // efeito no resultado é −20 — e o caminho nunca fecharia no fim.
  // Com o sinal cru, receita entra positiva, despesa negativa, e a soma dos
  // componentes dá a variação do resultado. É o que faz a ponte fechar.
  const v = (src: any, id: string) => src?.[id] ?? 0
  const resId = cfg.resultado

  // ── navegar dentro da ponte ───────────────────────────────────────────
  // ⚠⚠ SUBIR SEGUE O CAMINHO PERCORRIDO, NÃO O `pai_id`. Descendo por SUBTOTAL
  // os dois coincidem; descendo por FÓRMULA, não: o EBITDA referencia
  // `Despesas`, que é linha de TOPO (pai nulo) — o ↑ não teria para onde
  // voltar. São 27 linhas que se decompõem por fórmula, metade dos pontos de
  // descida, então o caso não é raro.
  // Por isso a volta é uma TRILHA e não um botão: ela diz onde se está (hoje
  // só o seletor dizia) e leva a qualquer ancestral num clique.
  // ⚠ `trilha`/`navRef` vêm da PÁGINA: aqui dentro morreriam a cada recarga,
  // porque `carregando` desmonta o cartão inteiro. Ver o comentário lá.
  useEffect(() => { if (cfg.resultado !== navRef.current) setTrilha([]) }, [cfg.resultado]) // eslint-disable-line

  const byIdAll = useMemo(
    () => Object.fromEntries(linhas.map((l: LinhaRel) => [l.id, l])) as Record<string, LinhaRel>, [linhas])

  // ⚠ Percentual não desce: decompor `% EBITDA` somaria pontos percentuais, que
  // não somam — o resíduo viraria quase tudo e pareceria defeito do dado.
  // `formato` é o campo certo, mas está INCOMPLETO: `LER Bruto`, `LER de
  // Margem`, `dLER` e `mLER` são razões marcadas como NUMERO e escapam daqui.
  // O conserto é no CADASTRO (marcar as quatro como percentual), não numa lista
  // de nomes — nome chumbado funciona nesta DRE e quebra na próxima.
  const podeDescer = (id: string) => {
    const l = byIdAll[id]
    if (!l || (l as any).formato === 'PERCENTUAL') return false
    return componentesDe(l, linhas).length > 0
  }
  // ⚠⚠ CARD ANTIGO SE CONSERTA SOZINHO. Com o seletor de componentes removido,
  // um preset salvo com escolha manual ficaria preso nela para sempre — e a
  // ponte não fecharia, sem caminho de volta pela tela. Aqui a seleção é
  // re-derivada da estrutura quando diverge, uma vez.
  // ⚠ `cfg` fora das dependências de propósito: ele muda a cada `setCfg` e o
  // efeito voltaria a disparar — laço. Depois de alinhado não diverge mais.
  useEffect(() => {
    if (!resId) return
    const der = componentesDe(byIdAll[resId], linhas)
    if (!der.length) return
    if ([...cfg.sel].sort().join(',') !== [...der].sort().join(',')) setCfg({ ...cfg, sel: der })
  }, [resId, linhas]) // eslint-disable-line

  const irPara = (id: string, nova: string[]) => {
    navRef.current = id
    setTrilha(nova)
    setCfg({ ...cfg, resultado: id, sel: componentesDe(byIdAll[id], linhas) })
  }
  const ini = resId ? v(origem, resId) : 0
  const fim = resId ? v(destino, resId) : 0

  // ⚠ Limpa também a seleção JÁ SALVA. Corrigir só `componentesDe` deixaria o
  // defeito vivo em todo preset montado antes — e esse é o caso que importa,
  // porque é o que as pessoas abrem todo dia.
  const desativadas = useMemo(
    () => new Set(linhas.filter((l: LinhaRel) => l.desativada).map((l: LinhaRel) => l.id)), [linhas])

  // ⚠⚠ O SINAL CRU DA PONTE SE LÊ AO CONTRÁRIO NUMA SEÇÃO DE DESPESA, e o
  // aviso em texto não resolveu: o próprio autor da regra leu "Marketing
  // −1.379.414" como "gastou menos", quando o gasto SUBIU 1,38 mi. A ponte
  // mostra o EFEITO NO RESULTADO — despesa que cresce piora o resultado, logo
  // barra negativa —, mas o resto do sistema exibe despesa positiva
  // (`fatorExibicao`), e o painel ainda se chama "DESPESAS". A pessoa lê com a
  // convenção do resto da tela, que é a certa em todo lugar menos aqui.
  // O sinal NÃO pode mudar: sem ele a ponte deixa de fechar (está no CLAUDE.md
  // como exceção deliberada). O que muda é dizer em palavras o que o sinal
  // significa, na própria linha — "↑ gasto" ao lado de um número negativo
  // acaba com a ambiguidade sem tocar na aritmética.
  const natDaLinha = useMemo(() => {
    const byId: Record<string, LinhaRel> = Object.fromEntries(linhas.map((l: LinhaRel) => [l.id, l]))
    const nat = (id: string | null): string | null => {
      if (!id) return null
      const l = byId[id]; if (!l) return null
      return (l.natureza === 'RECEITA' || l.natureza === 'DESPESA') ? l.natureza : nat(l.pai_id)
    }
    return nat
  }, [linhas])
  const itens = cfg.sel.filter((id: string) => id !== resId && !desativadas.has(id))
    .map((id: string) => ({ id, nome: nome(id), d: v(destino, id) - v(origem, id) }))
    .filter((x: any) => Math.abs(x.d) > 0.005)
    .sort((a: any, b: any) => Math.abs(b.d) - Math.abs(a.d))

  // O RESÍDUO é a honestidade da ponte: se os componentes não explicam a
  // variação do resultado, a decomposição está incompleta ou se sobrepõe — e
  // isso tem de aparecer em vez de o gráfico fingir que fecha.
  const explicado = itens.reduce((s: number, x: any) => s + x.d, 0)
  const residuo = (fim - ini) - explicado
  const temResid = Math.abs(residuo) > Math.max(1, Math.abs(fim - ini) * 0.001)
  const resid = { id: '__resid', nome: 'não explicado', d: residuo }
  // ⚠⚠ O Δ DO RESULTADO NÃO ESTAVA EM LUGAR NENHUM. A tabela dava o valor
  // inicial, cada componente e o valor final — e a soma que tudo isso explica
  // ficava para o leitor fazer de cabeça, justamente o número que a ponte
  // existe para decompor (o gráfico só o mostra como a DISTÂNCIA entre as duas
  // barras roxas, que se lê por aproximação). Vai no cabeçalho da coluna, que
  // é onde a resposta precede o detalhe.
  const dTot = fim - ini
  // Percentual sobre o |inicial|: sem base não existe variação relativa, e
  // "∞%" no cabeçalho não informa nada.
  const pctTot = Math.abs(ini) > 0.005 ? (dTot / Math.abs(ini)) * 100 : null
  const barras = [...itens, ...(temResid ? [resid] : [])]

  // ⚠ O LIMITE É SÓ DO GRÁFICO. Uma linha tem 45 filhas, e 45 barras não se
  // leem — mas a tabela mostra tudo, que é onde se confere.
  // ⚠⚠ O resto vira UMA BARRA "outros", nunca é descartado: sem ela a cascata
  // não chega no total final e o gráfico passa a mentir.
  // ⚠ E o RESÍDUO fica sempre de fora do agrupamento — ele é a honestidade da
  // ponte; escondê-lo dentro de "outros" seria enterrar o aviso.
  const MAXB = 8
  const itensG = itens.length <= MAXB ? itens : [
    ...itens.slice(0, MAXB - 1),
    { id: '__outros', nome: `outros (${itens.length - (MAXB - 1)})`,
      d: itens.slice(MAXB - 1).reduce((t: number, x: any) => t + x.d, 0) },
  ]
  const barrasG = [...itensG, ...(temResid ? [resid] : [])]

  // Escala SEM forçar o zero: num bridge o início é muito maior que as
  // variações, e incluir o zero achata tudo — foi o que aconteceu na primeira
  // versão. Eixo na faixa do caminho, com folga.
  let ac = ini; const pts = [ini, fim]
  for (const b of barrasG) { ac += b.d; pts.push(ac) }
  const mn = Math.min(...pts), mx = Math.max(...pts)
  const folga = (mx - mn || Math.abs(mx) || 1) * 0.18
  const lo = mn - folga, hi = mx + folga, amp = hi - lo || 1
  const H = 210
  const y = (v: number) => ((hi - v) / amp) * H

  let cur = ini
  const passosG = barrasG.map((b: any) => { const de = cur; cur += b.d; return { ...b, de, ate: cur } })
  let curT = ini
  const passos = barras.map((b: any) => { const de = curT; curT += b.d; return { ...b, de, ate: curT } })
  const cols = [{ tot: true, lab: rotOrigem, v: ini, de: lo, ate: ini },
                ...passosG.map((p: any) => ({ tot: false, lab: p.nome, v: p.d, de: p.de, ate: p.ate, id: p.id })),
                { tot: true, lab: rotDestino, v: fim, de: lo, ate: fim }]
  const W = 78

  // ⚠ Lista separada por ASSUNTO: eram 142 linhas de relatório misturadas com
  // 27 indicadores num combo só, e escolher "% EBITDA" no meio das despesas é
  // acidente esperando acontecer — somam coisas diferentes.
  const [modoLista, setModoLista] = useState<'LINHA' | 'INDIC'>('LINHA')
  // ⚠ SÓ O NÍVEL 1. O seletor escolhe o PONTO DE PARTIDA; descer é com o `↳`.
  // Com a árvore inteira eram 170 opções indentadas — rolagem longa para achar
  // o que a navegação alcança em um clique, e fácil escolher uma linha funda
  // sem perceber de que bloco ela é.
  // ⚠⚠ O SELETOR USA A MESMA REGRA DO `↳`. Oferecer uma linha que não decompõe
  // abre a ponte vazia — "offer and then refuse", que é o que se evitou no
  // ícone. Tira exatamente duas coisas desta DRE:
  //   · `Headcount médio (FTE)` — ANALITICA com master, única de nível 1 sem
  //     componentes (as outras 31 decompõem);
  //   · as 8 PERCENTUAIS — somar pontos percentuais não fecha, e deixá-las no
  //     seletor manteria a análise quebrada a um clique de distância, mesmo com
  //     o ícone escondido.
  // ⚠⚠ SEM `linhasConciliaveis` AQUI. Ele existe para a conciliação, e a razão
  // dele é "linha de fórmula tem total mas não tem folha a conciliar contra" —
  // o que numa PONTE não importa: o que importa é ter valor e componentes, e um
  // indicador de fórmula tem os dois mesmo sem conta própria.
  // Emprestado, ele derrubava 13 dos 23 indicadores: a lista caía para 4 e
  // sumiam `Custo Pessoas`, `Folha direta`, `Margem bruta` — justamente as
  // decomposições que se quer olhar. Filtro certo para a pergunta errada.
  // ⚠⚠ AQUI O NÍVEL É CUMULATIVO ("até 2" = níveis 1 e 2), ao contrário de
  // "O que mudou", onde é uma PARTIÇÃO ("nível 2" = só o 2 + folhas acima).
  // A diferença é de propósito e tem razão: lá a lista precisa SOMAR, e
  // partição é o que impede dupla contagem; aqui é um seletor de ponto de
  // partida, e esconder o nível 1 ao pedir mais profundidade surpreenderia.
  // Por isso o rótulo também difere — "até" contra "nível".
  const prof = useMemo(() => profDe(linhas), [linhas])
  const natEf = useMemo(() => {
    const byId: Record<string, LinhaRel> = Object.fromEntries(linhas.map((l: LinhaRel) => [l.id, l]))
    const f = (id: string | null): string | null => {
      if (!id) return null
      const l = byId[id]; if (!l) return null
      return (l.natureza === 'RECEITA' || l.natureza === 'DESPESA') ? l.natureza : f(l.pai_id)
    }
    return f
  }, [linhas])

  const opcoesN1 = emArvore(linhas as any)
    .filter((l: any) => ate === 'tudo' || prof(l) <= ate)
    .filter((l: any) => modoLista === 'INDIC' ? l.tipo_linha === 'INDICADOR' : l.tipo_linha !== 'INDICADOR')
    // ⚠ Natureza só vale nas Linhas: entre os 23 indicadores são 3 de despesa e
    // 20 neutros, então "Receita" devolveria lista vazia.
    .filter((l: any) => modoLista === 'INDIC' || nat === 'TODAS' || natEf(l.id) === nat)
    .filter((l: any) => podeDescer(l.id))

  // ⚠⚠ A LINHA ATUAL ENTRA NA LISTA MESMO FORA DO NÍVEL 1. O seletor é o
  // "onde estou": descendo para uma linha de nível 2 ela não estava entre as
  // opções, e o combo voltava para "— linha de resultado —" — vazio justamente
  // depois de navegar, como se nada estivesse selecionado.
  // Vale também ao REABRIR: o card guarda a linha onde se parou, e se ela for
  // funda o seletor precisa saber mostrá-la.
  const atual = resId ? (linhas as any[]).find((l: any) => l.id === resId) : null
  const opcoes = atual && !opcoesN1.some((l: any) => l.id === resId)
    ? [{ ...atual, prof: 0, _fora: true }, ...opcoesN1]
    : opcoesN1

  return (
    <div style={S.sec}>
      <div>
        <div><div style={S.secT}>A ponte — de onde vem a variação</div>
          <div style={S.secD}>
            Decompõe a variação de <strong>uma</strong> linha de resultado. Os componentes precisam
            ser <strong>independentes</strong> — subtotal junto com componente conta duas vezes, e o
            resíduo denuncia. Os componentes saem da <strong>própria estrutura do relatório</strong> — a fórmula da linha, ou as filhas de um subtotal. ⚠ Aqui a despesa aparece <strong>negativa quando CRESCE</strong> — a
            barra mostra o efeito no <strong>resultado</strong>, não a convenção do resto da tela, onde despesa é
            positiva. Por isso as linhas de despesa trazem <strong>↑ gasto</strong> ou <strong>↓ gasto</strong> ao
            lado do número.
            {' '}⚠ Aqui o nível é <strong>cumulativo</strong>: <em>até 2</em> oferece os níveis 1 <em>e</em> 2 —
            é um seletor de ponto de partida, não um corte. Em <em>O que mudou</em> o mesmo botão
            significa outra coisa.
            {' '}⚠⚠ <strong>Confira o sentido antes de ler os sinais</strong> — ele está no
            cabeçalho e vale para este quadro e para <em>O que mudou</em>. Saindo do
            <strong> orçado</strong> para o <strong>realizado</strong>, cada barra é o
            <em> desvio em relação ao plano</em>; invertido, todos os sinais viram junto.
          </div></div>
        <div style={S.secBarra} data-noexport>
          <Grupo opcoes={ABAS} valor={modoLista} onPick={setModoLista} />
          <Grupo rotulo="até" valor={ate} onPick={setAte}
            opcoes={[[1, '1'], [2, '2'], [3, '3'], ['tudo', 'tudo', 'Todas as linhas, em qualquer profundidade']] as const} />
          {modoLista === 'LINHA' && <Grupo opcoes={NATS} valor={nat} onPick={setNat} />}
          <select value={resId ?? ''} onChange={e => {
              const novo = e.target.value
              // Escolher pelo seletor é partir do zero: a trilha some.
              navRef.current = novo; setTrilha([])
              setCfg({ ...cfg, resultado: novo, sel: componentesDe(byIdAll[novo], linhas) })
            }}
            style={{ padding: '5px 8px', fontSize: 12, border: '1px solid var(--border-strong)', borderRadius: 7, background: 'var(--bg-soft)', color: 'var(--text)', maxWidth: 220 }}>
            <option value="">— linha de resultado —</option>
            {opcoes.map((l: any) => (
              // `↳` na que veio da navegação: ela não é ponto de partida da
              // lista, está ali porque é onde você está.
              <option key={l.id} value={l.id}>{l._fora ? '↳ ' : ''}{'\u00A0'.repeat(l.prof * 2)}{l.descricao}</option>
            ))}
          </select>
          {/* ⚠ SAÍRAM o "usar os da estrutura" e o seletor de componentes. Eles
              só existiam um por causa do outro: um deixava mexer na lista à
              mão, o outro desfazia. Trocar a linha JÁ deriva da estrutura, que
              é o que o texto deste cartão promete — e componente escolhido a
              dedo faz a ponte não fechar, que é o contrário de uma ponte. */}
          <span style={{ fontSize: 11.5, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
            {cfg.sel.length} componente(s)
          </span>
        </div>
      </div>

      {!resId ? <div style={{ color: 'var(--muted)', fontSize: 13 }}>Escolha a linha de resultado a decompor.</div>
       : !barras.length ? <div style={{ color: 'var(--muted)', fontSize: 13 }}>Sem variação nos componentes escolhidos.</div> : (
        <>
          {Math.abs(residuo) > Math.abs(fim - ini) * 0.15 && (
            <div style={{ fontSize: 12, color: 'var(--orange)', marginBottom: 10 }}>
              ⚠ {fmt(Math.abs(residuo))} ({Math.abs(residuo / ((fim - ini) || 1) * 100).toFixed(0)}% da variação) não é explicado
              pelos componentes. Causas, da mais comum para a menos: há <strong>subtotal junto com componente</strong> na
              seleção (conta duas vezes), falta um componente, ou um dos componentes está <strong>desativado</strong> na
              estrutura — o total do resultado não o inclui, então ele sobra.
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(340px, 1fr) minmax(290px, 400px)', gap: 20, alignItems: 'start' }}>
            <div style={{ overflowX: 'auto' }}>
              <svg width={Math.max(380, cols.length * W)} height={H + 46}>
                {cols.map((c: any, i: number) => {
                  const y0 = y(Math.max(c.de, c.ate)), y1 = y(Math.min(c.de, c.ate))
                  const cor = c.tot ? 'var(--violet)' : c.id === '__resid' ? 'var(--orange)' : c.v >= 0 ? 'var(--green)' : 'var(--red)'
                  return (
                    <g key={i}>
                      <rect x={i * W + 12} y={y0} width={W - 26} height={Math.max(3, y1 - y0)} fill={cor} rx={3} opacity={c.tot ? 1 : .9} />
                      <text x={i * W + (W - 2) / 2} y={Math.max(11, y0 - 5)} textAnchor="middle" fontSize={10} fill="var(--text-mid)" fontFamily="monospace">
                        {c.tot ? fmt(c.v) : `${c.v >= 0 ? '+' : ''}${fmt(c.v)}`}
                      </text>
                      <text x={i * W + (W - 2) / 2} y={H + 18} textAnchor="middle" fontSize={9.5} fill="var(--muted)">
                        {String(c.lab).length > 12 ? String(c.lab).slice(0, 11) + '…' : c.lab}
                      </text>
                    </g>
                  )
                })}
              </svg>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              {/* ⚠ SUBIR fica aqui, na mesma coluna do ↳ de descer, e não numa
                  trilha acima do gráfico. A trilha mostrava o caminho inteiro,
                  mas a profundidade real é 4 níveis — no máximo 3 voltas — e o
                  cabeçalho já nomeia onde se está. Dois controles no mesmo
                  lugar valem mais que um mapa que ocupa uma faixa da tela. */}
              <thead><tr><th style={{ ...S.th, textAlign: 'left' }}>
                {trilha.length > 0 && (
                  <button onClick={() => irPara(trilha[trilha.length - 1], trilha.slice(0, -1))}
                    title={`Voltar a ${nome(trilha[trilha.length - 1])}`} data-noexport
                    style={{ background: 'none', border: 'none', padding: 0, marginRight: 6,
                             cursor: 'pointer', color: 'var(--violet)', verticalAlign: -2 }}>
                    <CornerLeftUp size={13} />
                  </button>
                )}
                {nome(resId)}</th>
                <th style={{ ...S.th, verticalAlign: 'bottom' }}
                  title="Quanto cada componente move o RESULTADO. Despesa que cresce aparece negativa, porque piora o resultado.">
                  {/* O número que a ponte decompõe, acima do rótulo da coluna:
                      a resposta antes do detalhe que a explica. */}
                  <div style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 700, textTransform: 'none',
                                letterSpacing: 0, marginBottom: 1,
                                color: dTot >= 0 ? 'var(--green)' : 'var(--red)' }}>
                    {dTot >= 0 ? '+' : ''}{fmt(dTot)}
                    {pctTot != null && (
                      <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--muted)', marginLeft: 5 }}>
                        {fmtPct(pctTot)}
                      </span>
                    )}
                  </div>
                  {/* ⚠ A linha de resultado também pode ser DESPESA — é o que
                      acontece ao descer para `Despesas` —, e aí o Δ do
                      cabeçalho se lê invertido como os das linhas. Mesmo
                      marcador, mesma razão: o aviso tem de estar junto do
                      número que engana. */}
                  {natDaLinha(resId) === 'DESPESA' && (
                    <div style={{ fontSize: 10, textTransform: 'none', letterSpacing: 0, color: 'var(--muted)' }}>
                      {dTot < 0 ? '↑ gasto' : '↓ gasto'}
                    </div>
                  )}
                  efeito no resultado
                </th>
                {/* ⚠ O MARCADOR TEM COLUNA PRÓPRIA, e ela existe mesmo vazia.
                    Inline, "↑ gasto" ocupava o fluxo da célula e empurrava o
                    número daquela linha para a esquerda — a única linha fora
                    do alinhamento da coluna, o que faz procurar defeito no
                    número. Reservar a largura em todas as linhas custa 22px e
                    mantém os valores encostados na mesma borda.
                    ⚠ Só a SETA, sem a palavra (decisão do Ricardo, 19/nov): o
                    texto "↑ gasto" dobrava a largura reservada em toda linha
                    para explicar o que o `title` explica sob demanda. O que se
                    perde é a leitura sem passar o mouse — por isso a seta fica
                    só em linha de DESPESA, onde ela é a única convenção
                    possível, e o cabeçalho segue escrevendo por extenso. */}
                <th style={{ ...S.th, width: 22 }} /></tr></thead>
              <tbody>
                <tr><td style={{ ...S.td, textAlign: 'left', fontFamily: 'inherit', color: 'var(--muted)' }}>{rotOrigem}</td><td style={S.td}>{fmt(ini)}</td><td style={S.td} /></tr>
                {passos.map((b: any) => {
                  // Só em linha de DESPESA: em receita o sinal já se lê direto
                  // (+ é mais receita), e repetir "↑ receita" seria ruído.
                  const desp = b.id !== '__resid' && natDaLinha(b.id) === 'DESPESA'
                  return (
                  <tr key={b.id}><td style={{ ...S.td, textAlign: 'left', fontFamily: 'inherit', color: b.id === '__resid' ? 'var(--orange)' : undefined }}>
                    {/* ⚠ Só onde HÁ o que decompor (46 das 170 linhas). Oferecer
                        e depois abrir uma ponte vazia ensina que a tela às
                        vezes não funciona. */}
                    {podeDescer(b.id) && (
                      <button onClick={() => irPara(b.id, [...trilha, resId])}
                        title="Decompor esta linha — a ponte se refaz a partir dela"
                        data-noexport
                        style={{ background: 'none', border: 'none', padding: 0, marginRight: 6,
                                 cursor: 'pointer', color: 'var(--violet)', verticalAlign: -2 }}>
                        <CornerDownRight size={13} />
                      </button>
                    )}
                    {b.nome}</td>
                    <td style={{ ...S.td, color: b.id === '__resid' ? 'var(--orange)' : b.d >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      {b.d >= 0 ? '+' : ''}{fmt(b.d)}
                    </td>
                    <td style={{ ...S.td, textAlign: 'left', paddingLeft: 5, fontSize: 11, fontFamily: 'inherit', color: 'var(--muted)' }}
                      title={desp ? (b.d < 0 ? 'gasto MAIOR — a despesa cresceu, por isso o número é negativo' : 'gasto MENOR — a despesa caiu') : undefined}>
                      {desp ? (b.d < 0 ? '↑' : '↓') : ''}
                    </td></tr>
                )})}
                <tr><td style={{ ...S.td, textAlign: 'left', fontFamily: 'inherit', fontWeight: 700 }}>{rotDestino}</td>
                  <td style={{ ...S.td, fontWeight: 700 }}>{fmt(fim)}</td><td style={S.td} /></tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

