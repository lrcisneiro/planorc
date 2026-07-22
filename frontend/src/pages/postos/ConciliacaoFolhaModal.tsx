import { X } from 'lucide-react'
import { ConciliacaoFolha } from './ConciliacaoFolha'
import type { ConcilParams } from './ConciliacaoFolha'

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

// Conciliação como MODAL — usado pelo drill do DRE (não remonta o DRE ao fechar).
export function ConciliacaoFolhaModal({ params, onClose }: { params: ConcilParams; onClose: () => void }) {
  const periodo = params.meses.map(m => `${MESES[m.mes - 1]}/${String(m.ano).slice(2)}`).join(', ')
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 100, padding: '32px 16px', overflow: 'auto' }} onClick={onClose}>
      <div style={{ background: 'var(--bg)', border: '1px solid var(--border-strong)', borderRadius: 14, width: 'min(1000px, 98vw)', boxShadow: '0 24px 60px rgba(0,0,0,0.45)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Conciliação de folha — {params.titulo}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Orçado (postos aplicados) × Realizado (folha), por posto. Versão <b>{params.versaoLabel}</b> · competência <b>{periodo}</b>.</div>
          </div>
          <button onClick={onClose} title="Voltar ao DRE" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)' }}><X size={20} /></button>
        </div>
        <div style={{ padding: 20 }}>
          <ConciliacaoFolha params={params} />
        </div>
      </div>
    </div>
  )
}
