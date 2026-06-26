import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { CAP_BY_KEY } from '../lib/capacidades'
import type { Papel } from '../lib/capacidades'

// Resolve a permissão efetiva de cada capacidade:
//   override por usuário (futuro)  >  padrão do papel  >  liberado (se não catalogado)
export function useCapacidades() {
  const [papel, setPapel] = useState<Papel>('viewer')
  const [overrides] = useState<Record<string, boolean>>({}) // próximo incremento: user_acesso_funcao
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('user_tenant').select('role').then(({ data }) => {
      setPapel(((data?.[0]?.role as Papel) ?? 'viewer'))
      setLoading(false)
    })
  }, [])

  const can = (key: string): boolean => {
    if (key in overrides) return overrides[key]
    const cap = CAP_BY_KEY[key]
    if (!cap) return true            // não catalogado = liberado (não bloqueia o que ainda não foi mapeado)
    return cap.padrao[papel] ?? false
  }

  return { papel, can, loading }
}
