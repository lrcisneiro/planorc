import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

type AccessRules = Record<string, string[]>  // dimensao → IDs permitidos (vazio = tudo)

export type UserAccess = {
  rules: AccessRules
  isAdmin: boolean
  loading: boolean
  canSee: (dimensao: string, id: string) => boolean
  filterList: <T extends { id: string }>(dimensao: string, list: T[]) => T[]
}

export function useUserAccess(): UserAccess {
  const [rules, setRules] = useState<AccessRules>({})
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      supabase.from('user_acesso_regra').select('dimensao,valor_ids'),
      supabase.from('user_tenant').select('role'),
    ]).then(([{ data: ruleData }, { data: tenantData }]) => {
      const ruleMap: AccessRules = {}
      for (const r of ruleData || []) {
        ruleMap[r.dimensao] = r.valor_ids || []
      }
      setRules(ruleMap)
      setIsAdmin((tenantData?.[0]?.role ?? '') === 'admin')
      setLoading(false)
    })
  }, [])

  const canSee = (dimensao: string, id: string): boolean => {
    const allowed = rules[dimensao]
    if (!allowed || allowed.length === 0) return true
    return allowed.includes(id)
  }

  const filterList = <T extends { id: string }>(dimensao: string, list: T[]): T[] => {
    const allowed = rules[dimensao]
    if (!allowed || allowed.length === 0) return list
    return list.filter(item => allowed.includes(item.id))
  }

  return { rules, isAdmin, loading, canSee, filterList }
}
