// ============================================================
// Razão do ERP direto do ZIP, no navegador.
//
// POR QUE EXISTE: até nov/2026 o realizado só entrava assim — alguém com o
// repositório na máquina rodava `scripts/realizado.sh`, que quebrava o razão
// em um xlsx por mês, e só então alguém arrastava os xlsx para a tela. O passo
// do meio existia porque a tela não sabia abrir o zip, e ele prendia a carga
// mensal a UMA pessoa. Aqui a tela abre.
//
// ⚠⚠ O PERFIL É O MESMO ARQUIVO QUE O PYTHON LÊ (`lib/perfis/*.json`), e isso
// não é organização: duas cópias da regra divergiriam no primeiro ajuste, e o
// sintoma seria o lote gerado pelo script e o importado pela tela deixando de
// bater **sem nada acusar**. O script continua existindo como contingência.
//
// ⚠⚠ DUAS PASSADAS, de propósito. A primeira só CONTA por competência; a
// segunda extrai os meses marcados. Guardar o ano inteiro para depois filtrar
// seria 375 mil linhas em objetos — centenas de MB no navegador de quem
// importa. Um mês são ~35 mil linhas, que cabem com folga. O custo é reler o
// zip, que está em memória: barato perto de travar a aba.
//
// Medido no `PLANORC.zip` de 22/nov: 25 MB comprimidos, `LancamentoContabil.csv`
// com 367 MB e 1.155.566 linhas (2022→2026); 2026 tem 375.222 e um mês típico
// 30–40 mil.
// ============================================================
import { Unzip, AsyncUnzipInflate } from 'fflate'

export type PerfilRazao = {
  nome: string
  descricao?: string
  arquivo_padrao?: string
  colunas: Record<string, string>
  desempilhar_pipe?: boolean
  empresa_por_item_contabil?: Record<string, string>
  empresa_remap_final?: Record<string, string>
}

/** Uma linha no formato do modelo de import do Realizado. */
export type LinhaRazao = Record<string, string | number>

export const COLS_RAZAO = [
  'empresa_codigo', 'filial_codigo', 'cc_codigo', 'conta_codigo', 'data', 'ano', 'mes',
  'documento', 'historico', 'debito', 'credito', 'lote', 'sublote',
] as const

export type Competencia = { ano: number; mes: number; linhas: number }

// ── leitura do zip ────────────────────────────────────────────────────────
// ⚠ A entrada que não interessa é DESCARTADA SEM INFLAR: em `onfile` só se
// chama `.start()` no arquivo escolhido. O PLANORC.zip tem 2 entradas e 368 MB
// descompactados; um zip do ERP inteiro tem 60 entradas e 1 GB. Inflar tudo
// para usar uma é a diferença entre funcionar e matar a aba.
function lerEntrada(buf: Uint8Array, escolhe: (nome: string) => boolean,
                    onChunk: (c: Uint8Array, fim: boolean) => void): Promise<string> {
  return new Promise((res, rej) => {
    let achou = ''
    const uz = new Unzip()
    uz.register(AsyncUnzipInflate)
    uz.onfile = f => {
      if (achou || !escolhe(f.name)) return
      achou = f.name
      f.ondata = (err, chunk, fim) => {
        if (err) return rej(err)
        onChunk(chunk, fim)
        if (fim) res(achou)
      }
      f.start()
    }
    // ⚠ Em pedaços: `push` de 367 MB de uma vez devolve o controle ao laço de
    // eventos só no fim, e a aba congela sem pintar progresso nenhum.
    const PASSO = 1 << 22   // 4 MB
    for (let i = 0; i < buf.length; i += PASSO) {
      uz.push(buf.subarray(i, Math.min(i + PASSO, buf.length)), i + PASSO >= buf.length)
    }
    if (!achou) setTimeout(() => { if (!achou) rej(new Error('ARQUIVO_NAO_ENCONTRADO')) }, 0)
  })
}

// ── CSV incremental ───────────────────────────────────────────────────────
// ⚠⚠ NÃO DÁ PARA FAZER `split(',')`. O razão tem campos entre aspas e o
// HISTÓRICO carrega vírgula ("SERV ENTREGA, UNIMED"); partir na vírgula crua
// desloca todas as colunas seguintes daquela linha — e o estrago não aparece
// como erro, aparece como lançamento com conta errada.
// ⚠ E o parser é de ESTADO porque o chunk corta no meio do campo: o que sobra
// de um pedaço continua no próximo.
class CsvStream {
  private resto = ''
  private campo = ''
  private linha: string[] = []
  private aspas = false
  constructor(private onLinha: (c: string[]) => void) {}

