// ============================================================
// Realizado a partir de uma PLANILHA plana, pelo perfil do ERP.
//
// POR QUE EXISTE: o razão do Protheus vem como csv dentro de zip e tem módulo
// próprio (`razaoZip.ts`). O ContaAzul não exporta razão nenhum — exporta um
// pivot de lançamentos, xlsx, uma linha por parcela. Até 26/nov esse arquivo
// passava por um de-para em planilha com macro, que o traduzia para o formato
// Protheus só para o GoodData poder carregá-lo. O de-para somava 56 categorias
// em 34 contas, inventava centro de custo e empilhava CSLL e retenções dentro
// de "PIS" — e ninguém o auditava, porque ele era um passo intermediário.
// Aqui o arquivo da origem entra como ele é, e a tradução vira UMA amarração
// conta → linha, na tela, visível e corrigível.
//
// ⚠⚠ O PERFIL É O MESMO ARQUIVO de `lib/perfis/*.json` que o resto do produto
// usa. Um perfil de planilha não serve ao `scripts/gerar_lotes_mensais.py`, e
// é o Python que recusa: ele exige as colunas empresa/debito/credito e para
// com o nome do perfil na mensagem. Falha nomeada é o que se quer — o Python
// não lê pivot, e silenciosamente ler metade seria pior.
//
// ⚠ A SAÍDA É A MESMA do zip: linhas no formato do modelo de import do
// Realizado, agrupadas por competência. Então `importarLote` — que resolve
// conta/empresa/filial/CC, câmbio, lote ignorado, modo substituir e log — é
// exatamente o mesmo caminho já provado. Nada aqui grava.
// ============================================================
import type { PerfilRazao, LinhaRazao, Competencia } from './razaoZip'
import { RazaoZipErro } from './razaoZip'

// O XLSX vem de um <script> no index.html (sheetjs por CDN), não de npm —
// mesmo acordo de `planilha.ts`. ⚠ E aqui NÃO há plano B: sem ele não há como
// interpretar o arquivo, e seguir fingindo que deu seria importar nada em
// silêncio, que é o defeito que esta tela acabou de pagar duas vezes.
declare const XLSX: any

// ⚠ `dePartes`, `numero` e `contaDoCampo` são exportadas para o teste
// (`planilhaRazao.teste.mjs`) — a regra de fuso e a do código com espaço
// erraram na primeira escrita e não aparecem lendo o código.

// ── leitura da planilha ───────────────────────────────────────────────────
// ⚠ `cellDates` para a data chegar como Date e não como serial do Excel;
// `dense` porque a aba do Flexmonster vem larga e esparsa.
function matriz(buf: Uint8Array, perfil: PerfilRazao): any[][] {
  if (typeof XLSX === 'undefined') {
    throw new RazaoZipErro('A biblioteca de planilha (SheetJS) não carregou — recarregue a página.')
  }
  const wb = XLSX.read(buf, { type: 'array', cellDates: true, dense: true })
  const alvo = perfil.arquivo_padrao?.replace(/\.[^.]+$/, '').toLowerCase()
  // A aba é a que tem mais linhas — o pivot vem com uma só ("Flexmonster
  // Pivot Table"), e escolher pelo NOME prenderia o perfil à ferramenta que
  // gerou o arquivo. O nome do perfil, quando casa, tem precedência.
  let nome: string = (wb.SheetNames || []).find((n: string) => alvo && n.toLowerCase().includes(alvo)) || ''
  if (!nome) {
    let maior = -1
    for (const n of (wb.SheetNames || []) as string[]) {
      const r = XLSX.utils.decode_range(wb.Sheets[n]['!ref'] || 'A1:A1').e.r
      if (r > maior) { maior = r; nome = n }
    }
  }
  if (!nome) throw new RazaoZipErro('A planilha veio sem nenhuma aba com conteúdo.')
  return (XLSX.utils.sheet_to_json(wb.Sheets[nome],
    { header: 1, defval: '', blankrows: false, raw: true }) as any[][]) || []
}

