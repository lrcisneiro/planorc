// ============================================================
// Perfil de importação — o de-para entre o arquivo de UM ERP e os campos que o
// Planorc entende.
//
// Por que existe: hoje cada importador reconhece as colunas do jeito que o
// Protheus desta instalação as nomeia. Isso funciona e não é sustentável — a
// aplicação precisa receber de mais de um ERP, e nomes de coluna são a primeira
// coisa que muda entre eles (e entre versões do mesmo).
//
// O perfil declara, por campo, os NOMES ACEITOS. Trocar de ERP passa a ser
// acrescentar um perfil, não editar a tela. O casamento é tolerante ao que
// sempre varia — acento, caixa, espaço repetido, dois-pontos no fim — e
// intolerante ao resto, porque adivinhar coluna é como se importa a errada.
// ============================================================

export type CampoPerfil = {
  campo: string            // nome interno
  aliases: string[]        // como o ERP pode chamar
  obrigatorio?: boolean
  ajuda?: string
}
export type PerfilImport = {
  id: string
  nome: string             // "Protheus · Relação de Funcionários"
  origem: string           // de onde se extrai, para quem for refazer o export
  campos: CampoPerfil[]
}

const norm = (s: string) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export type Mapeamento = {
  /** campo interno → cabeçalho real do arquivo */
  de: Record<string, string>
  faltando: string[]
  ignoradas: string[]
}

export function mapearColunas(perfil: PerfilImport, cabecalhos: string[]): Mapeamento {
  const porNorm = new Map(cabecalhos.map(h => [norm(h), h]))
  const de: Record<string, string> = {}
  const faltando: string[] = []
  for (const c of perfil.campos) {
    const achado = c.aliases.map(norm).find(a => porNorm.has(a))
    if (achado) de[c.campo] = porNorm.get(achado)!
    else if (c.obrigatorio) faltando.push(c.campo)
  }
  const usados = new Set(Object.values(de))
  return { de, faltando, ignoradas: cabecalhos.filter(h => h && !usados.has(h)) }
}

/** Aplica o mapeamento a uma linha, devolvendo os campos internos. */
export const aplicar = (m: Mapeamento, linha: Record<string, any>) =>
  Object.fromEntries(Object.entries(m.de).map(([campo, col]) => [campo, linha[col]]))
