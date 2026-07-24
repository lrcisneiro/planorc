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
  const [v, setV] = useState<T>(() => {
    try { const s = localStorage.getItem(key); return s !== null ? (JSON.parse(s) as T) : initial } catch { return initial }
  })
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* ignora quota/priv */ } }, [key, v])
  return [v, setV]
}