  push(txt: string) {
    const s = this.resto + txt
    this.resto = ''
    for (let i = 0; i < s.length; i++) {
      const ch = s[i]
      if (this.aspas) {
        if (ch === '"') {
          if (s[i + 1] === '"') { this.campo += '"'; i++ }       // aspa escapada
          else this.aspas = false
        } else this.campo += ch
      } else if (ch === '"') this.aspas = true
      else if (ch === ',') { this.linha.push(this.campo); this.campo = '' }
      else if (ch === '\n') { this.linha.push(this.campo); this.campo = ''; this.onLinha(this.linha); this.linha = [] }
      else if (ch !== '\r') this.campo += ch
    }
  }
  fim() {
    if (this.campo || this.linha.length) { this.linha.push(this.campo); this.onLinha(this.linha) }
    this.campo = ''; this.linha = []
  }
}

// ⚠ LATIN-1, não UTF-8. O export do Protheus vem em latin-1 e decodificar como
// UTF-8 não dá erro: devolve `` no lugar do acento e segue — o histórico
// chega corrompido ao banco sem ninguém notar na importação.
// ⚠ `stream: true` é obrigatório: sem ele, um caractere partido entre dois
// chunks vira lixo. Em latin-1 cada byte é um caractere, mas a opção fica
// porque o perfil pode declarar outro encoding um dia.
const dec = new TextDecoder('latin1', { fatal: false })

// ── regra de conversão (porte fiel do pass1_split do Python) ──────────────
function fazConverter(perfil: PerfilRazao, cab: string[]) {
  const col = perfil.colunas
  const pipe = perfil.desempilhar_pipe !== false
  const itemcc = perfil.empresa_por_item_contabil || {}
  const remap = perfil.empresa_remap_final || {}
  const idx: Record<string, number> = {}
  for (const campo in col) idx[campo] = cab.indexOf(col[campo])

  // ⚠ "P |01|CT1200||11011002" → vale o trecho após o ÚLTIMO pipe. É a forma
  // como o Protheus empilha filial/código no mesmo campo.
  const val = (r: string[], campo: string): string => {
    const i = idx[campo]
    if (i === undefined || i < 0) return ''
    const v = (r[i] ?? '').trim()
    return pipe && v.includes('|') ? v.split('|').pop()!.trim() : v
  }

  return (r: string[]): { ano: number; mes: number; linha: LinhaRazao } | null => {
    const data = val(r, 'data')
    if (data.length !== 8 || !/^\d{8}$/.test(data)) return null
    const ano = +data.slice(0, 4), mes = +data.slice(4, 6)
    // ⚠ O item contábil MANDA quando está no mapa — é assim que o razão
    // brasileiro entrega para o Paraguai o que é dele. Fora do mapa, vale a
    // empresa do arquivo.
    const item = val(r, 'item_contabil')
    let emp = (item && itemcc[item]) ? itemcc[item] : val(r, 'empresa')
    if (remap[emp]) emp = remap[emp]
    const num = (c: string) => parseFloat((val(r, c) || '0').replace(',', '.')) || 0
    return {
      ano, mes,
      linha: {
        empresa_codigo: emp,
        filial_codigo: val(r, 'filial'),
        cc_codigo: val(r, 'cc'),
        conta_codigo: val(r, 'conta'),
        data: `${data.slice(0, 4)}-${data.slice(4, 6)}-${data.slice(6, 8)}`,
        ano, mes,
        documento: val(r, 'documento'),
        historico: val(r, 'historico'),
        debito: num('debito'),
        credito: num('credito'),
        lote: val(r, 'lote'),
        sublote: val(r, 'sublote'),
      },
    }
  }
}

/** Colunas do perfil que o arquivo não tem — vale parar antes de converter. */
function conferirColunas(perfil: PerfilRazao, cab: string[]): string[] {
  return Object.entries(perfil.colunas)
    .filter(([, nome]) => !cab.includes(nome)).map(([campo, nome]) => `${campo} → "${nome}"`)
}