// ⚠⚠ DATA DE PLANILHA E FUSO: o serial do Excel é uma data PURA, sem hora nem
// fuso, e o SheetJS a materializa num `Date` — ora meia-noite local, ora
// meia-noite UTC, conforme a versão e a opção. No Brasil (UTC−3) a segunda
// forma lida com `getDate()` devolve o DIA ANTERIOR: 01/jan/2026 vira
// 31/dez/2025, e o lançamento troca de competência — de ANO, no caso de
// janeiro. O sintoma seria um dezembro que ninguém importou.
// A regra: hora local diferente de zero significa que o Date foi construído
// noutro fuso, então valem os getters UTC. Data pura nunca tem hora.
export function dePartes(v: any): { ano: number; mes: number; dia: number } | null {
  if (v instanceof Date && !isNaN(v.getTime())) {
    const utc = v.getHours() !== 0 || v.getMinutes() !== 0
    return utc
      ? { ano: v.getUTCFullYear(), mes: v.getUTCMonth() + 1, dia: v.getUTCDate() }
      : { ano: v.getFullYear(), mes: v.getMonth() + 1, dia: v.getDate() }
  }
  const s = String(v ?? '').trim()
  if (!s) return null
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)            // 2026-01-31
  if (m) return { ano: +m[1], mes: +m[2], dia: +m[3] }
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(s)    // 31/01/2026
  if (m) return { ano: +m[3], mes: +m[2], dia: +m[1] }
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s)                 // 20260131
  if (m) return { ano: +m[1], mes: +m[2], dia: +m[3] }
  return null
}

// ⚠ Número de planilha chega como number, mas csv e célula de texto chegam
// como "1.234,56" ou "-1472.4". Tira o separador de milhar só quando a vírgula
// é o decimal — fazê-lo sempre transformaria 1,472.4 em 14724.
export function numero(v: any): number {
  if (typeof v === 'number') return isFinite(v) ? v : 0
  let s = String(v ?? '').trim().replace(/\s/g, '')
  if (!s) return 0
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  return parseFloat(s) || 0
}

/** Código da conta a partir da categoria: "1.11.1002 NOME" → "1.11.1002". */
export function contaDoCampo(bruto: string, perfil: PerfilRazao): string {
  const v = bruto.trim()
  if (!v) return ''
  if (!perfil.conta_do_prefixo) return v
  // ⚠ `\d+(\.\s*\d+)*` aceita o espaço DENTRO do código, que é erro de
  // digitação da origem ("2.20. 1001 REEMBOLSO"), e depois o remove. Sem isso
  // a conta sai "2.20." e não casa com nada — e o import diria "conta não
  // encontrada" sobre uma conta que está no plano.
  const m = /^(\d+(?:\.\s*\d+)*)\s+\S/.exec(v)
  if (m) return m[1].replace(/\s+/g, '')
  // Sem código na origem: só o mapa EXPLÍCITO responde. Slug derivado do nome
  // casaria por acidente e erraria por acidente — a lição da v3_160.
  return perfil.conta_sem_codigo?.[v] || ''
}

// ⚠⚠ O CC NÃO VEM DO ARQUIVO, VEM DA REGRA — e a regra é por NATUREZA DA CONTA.
// O pivot do ContaAzul traz "Centro de custo" em branco em 100% das linhas, e a
// convenção desta instalação é: despesa no 111 e receita no "15" de Base RD
// (215 sob Comercial, 315 sob Serviços). Por isso `fixos.cc` é só o PADRÃO — o
// lado da despesa — e `cc_por_conta` diz as exceções.
// ⚠ `""` no mapa é SEM CC decidido (resultado financeiro, venda de ativo), e é
// diferente de a conta faltar: ausência é esquecimento.
// ⚠ `cc_sem_padrao` é a rede contra o erro que importa: receita nova fora do
// mapa cairia no 111 e a DRE mostraria receita dentro do Administrativo —
// errado e quieto. Sem padrão ela entra sem CC, e o relatório da importação a
// nomeia em "CC em branco na origem". Despesa nova segue indo ao 111 sozinha.
export function ccDaConta(contaCod: string, perfil: PerfilRazao): string {
  const mapa = perfil.cc_por_conta
  if (mapa && Object.prototype.hasOwnProperty.call(mapa, contaCod)) return mapa[contaCod] || ''
  if ((perfil.cc_sem_padrao || []).some(pre => contaCod.startsWith(pre))) return ''
  return perfil.fixos?.cc ?? ''
}

type Conv = {
  converte: (r: any[]) => { ano: number; mes: number; linha: LinhaRazao } | null
  /** Quanto ficou fora do valor de competência, por coluna do arquivo. */
  extras: Record<string, number>
  somaExtra: (r: any[]) => void
}

