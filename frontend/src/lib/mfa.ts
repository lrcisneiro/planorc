import { supabase } from './supabase'

// ============================================================
// Segundo fator (TOTP) — a camada fina sobre `supabase.auth.mfa`.
//
// ⚠ O MECANISMO QUE FAZ ISTO VALER É O **AAL**, não um papel nem uma flag.
// Quem tem fator VERIFICADO passa a ter `nextLevel = 'aal2'`; enquanto não
// responder ao desafio, fica em `aal1`. Então "exigir o segundo fator de quem
// inscreveu" não é uma regra que eu escrevo: é consequência de inscrever.
// Por isso a adoção pode ser voluntária sem ser frouxa — não existe estado em
// que alguém tenha fator e entre sem ele.
//
// ⚠ O SUPABASE NÃO TEM CÓDIGOS DE RECUPERAÇÃO. Eu disse que teria e estava
// errado. A recuperação real é **um segundo fator inscrito** (o autenticador
// do celular mais o do gerenciador de senhas, p.ex.); sem ele, perder o
// aparelho significa precisar de alguém com acesso ao console do Supabase para
// remover o fator. A tela diz isso antes de inscrever, não depois.
//
// ⚠ Fator NÃO verificado é lixo de tentativa interrompida: quem abre o QR e
// fecha a aba deixa um `unverified` para trás. Ele não protege nada e, pior,
// aparece na lista como se protegesse. `limparPendentes` os remove.
// ============================================================

export type Fator = { id: string; friendly_name?: string | null; status: string; created_at?: string }

/** Fatores TOTP de quem está logado, já separados por estado. */
export async function listarFatores(): Promise<{ verificados: Fator[]; pendentes: Fator[] }> {
  const { data, error } = await supabase.auth.mfa.listFactors()
  if (error) throw error
  const todos = ((data?.totp ?? []) as Fator[])
  return {
    verificados: todos.filter(f => f.status === 'verified'),
    pendentes: todos.filter(f => f.status !== 'verified'),
  }
}

/**
 * Nível da sessão. `precisaDesafio` é verdadeiro quando a pessoa TEM fator
 * verificado e ainda não respondeu — é o único teste que o login precisa fazer.
 */
export async function nivel(): Promise<{ atual: string | null; alvo: string | null; precisaDesafio: boolean }> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (error) throw error
  const atual = data?.currentLevel ?? null
  const alvo = data?.nextLevel ?? null
  return { atual, alvo, precisaDesafio: alvo === 'aal2' && atual === 'aal1' }
}

/** Começa a inscrição: devolve o QR (SVG embutido) e o segredo para digitação manual. */
export async function inscrever(apelido: string) {
  // Apelido repetido é recusado pelo servidor; o sufixo evita erro bobo em quem
  // inscreve o segundo aparelho e reusa o nome sem perceber.
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: apelido })
  if (error) throw error
  return { fatorId: data.id, qr: data.totp.qr_code, segredo: data.totp.secret, uri: data.totp.uri }
}

/** Confirma a inscrição com o primeiro código. Só aqui o fator vira `verified`. */
export async function confirmarInscricao(fatorId: string, codigo: string) {
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: fatorId, code: codigo.trim() })
  if (error) throw error
}

/** Responde ao desafio no login. Mesma chamada — o que muda é o momento. */
export async function responderDesafio(fatorId: string, codigo: string) {
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: fatorId, code: codigo.trim() })
  if (error) throw error
}

/**
 * Remove um fator. ⚠ Exige sessão em aal2 — ou seja, **só quem acabou de provar
 * o segundo fator pode tirá-lo**. É o que impede que uma sessão roubada em aal1
 * desative a proteção.
 */
export async function remover(fatorId: string) {
  const { error } = await supabase.auth.mfa.unenroll({ factorId: fatorId })
  if (error) throw error
}

/** Apaga inscrições abandonadas antes de começar outra. */
export async function limparPendentes() {
  const { pendentes } = await listarFatores()
  for (const f of pendentes) {
    try { await supabase.auth.mfa.unenroll({ factorId: f.id }) } catch { /* não bloqueia */ }
  }
}

/** Mensagem de erro legível. O retorno cru do GoTrue é inglês técnico. */
export function erroLegivel(e: any): string {
  const m = String(e?.message || e || '').toLowerCase()
  if (m.includes('invalid totp') || m.includes('invalid code') || m.includes('invalid_code'))
    return 'Código incorreto. Confira se o relógio do aparelho está certo — o TOTP depende da hora.'
  if (m.includes('expired')) return 'O código expirou. Use o próximo que o aplicativo mostrar.'
  if (m.includes('rate') || m.includes('too many')) return 'Tentativas demais. Espere um minuto e tente de novo.'
  if (m.includes('aal2') || m.includes('assurance'))
    return 'Esta ação exige que você tenha acabado de confirmar o segundo fator. Saia e entre de novo.'
  if (m.includes('factor') && m.includes('exist')) return 'Já existe um fator com esse nome. Use outro apelido.'
  return e?.message || 'Não foi possível concluir.'
}
