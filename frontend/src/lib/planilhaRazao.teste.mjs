// Teste do leitor de planilha do realizado. Não há runner no projeto — à mão:
//
//   cd frontend
//   curl -sL https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js -o /tmp/xlsx.js
//   npx esbuild src/lib/planilhaRazao.ts --bundle --format=esm --platform=node --outfile=/tmp/plr.mjs
//   node src/lib/planilhaRazao.teste.mjs "$HOME/Downloads/pivot (7) (1).xlsx"
//
// ⚠ Existe por duas regras que ERRARAM na primeira escrita e não aparecem
// lendo o código:
//  · FUSO — o serial do Excel é data pura, e o SheetJS a materializa num Date
//    ora em meia-noite local, ora UTC. Em UTC−3, `getDate()` sobre a segunda
//    forma devolve o dia anterior: 01/jan/2026 vira 31/dez/2025 e o
//    lançamento troca de ANO. O sintoma seria um dezembro que ninguém importou.
//  · CÓDIGO COM ESPAÇO — a origem traz "2.20. 1001 REEMBOLSO"; partir no
//    primeiro espaço dá "2.20." e o import diz "conta não encontrada" sobre
//    uma conta que está no plano.
// A 2ª parte roda contra o ARQUIVO REAL quando o caminho é passado, porque
// contagem e soma que fecham com o medido é o que prova o conjunto.
import { readFileSync } from 'node:fs'
globalThis.XLSX = (await import('/tmp/xlsx.js')).default ?? globalThis.XLSX
const M = await import('/tmp/plr.mjs')

let falhas = 0
const ok = (nome, cond, extra = '') => {
  if (!cond) falhas++
  console.log(`${cond ? '✓' : '✗ FALHOU'}  ${nome}${extra ? ' · ' + extra : ''}`)
}
const d2 = n => String(n).padStart(2, '0')
const iso = p => p && `${p.ano}-${d2(p.mes)}-${d2(p.dia)}`

// ── 1 · fuso: as duas formas que o SheetJS produz ────────────────────────
ok('Date em meia-noite LOCAL → o próprio dia',
   iso(M.dePartes(new Date(2026, 0, 1))) === '2026-01-01', iso(M.dePartes(new Date(2026, 0, 1))))
ok('Date em meia-noite UTC → NÃO volta para 31/dez',
   iso(M.dePartes(new Date('2026-01-01T00:00:00Z'))) === '2026-01-01',
   iso(M.dePartes(new Date('2026-01-01T00:00:00Z'))))
ok('Date UTC no último dia do mês → não vaza para o mês seguinte',
   iso(M.dePartes(new Date('2026-10-31T00:00:00Z'))) === '2026-10-31',
   iso(M.dePartes(new Date('2026-10-31T00:00:00Z'))))
// ── 2 · data como texto, nos três formatos ──────────────────────────────
ok('texto 2026-01-31', iso(M.dePartes('2026-01-31')) === '2026-01-31')
ok('texto 31/01/2026', iso(M.dePartes('31/01/2026')) === '2026-01-31')
ok('texto 20260131',   iso(M.dePartes('20260131')) === '2026-01-31')
ok('vazio → nulo',     M.dePartes('') === null)
ok('lixo → nulo',      M.dePartes('mês que vem') === null)

// ── 3 · número ──────────────────────────────────────────────────────────
ok('number puro',        M.numero(-1472.4) === -1472.4)
ok('pt-BR 1.234,56',     M.numero('1.234,56') === 1234.56)
ok('en-US -1472.4',      M.numero('-1472.4') === -1472.4)
ok('milhar sem decimal NÃO vira 1234 errado', M.numero('1.472') === 1.472, String(M.numero('1.472')))
ok('vazio → 0',          M.numero('') === 0)