function fazConverter(perfil: PerfilRazao, cab: string[]): Conv {
  const col = perfil.colunas
  const fix = perfil.fixos || {}
  const idx: Record<string, number> = {}
  for (const campo in col) idx[campo] = cab.indexOf(col[campo])
  const val = (r: any[], campo: string): string => {
    const i = idx[campo]
    if (i === undefined || i < 0) return fix[campo] ?? ''
    const v = r[i]
    return v === null || v === undefined ? (fix[campo] ?? '') : String(v).trim()
  }
  // Colunas de liquidação que o arquivo tem e o perfil NÃO usa: contadas para
  // a tela poder dizer quanto ficou de fora. Corte calado é o que este projeto
  // persegue; aqui o corte é certo (competência ≠ caixa) e precisa ser dito.
  const usadas = new Set(Object.values(col))
  // ⚠ DOIS GRUPOS, não um: juros/multa/desconto/tarifa são valores que FICAM
  // DE FORA do de competência, e o "baixado" é o MESMO dinheiro contado de
  // outro jeito (caixa). Somar os dois na mesma frase faria o aviso dizer que
  // 166 mil ficaram de fora, quando 166 mil é o total alternativo.
  const extraIdx = cab
    .map((n, i) => [n, i] as [string, number])
    .filter(([n]) => !usadas.has(n) && /juros|multa|desconto|tarifa/i.test(n))
  const baixIdx = cab.findIndex(n => !usadas.has(n) && /baixad|l[íi]quid/i.test(n))
  const extras: Record<string, number> = {}

  return {
    extras,
    somaExtra: r => {
      for (const [n, i] of extraIdx) extras[n] = (extras[n] || 0) + numero(r[i])
      if (baixIdx >= 0) extras['\u0000baixado'] = (extras['\u0000baixado'] || 0) + numero(r[baixIdx])
      extras['\u0000usado'] = (extras['\u0000usado'] || 0)
        + (idx['valor_assinado'] >= 0 ? numero(r[idx['valor_assinado']]) : 0)
    },
    converte: r => {
      const d = dePartes(idx['data'] >= 0 ? r[idx['data']] : '')
      if (!d) return null
      const contaCod = contaDoCampo(val(r, 'conta'), perfil)
      // ⚠ UMA coluna com SINAL vira o par débito/crédito, porque é disso que
      // `importarLote` calcula `valor = crédito − débito`. Saída negativa →
      // débito → valor negativo, que é como a despesa fica guardada (a DRE a
      // mostra positiva por `fatorExibicao`). Inverter aqui faria toda despesa
      // da AVENTUM entrar no relatório com o sinal trocado.
      let deb = 0, cre = 0
      if (idx['valor_assinado'] >= 0) {
        const v = numero(r[idx['valor_assinado']])
        if (v < 0) deb = -v; else cre = v
      } else {
        deb = numero(idx['debito'] >= 0 ? r[idx['debito']] : 0)
        cre = numero(idx['credito'] >= 0 ? r[idx['credito']] : 0)
      }
      const p2 = (n: number) => String(n).padStart(2, '0')
      // ⚠ O CC sai da CONTA quando o arquivo não tem a coluna. Com coluna no
      // arquivo, o que o arquivo diz manda — a regra é para suprir ausência,
      // não para sobrescrever origem.
      const temColCc = idx['cc'] !== undefined && idx['cc'] >= 0
      const ccCod = temColCc ? val(r, 'cc') : ccDaConta(contaCod, perfil)
      return {
        ano: d.ano, mes: d.mes,
        linha: {
          empresa_codigo: val(r, 'empresa'),
          filial_codigo: val(r, 'filial'),
          cc_codigo: ccCod,
          conta_codigo: contaCod,
          data: `${d.ano}-${p2(d.mes)}-${p2(d.dia)}`,
          ano: d.ano, mes: d.mes,
          documento: val(r, 'documento'),
          historico: val(r, 'historico'),
          debito: +deb.toFixed(2),
          credito: +cre.toFixed(2),
          lote: val(r, 'lote'),
          sublote: val(r, 'sublote'),
        },
      }
    },
  }
}

// ⚠ Confere só as colunas que o arquivo tem de ter: as que o perfil crava em
// `fixos` não são lidas de coluna nenhuma. Sem essa exceção o perfil do
// ContaAzul acusaria "falta empresa" sobre uma empresa que ele próprio define.
function conferirColunas(perfil: PerfilRazao, cab: string[]): string[] {
  const fix = perfil.fixos || {}
  return Object.entries(perfil.colunas)
    .filter(([campo, nome]) => nome && !fix[campo] && !cab.includes(nome))
    .map(([campo, nome]) => `${campo} → "${nome}"`)
}

