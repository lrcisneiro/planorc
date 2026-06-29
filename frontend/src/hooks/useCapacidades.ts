import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { CAP_BY_KEY } from '../lib/capacidades'
import type { Papel } from '../lib/capacidades'

// Resolve a permissão efetiva de cada capacidade:
//   override por usuário (user_acesso_funcao)  >  padrão do papel  >  liberado (se não catalogado)
export function useCapacidades() {
  const [papel, setPapel] = useState<Papel>('viewer')
  const [overrides, setOverrides] = useState<Record<string, boolean>>({}) // override por usuário (user_acesso_funcao)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      const { data: aut } = await supabase.auth.getUser()
      const uid = aut.user?.id
      if (!uid) { setLoading(false); return }
      const [{ data: tenantData }, { data: ovr }] = await Promise.all([
        supabase.from('user_tenant').select('role').eq('user_id', uid),
        supabase.from('user_acesso_funcao').select('capacidade,permitido').eq('user_id', uid),
      ])
      setPapel(((tenantData?.[0]?.role as Papel) ?? 'viewer'))
      const o: Record<string, boolean> = {}
      for (const r of (ovr as any[]) || []) o[r.capacidade] = r.permitido
      setOverrides(o)
      setLoading(false)
    })()
  }, [])

  const can = (key: string): boolean => {
    // Blindagem: admin nunca se tranca pra fora de Configurações, mesmo com override.
    if (key === 'menu.config' && papel === 'admin') return true
    if (key in overrides) return overrides[key]
    const cap = CAP_BY_KEY[key]
    if (!cap) return true            // não catalogado = liberado (não bloqueia o que ainda não foi mapeado)
    return cap.padrao[papel] ?? false
  }

  return { papel, can, loading }
}
