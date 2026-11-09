import { useEffect, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

// Preferência de tela persistida em localStorage — os parâmetros que o usuário
// escolhe (plano, relatório, versão, agrupamento…) não voltam ao default a cada
// visita. Assinatura igual a useState.
//
// Convenção de chave: 'planorc_<tela>_<campo>' (ex.: 'planorc_amarracao_plano').
// Para parâmetros COMPARTILHADOS entre várias telas de uma seção, ver usePostoCtx
// em lib/postoCtx.ts, que guarda tudo num objeto só.
export function useLocalPref<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const ler = (k: string): T => {
    try { const s = localStorage.getItem(k); return s !== null ? (JSON.parse(s) as T) : initial } catch { return initial }
  }
  const [v, setV] = useState<T>(() => ler(key))
  // ⚠⚠ CHAVE QUE MUDA TEM DE RELER. Várias telas montam a chave com o id da
  // rota (`planorc_orcarlinha_<relId>_empresa`), e trocar de relatório não
  // desmonta o componente — o lazy-init acima só roda na montagem. Sem isto o
  // estado do relatório A continuava em tela no B e o efeito abaixo o GRAVAVA
  // na chave do B, apagando a preferência que estava lá. Em silêncio: a tela
  // não tem como saber que aquele valor não era dali.
  const [keyAnterior, setKeyAnterior] = useState(key)
  if (key !== keyAnterior) { setKeyAnterior(key); setV(ler(key)) }
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* ignora quota/priv */ } }, [key, v])
  return [v, setV]
}
