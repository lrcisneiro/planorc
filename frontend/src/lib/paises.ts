// Catálogo leve de países (código ISO-2 → nome PT-BR). Usado no cadastro de
// empresa (país da unidade) e no catálogo de verbas (país da regra de encargo).
// Ver docs/DESIGN_posto_trabalho.md · país na folha (schema_v3_074).

export const PAISES: { codigo: string; nome: string }[] = [
  { codigo: 'BR', nome: 'Brasil' },
  { codigo: 'PY', nome: 'Paraguai' },
  { codigo: 'BO', nome: 'Bolívia' },
  { codigo: 'AR', nome: 'Argentina' },
  { codigo: 'UY', nome: 'Uruguai' },
  { codigo: 'CL', nome: 'Chile' },
  { codigo: 'PE', nome: 'Peru' },
  { codigo: 'CO', nome: 'Colômbia' },
  { codigo: 'MX', nome: 'México' },
  { codigo: 'US', nome: 'EUA' },
  { codigo: 'PT', nome: 'Portugal' },
]

export const paisNome = (cod: string | null | undefined): string =>
  cod ? (PAISES.find(p => p.codigo === cod)?.nome || cod) : ''