function varrer(buf: Uint8Array, perfil: PerfilRazao) {
  const aoa = matriz(buf, perfil)
  if (!aoa.length) throw new RazaoZipErro('A planilha veio vazia.')
  // Cabeçalho: o perfil manda quando declara a linha; senão é a primeira com
  // dois ou mais rótulos. Adivinhar mais que isso é como se lê a coluna errada.
  const hr = perfil.cabecalho_linha
    ? perfil.cabecalho_linha - 1
    : aoa.findIndex(l => (l || []).filter(c => String(c).trim()).length >= 2)
  const cab = (aoa[hr] || []).map(c => String(c).trim())
  if (!cab.some(Boolean)) throw new RazaoZipErro('Não achei o cabeçalho da planilha.')
  const faltando = conferirColunas(perfil, cab)
  if (faltando.length) {
    // ⚠ A MENSAGEM MOSTRA O CABEÇALHO QUE VEIO — mesma razão do razaoZip: sem
    // isso ela afirma que a coluna não existe e a pessoa a vê no arquivo.
    const amostra = cab.filter(Boolean).slice(0, 8).map(x => `"${x}"`).join(', ')
    throw new RazaoZipErro(
      `A planilha não tem a(s) coluna(s) ${faltando.join(', ')} que o perfil "${perfil.nome}" espera.`
      + ` O cabeçalho lido tem ${cab.filter(Boolean).length} coluna(s), começando por: ${amostra}`
      + `${cab.filter(Boolean).length > 8 ? ', …' : ''}.`, cab.filter(Boolean))
  }
  const conv = fazConverter(perfil, cab)
  const contagem = new Map<number, number>()
  const porComp = new Map<number, LinhaRazao[]>()
  let semData = 0, semConta = 0
  for (let i = hr + 1; i < aoa.length; i++) {
    const r = aoa[i] || []
    if (!r.some(c => String(c ?? '').trim() !== '')) continue
    const x = conv.converte(r)
    if (!x) { semData++; continue }
    if (!x.linha.conta_codigo) semConta++
    conv.somaExtra(r)
    const k = x.ano * 100 + x.mes
    contagem.set(k, (contagem.get(k) || 0) + 1)
    let arr = porComp.get(k); if (!arr) { arr = []; porComp.set(k, arr) }
    arr.push(x.linha)
  }
  return { contagem, porComp, extras: conv.extras, semData, semConta }
}

const brl = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * O que a planilha tem, por competência — e o que ficou de fora.
 * ⚠ Uma passada só, ao contrário do zip: um pivot são milhares de linhas, não
 * um milhão, então guardá-las é barato e reler seria gasto sem motivo.
 */
export function inventariarPlanilha(buf: Uint8Array, perfil: PerfilRazao): {
  comps: Competencia[]; linhas: Map<number, LinhaRazao[]>; aviso: string
} {
  const { contagem, porComp, extras, semData, semConta } = varrer(buf, perfil)
  const partes: string[] = []
  const liq = Object.entries(extras)
    .filter(([n, v]) => !n.startsWith('\u0000') && Math.abs(v) >= 0.005)
  if (liq.length) {
    partes.push(`Ficaram de fora (são fato de caixa, não de competência): `
      + liq.map(([n, v]) => `${n} ${brl(v)}`).join(' · ') + '.')
  }
  const bx = extras['\u0000baixado'], usado = extras['\u0000usado']
  if (bx !== undefined && Math.abs(bx - usado) >= 0.005) {
    // Declara a ESCOLHA: o arquivo tem os dois totais e este perfil usa o de
    // competência. Sem a frase, quem conferir contra o extrato do ContaAzul
    // acha diferença e procura defeito.
    partes.push(`O arquivo traz também o total baixado (caixa) ${brl(bx)};`
      + ` o realizado usa o de competência ${brl(usado)}.`)
  }
  if (semData) partes.push(`${semData} linha(s) sem data válida ficaram de fora.`)
  // ⚠ Conta sem código é avisada AQUI, antes de importar, porque ela some em
  // "conta não encontrada" no relatório do import e lá parece cadastro
  // faltando — quando o que falta é um código no mapa do perfil.
  if (semConta) partes.push(`⚠ ${semConta} linha(s) sem código de conta — categoria nova`
    + ` sem código na origem precisa entrar em "conta_sem_codigo" do perfil.`)
  return {
    comps: [...contagem.entries()]
      .map(([k, linhas]) => ({ ano: Math.floor(k / 100), mes: k % 100, linhas }))
      .sort((a, b) => (a.ano - b.ano) || (a.mes - b.mes)),   // cronológico, como no zip
    linhas: porComp,
    aviso: partes.join(' '),
  }
}

/** As linhas das competências escolhidas, no formato do import. */
export function extrairPlanilha(linhas: Map<number, LinhaRazao[]>, comps: Competencia[]) {
  return comps
    .map(c => c.ano * 100 + c.mes)
    .sort((a, b) => a - b)
    .map(k => ({
      ano: Math.floor(k / 100), mes: k % 100,
      nome: `lancamentos_${Math.floor(k / 100)}_${String(k % 100).padStart(2, '0')}`,
      linhas: linhas.get(k) || [],
    }))
    .filter(l => l.linhas.length)
}
