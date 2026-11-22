// Teste do corte de página do PDF. Não há runner no projeto — roda à mão:
//
//   npx esbuild src/lib/exportarDash.ts --bundle --format=esm --platform=node \
//     --outfile=/tmp/exp.mjs && node src/lib/exportarDash.teste.mjs
//
// (ajuste o import abaixo para /tmp/exp.mjs)
//
// ⚠ Existe porque a lógica de corte ERROU em dois dos oito casos na primeira
// escrita, e nenhum dos dois aparecia lendo o código: o bloco maior que a
// página fazia a página anterior terminar em 100px e o card era partido do
// mesmo jeito. Lógica que decide onde cortar papel merece casos escritos.
import { cortesDePagina as C } from '/tmp/exp.mjs'
const ok = (nome, cond, extra='') => console.log(`${cond ? '✓' : '✗ FALHOU'}  ${nome}${extra?' · '+extra:''}`)
const alturas = c => c.slice(1).map((v,i)=>Math.round(v-c[i]))

// 1 · sem blocos: fatias cheias, como antes
let c = C(1000, 300, [])
ok('sem blocos → fatias de 300', JSON.stringify(alturas(c))==='[300,300,300,100]', alturas(c))

// 2 · card atravessando o corte → recua para o topo dele
c = C(1000, 300, [{y0:250,y1:380}])
ok('card em 250-380 → 1ª página termina em 250', c[1]===250, 'cortes='+c.join(','))

// 3 · card MAIOR que a página → corta cego (empurrar não resolve)
c = C(1000, 300, [{y0:100,y1:700}])
ok('card maior que a página → corte cego em 300', c[1]===300, 'cortes='+c.join(','))

// 4 · recuo abaixo do piso (25%) → aceita o corte cego
c = C(1000, 300, [{y0:60,y1:400}])
ok('recuo < piso → não recua', c[1]===300, 'cortes='+c.join(','))

// 5 · vários cards em sequência
const B5 = [{y0:0,y1:120},{y0:130,y1:280},{y0:290,y1:420},{y0:430,y1:560},{y0:570,y1:700},{y0:710,y1:840}]
c = C(1000, 300, B5)
ok('nenhum corte cai dentro de um card (todos cabem)',
   c.slice(1,-1).every(x => !B5.some(b => b.y0 < x-1 && b.y1 > x+1)), 'cortes='+c.join(','))

// 6 · cobre a altura toda, sem sobrepor nem perder faixa
c = C(1000, 300, [{y0:250,y1:380},{y0:600,y1:800}])
ok('começa em 0 e termina em h', c[0]===0 && c[c.length-1]===1000, 'cortes='+c.join(','))
ok('monotônico e sem fatia vazia', c.every((v,i)=>i===0||v>c[i-1]), 'cortes='+c.join(','))

// 7 · não trava
c = C(100000, 300, Array.from({length:400},(_,i)=>({y0:i*250, y1:i*250+240})))
ok('400 cards, sem loop infinito', c.length>1 && c[c.length-1]===100000, c.length+' páginas')
