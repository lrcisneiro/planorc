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
export const pessoaChave = (p: { id: string; nome?: string | null; matricula?: string | null; funcionario_id?: string | null }) =>
  p.funcionario_id
  || (p.nome || '').trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  || (p.matricula || '').trim()
  || `__posto_${p.id}`
