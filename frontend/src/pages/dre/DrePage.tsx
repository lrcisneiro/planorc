import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

interface Empresa {
  id: string
  codigo: string
  descricao: string
}

export default function DrePage() {
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    async function buscarEmpresas() {
      const { data, error } = await supabase
        .from('empresa')
        .select('*')
        .order('codigo')
      if (error) setErro(error.message)
      else setEmpresas(data || [])
      setLoading(false)
    }
    buscarEmpresas()
  }, [])

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold text-gray-800 mb-1">DRE — Orçado × Realizado</h1>
      <p className="text-gray-500 text-sm mb-6">Teste de conexão com Supabase</p>
      {loading && <p className="text-gray-400">Carregando...</p>}
      {erro && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4">
          <strong>Erro:</strong> {erro}
        </div>
      )}
      {!loading && !erro && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <p className="text-sm text-green-600 font-medium mb-4">
            ✅ Supabase conectado! {empresas.length} empresas encontradas.
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left py-2 text-gray-500 font-medium">Código</th>
                <th className="text-left py-2 text-gray-500 font-medium">Empresa</th>
              </tr>
            </thead>
            <tbody>
              {empresas.map(e => (
                <tr key={e.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-2 text-gray-500">{e.codigo}</td>
                  <td className="py-2 text-gray-800">{e.descricao}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
