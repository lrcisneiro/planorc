import { useEffect, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

// Contexto compartilhado das telas de Posto de trabalho (os PILLs 1..6).
// Mantém os parâmetros de tela (versão, filtros de empresa/filial/CC e competência)
// ENTRE as páginas e persiste em localStorage — não zera ao trocar de pill nem ao
// sair/voltar da seção. Mesma ideia dos presets de filtro dos relatórios
// (`planorc_filtro_<id>`), mas com uma chave única para toda a seção de postos.
export type PostoCtx = {
  versaoId: string
  empresaSel: string[]
  filialSel: string[]
  ccSel: string[]
  areaSel: string[]
  divisaoSel: string[]
  buSel: string[]
  compSel: string
}

const KEY = 'planorc_postos_ctx'

function read(): Partial<PostoCtx> {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} }
}
function patch(p: Partial<PostoCtx>) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...read(), ...p })) } catch { /* ignora quota/priv */ }
}

// Preferência de tela persistida em localStorage por chave própria (NÃO
// compartilhada entre pills) — para toggles de visão como modo/agrupamento.
// Assinatura igual a useState.
export function useLocalPref<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [v, setV] = useState<T>(() => {
    try { const s = localStorage.getItem(key); return s !== null ? (JSON.parse(s) as T) : initial } catch { return initial }
  })
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* ignora */ } }, [key, v])
  return [v, setV]
}

// useState que espelha um campo do contexto compartilhado: inicializa do
// localStorage (se houver) e grava a cada mudança. Assinatura igual a useState.
export function usePostoCtx<K extends keyof PostoCtx>(key: K, initial: PostoCtx[K]): [PostoCtx[K], Dispatch<SetStateAction<PostoCtx[K]>>] {
  const [v, setV] = useState<PostoCtx[K]>(() => {
    const c = read()
    return (c[key] !== undefined ? c[key] : initial) as PostoCtx[K]
  })
  useEffect(() => { patch({ [key]: v } as Partial<PostoCtx>) }, [key, v])
  return [v, setV]
}
