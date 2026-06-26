import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Regra por dimensão: allow (vazio = todos) menos deny (exclusões).
type Rule = { allow: string[]; deny: string[] }
type RuleMap = Record<string, Rule>  // dimensao → Rule

export type UserAccess = {
  ver: RuleMap
  orcar: RuleMap
  rules: Record<string, string[]>   // compat: allow-list do escopo VER por dimensão
  isAdmin: boolean
  loading: boolean
  canSee:  (dimensao: string, id: string) => boolean
  canEdit: (dimensao: string, id: string) => boolean
  filterList: <T extends { id: string }>(dimensao: string, list: T[]) => T[]
  filterEdit: <T extends { id: string }>(dimensao: string, list: T[]) => T[]
}

// passa no escopo? nega explícito > allow-list (vazio = tudo)
function pass(rule: Rule | undefined, id: string): boolean {
  if (!rule) return true
  if (rule.deny.includes(id)) return false
  if (rule.allow.length === 0) return true
  return rule.allow.includes(id)
}

export function useUserAccess(): UserAccess {
  const [ver, setVer] = useState<RuleMap>({})
  const [orcar, setOrcar] = useState<RuleMap>({})
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      supabase.from('user_acesso_regra').select('dimensao,valor_ids,escopo,negados'),
      supabase.from('user_tenant').select('role'),
    ]).then(([{ data: ruleData }, { data: tenantData }]) => {
      const v: RuleMap = {}, o: RuleMap = {}
      for (const r of (ruleData as any[]) || []) {
        const rule: Rule = { allow: r.valor_ids || [], deny: r.negados || [] }
        if (r.escopo === 'ORCAR') o[r.dimensao] = rule
        else v[r.dimensao] = rule   // escopo padrão = VER
      }
      setVer(v); setOrcar(o)
      setIsAdmin((tenantData?.[0]?.role ?? '') === 'admin')
      setLoading(false)
    })
  }, [])

  // Admin ignora todo o escopo de dados (vê e orça tudo), independente de regras herdadas.
  // VER = consultar
  const canSee = (dimensao: string, id: string): boolean => isAdmin || pass(ver[dimensao], id)
  // ORÇAR = editar. Sem regra ORCAR para a dimensão → herda o escopo de VER.
  const canEdit = (dimensao: string, id: string): boolean => isAdmin || pass(orcar[dimensao] ?? ver[dimensao], id)

  const filterList = <T extends { id: string }>(dimensao: string, list: T[]): T[] => list.filter(i => canSee(dimensao, i.id))
  const filterEdit = <T extends { id: string }>(dimensao: string, list: T[]): T[] => list.filter(i => canEdit(dimensao, i.id))

  const rules: Record<string, string[]> = Object.fromEntries(Object.entries(ver).map(([d, r]) => [d, r.allow]))

  return { ver, orcar, rules, isAdmin, loading, canSee, canEdit, filterList, filterEdit }
}