export class RazaoZipErro extends Error {
  constructor(msg: string, readonly colunasDoArquivo?: string[]) { super(msg) }
}

type Opcoes = {
  perfil: PerfilRazao
  /** Progresso em linhas lidas, para a tela não parecer travada. */
  onProgresso?: (linhas: number) => void
  /** Só estas competências (`ano*100+mes`); vazio = todas. */
  apenas?: Set<number>
  /** Guarda as linhas (2ª passada) ou só conta (1ª). */
  coletar?: boolean
}

async function varrer(buf: Uint8Array, o: Opcoes) {
  const alvo = o.perfil.arquivo_padrao || 'LancamentoContabil.csv'
  const base = alvo.replace(/\.[^.]+$/, '').toLowerCase()
  let converte: ReturnType<typeof fazConverter> | null = null
  let erroCab: RazaoZipErro | null = null
  let lidas = 0
  const contagem = new Map<number, number>()
  const coletado = new Map<number, LinhaRazao[]>()

  const csv = new CsvStream(c => {
    if (!converte) {
      if (erroCab) return
      const faltando = conferirColunas(o.perfil, c)
      if (faltando.length) {
        erroCab = new RazaoZipErro(
          `O arquivo não tem a(s) coluna(s) ${faltando.join(', ')} que o perfil "${o.perfil.nome}" espera.`, c)
        return
      }
      converte = fazConverter(o.perfil, c)
      return
    }
    const x = converte(c)
    if (!x) return
    const k = x.ano * 100 + x.mes
    if (o.apenas && o.apenas.size && !o.apenas.has(k)) return
    contagem.set(k, (contagem.get(k) || 0) + 1)
    if (o.coletar) {
      let arr = coletado.get(k); if (!arr) { arr = []; coletado.set(k, arr) }
      arr.push(x.linha)
    }
    if ((++lidas & 0x3fff) === 0) o.onProgresso?.(lidas)   // a cada 16 mil
  })

  // ⚠ O nome dentro do zip pode vir com pasta na frente, e a caixa varia entre
  // quem gera o arquivo. Casar pelo FIM do caminho, sem caixa.
  await lerEntrada(buf,
    nome => nome.toLowerCase().replace(/\\/g, '/').split('/').pop()?.startsWith(base) ?? false,
    (chunk, fim) => {
      csv.push(dec.decode(chunk, { stream: !fim }))
      if (fim) csv.fim()
    })

  if (erroCab) throw erroCab
  if (!converte) throw new RazaoZipErro('O arquivo do razão veio vazio ou sem cabeçalho.')
  o.onProgresso?.(lidas)
  return { contagem, coletado }
}

/** 1ª passada: o que existe no arquivo, por competência. */
export async function inventariarRazao(buf: Uint8Array, perfil: PerfilRazao,
                                       onProgresso?: (n: number) => void): Promise<Competencia[]> {
  const { contagem } = await varrer(buf, { perfil, onProgresso })
  return [...contagem.entries()]
    .map(([k, linhas]) => ({ ano: Math.floor(k / 100), mes: k % 100, linhas }))
    // ⚠ CRONOLÓGICO. Inverter parecia resolver "o mês de hoje está no fim da
    // lista" e põe coisa pior no topo: o razão traz PROVISÃO ADIANTADA —
    // jan/27 a jul/27 com 14, 14, 10, 4, 4, 4 e 4 lançamentos —, então o
    // decrescente abre com sete competências de resíduo. Quem resolve é a tela,
    // rolando até o mês corrente.
    .sort((a, b) => (a.ano - b.ano) || (a.mes - b.mes))
}

/** 2ª passada: as linhas das competências escolhidas, agrupadas por mês. */
export async function extrairRazao(buf: Uint8Array, perfil: PerfilRazao, comps: Competencia[],
                                   onProgresso?: (n: number) => void) {
  const apenas = new Set(comps.map(c => c.ano * 100 + c.mes))
  const { coletado } = await varrer(buf, { perfil, apenas, coletar: true, onProgresso })
  return [...coletado.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([k, linhas]) => ({
      ano: Math.floor(k / 100), mes: k % 100,
      nome: `lancamentos_${Math.floor(k / 100)}_${String(k % 100).padStart(2, '0')}`,
      linhas,
    }))
}