// ── 4 · código da conta ─────────────────────────────────────────────────
const P = {
  nome: 't', colunas: {}, conta_do_prefixo: true,
  conta_sem_codigo: { 'Receitas de Serviços': 'SC-RECEITAS-DE-SERVI-OS' },
}
ok('prefixo simples', M.contaDoCampo('1.11.1002 RECEITA RECORRENTE DE SERVIÇOS', P) === '1.11.1002')
ok('ESPAÇO dentro do código é removido',
   M.contaDoCampo('2.20. 1001 REEMBOLSO', P) === '2.20.1001', M.contaDoCampo('2.20. 1001 REEMBOLSO', P))
ok('código curto (8.01)', M.contaDoCampo('8.01 RETIRADAS SÓCIOS MENSAL', P) === '8.01')
ok('sem código → mapa explícito', M.contaDoCampo('Receitas de Serviços', P) === 'SC-RECEITAS-DE-SERVI-OS')
ok('sem código e fora do mapa → VAZIO, nunca inventado',
   M.contaDoCampo('Categoria Nova Qualquer', P) === '')

// ── 5 · contra o arquivo real ───────────────────────────────────────────
const arq = process.argv[2]
if (!arq) { console.log('\n(sem caminho do pivot: parte 5 não rodou)') }
else {
  const perfil = JSON.parse(readFileSync(new URL('./perfis/contaazul.json', import.meta.url), 'utf8'))
  const buf = new Uint8Array(readFileSync(arq))
  const inv = M.inventariarPlanilha(buf, perfil)
  const nLin = inv.comps.reduce((s, c) => s + c.linhas, 0)
  console.log('\n— arquivo real —')
  ok('1.953 lançamentos', nLin === 1953, String(nLin))
  ok('10 competências (jan–out/2026)', inv.comps.length === 10, String(inv.comps.length))
  ok('1ª competência é jan/2026 (cronológico)',
     inv.comps[0].ano === 2026 && inv.comps[0].mes === 1, `${inv.comps[0].mes}/${inv.comps[0].ano}`)
  ok('última é out/2026', inv.comps[9].mes === 10, String(inv.comps[9].mes))

  const lotes = M.extrairPlanilha(inv.linhas, inv.comps)
  const todas = lotes.flatMap(l => l.linhas)
  const soma = todas.reduce((s, r) => s + (r.credito - r.debito), 0)
  ok('crédito − débito = 153.996,56 (a soma do Valor)',
     Math.abs(soma - 153996.56) < 0.01, soma.toFixed(2))
  ok('nenhuma linha com débito E crédito juntos',
     !todas.some(r => r.debito > 0 && r.credito > 0))
  ok('despesa entra NEGATIVA (débito)',
     todas.some(r => r.debito > 0) && todas.filter(r => r.debito > 0).every(r => r.credito === 0))
  ok('empresa/filial/CC vêm dos fixos do perfil',
     todas.every(r => r.empresa_codigo === '35' && r.filial_codigo === '3501' && r.cc_codigo === '111'))
  ok('toda linha tem conta resolvida', todas.every(r => !!r.conta_codigo),
     `${todas.filter(r => !r.conta_codigo).length} sem conta`)
  const codigos = new Set(todas.map(r => r.conta_codigo))
  ok('56 contas distintas (51 com código + 5 SC-)', codigos.size === 56, String(codigos.size))
  ok('o código com espaço casa como 2.20.1001', codigos.has('2.20.1001'))
  ok('os 5 SC- aparecem', [...codigos].filter(c => c.startsWith('SC-')).length === 5)
  ok('data dentro da competência da própria linha',
     todas.every(r => r.data.startsWith(`${r.ano}-${d2(r.mes)}`)))
  ok('aviso de caixa × competência foi emitido', /juros|tarifa/i.test(inv.aviso), inv.aviso)
}

console.log(falhas ? `\n⛔ ${falhas} FALHA(S)` : '\n✅ PASSOU tudo')
process.exit(falhas ? 1 : 0)
