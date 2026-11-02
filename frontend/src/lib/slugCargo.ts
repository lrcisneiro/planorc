// Código de cargo a partir do nome.
//
// Mora aqui, e não na tela, porque DUAS coisas geram cargo: a importação de
// postos do RH (cria o que não existe) e a aba Cargos (criação à mão). Com duas
// regras, o mesmo nome vira dois códigos diferentes — e `cargo` tem unique em
// (tenant_id, codigo), então a divergência não dá erro: dá cargo duplicado.
//
// Sem acento, só A-Z0-9, o resto vira `_`, cortado em 28. O ERP trunca o NOME
// em 20 caracteres, então o código ser maior não atrapalha.
export const slugCargo = (n: string) =>
  n.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
   .replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 28) || 'CARGO'
