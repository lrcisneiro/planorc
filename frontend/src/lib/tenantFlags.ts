import { useEffect, useState } from 'react'
import { supabase, TENANT_ID } from './supabase'

// Flags de funcionalidade por TENANT — o que existe nesta instalação, não quem
// pode ver (isso é CAPACIDADES). Ex.: apontar horas em projeto e gerar verba da
// folha por CC é específico de quem opera por projeto; em outro tenant a pill
// não deve nem aparecer.
//
// A leitura é assíncrona, mas navegação não pode piscar: o último valor fica em
// localStorage e é devolvido de imediato na carga seguinte, e o banco confirma
// depois. Se a flag mudar, a tela se ajusta no próximo render — não vale uma
// tela em branco esperando um boolean.
export type TenantFlags = { usa_apontamento: boolean }

const COLS = 'usa_apontamento'
const KEY = 'planorc_tenant_flags'
const PADRAO: TenantFlags = { usa_apontamento: false }

function cache(): TenantFlags {
  try { return { ...PADRAO, ...JSON.parse(localStorage.getItem(KEY) || '{}') } } catch { return PADRAO }
}

let pendente: Promise<TenantFlags> | null = null

export function carregarFlags(): Promise<TenantFlags> {
  if (!pendente) {
    pendente = (async () => {
      try {
        const { data } = await supabase.from('tenant').select(COLS).eq('id', TENANT_ID).maybeSingle()
        const f: TenantFlags = { ...PADRAO, ...(data as any || {}) }
        try { localStorage.setItem(KEY, JSON.stringify(f)) } catch { /* ignora quota/priv */ }
        return f
      } catch {
        return cache()   // coluna ainda sem migration ou rede fora: fica com o que já se sabia
      }
    })()
  }
  return pendente
}

// Chamar depois de mudar uma flag em Configurações — senão a navegação segue
// mostrando o que o cache guardou até a próxima carga da página.
export function limparCacheFlags() {
  pendente = null
  try { localStorage.removeItem(KEY) } catch { /* ignora quota/priv */ }
}

export function useTenantFlags(): TenantFlags {
  const [f, setF] = useState<TenantFlags>(cache)
  useEffect(() => { let vivo = true; carregarFlags().then(x => { if (vivo) setF(x) }); return () => { vivo = false } }, [])
  return f
}
