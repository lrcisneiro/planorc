// Quem é "uma pessoa" para efeito de headcount.
//
// O problema: `matricula` é por EMPRESA, não por pessoa. Quem tem pró-labore em
// mais de uma empresa do grupo ganha uma matrícula em cada, e contar matrícula
// distinta transforma um diretor em quatro — foi o que apareceu no CC 411
// Diretoria, onde 2 diretores viravam "7 pessoas".
//
// O que seria certo: um identificador de pessoa (CPF, ou `posto.funcionario_id`).
// `funcionario_id` existe na tabela e está **vazio em 100% dos 327 postos**, e
// CPF não vem no export do RH. Então sobra o NOME, que é o que um humano usa ao
// ler a lista — e, nesta base, 306 nomes distintos para 325 postos nomeados.
//
// ⚠ O que isso custa: **homônimos contam como uma pessoa só**. É um erro menor
// e na direção oposta ao de hoje (que infla), mas é erro. O conserto de verdade
// é popular `funcionario_id` na importação; quando isso acontecer, esta função
// passa a preferi-lo e o resto do app não muda.
//
// Vaga (posto sem nome e sem matrícula) conta sozinha: é uma cadeira a ocupar,
// não uma pessoa repetida.
type P = { id: string; nome?: string | null; matricula?: string | null; funcionario_id?: string | null }

const norm = (n?: string | null) =>
  (n || '').trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

export const pessoaChave = (p: P) =>
  p.funcionario_id || norm(p.nome) || (p.matricula || '').trim() || `__posto_${p.id}`

// ⚠⚠ MISTURAR TIPO DE CHAVE PARTE A PESSOA EM DUAS, e é o que acontecia desde
// que a v3_149 passou a popular `funcionario_id` — o comentário acima, que
// dizia "vazio em 100% dos postos", envelheceu e a precedência
// `funcionario_id || nome` deixou de ser segura.
//
// Medido no CC 411 (Diretoria): 13 postos, 5 pessoas, a tela dizia **8**.
// Dez postos tinham `funcionario_id` (chave = uuid) e três não (chave = nome),
// e os três eram os `SOCIO_0x`. Marco virava 2 chaves, Luis 2, Emerson 2.
//
// ⚠ **Corrigir o NOME não resolve**: `Luis Ricardo Cisneiro` e `Emerson Wagner`
// já batiam letra por letra com o nome do funcionário e contavam dobrado
// assim mesmo — uuid e texto nunca se encontram, por mais igual que o texto
// esteja. Quem resolve é olhar o CONJUNTO: quem tem id ensina o id a quem só
// tem nome.
//
// Use SEMPRE que for contar gente sobre uma lista. `pessoaChave` sozinha serve
// só quando o posto está isolado e não há lista a consultar.
export function resolverPessoas<T extends P>(postos: T[]): (p: P) => string {
  const AMBIGUO = '\u0000ambiguo'
  const idPorNome = new Map<string, string>()
  for (const p of postos) {
    if (!p.funcionario_id) continue
    const n = norm(p.nome); if (!n) continue
    const ja = idPorNome.get(n)
    // ⚠ Dois `funcionario_id` com o mesmo nome são HOMÔNIMOS de verdade: aí não
    // se colapsa nada, porque colapsar faria duas pessoas virarem uma — erro
    // pior que o que se está consertando.
    if (ja === undefined) idPorNome.set(n, p.funcionario_id)
    else if (ja !== p.funcionario_id) idPorNome.set(n, AMBIGUO)
  }
  return (p: P) => {
    if (p.funcionario_id) return p.funcionario_id
    const n = norm(p.nome)
    const id = n ? idPorNome.get(n) : undefined
    if (id && id !== AMBIGUO) return id          // o mesmo nome já tem id: use o id
    return n || (p.matricula || '').trim() || `__posto_${p.id}`
  }
}
