import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ⚠⚠ O LINK É PARA OUTRA PESSOA — `localhost` nunca serve.
// O destino vinha de `window.location.origin` do ADMIN, então convidar com o
// `npm run dev` aberto mandava `http://localhost:5173/nova-senha` para o
// convidado, que não tem como abrir. Aconteceu em 09/nov e não dá erro: o
// e-mail sai, a tela diz "enviado", e só a pessoa do outro lado descobre.
// Por isso a decisão do endereço mora AQUI, no servidor: quem clica não
// precisa lembrar de onde está, e a regra vale para qualquer caminho que
// chame a função. `APP_URL` é a variável de ambiente da Edge Function.
const ehLocal = (u: string) =>
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])([:/]|$)/i.test(u || '')

function destinoDoLink(redirectTo: string, permitirLocal: boolean) {
  const app = (Deno.env.get('APP_URL') || '').replace(/\/+$/, '')
  // Teste local é legítimo, mas tem de ser PEDIDO: a tela mostra a opção só
  // quando o admin está em localhost, e ela não sobrevive a um descuido.
  if (permitirLocal && redirectTo) return { destino: redirectTo, aviso: '' }
  if (redirectTo && !ehLocal(redirectTo)) return { destino: redirectTo, aviso: '' }
  if (app) return { destino: `${app}/nova-senha`, aviso: '' }
  // Sem APP_URL não há para onde escapar. Manda assim e DIZ — melhor um aviso
  // visível que um link quebrado descoberto pelo convidado.
  return {
    destino: redirectTo || '',
    aviso: 'APP_URL não está configurada na Edge Function: o link aponta para o endereço de quem convidou. '
         + 'Defina APP_URL (ex.: https://planorc.com) em Supabase → Edge Functions → Secrets.',
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('Não autenticado')

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // Verifica identidade do chamador
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    if (authError || !user) throw new Error('Token inválido')

    // Verifica se é admin do tenant
    const { data: tenantRow } = await supabaseAdmin
      .from('user_tenant')
      .select('tenant_id, role')
      .eq('user_id', user.id)
      .single()

    if (!tenantRow || tenantRow.role !== 'admin') {
      throw new Error('Somente administradores podem criar usuários')
    }

    const body = await req.json()
    const { email, role = 'member', redirectTo, permitirLocal = false, acao = 'convidar', user_id } = body
    const { destino, aviso } = destinoDoLink(redirectTo, !!permitirLocal)

    // ── Reenviar ────────────────────────────────────────────────────────────
    // Dois estados, dois e-mails diferentes — e confundi-los é o que faz o
    // reenvio "não funcionar":
    //   e-mail NÃO confirmado = nunca abriu o convite. O GoTrue reenvia o
    //     convite para quem está nesse estado (só recusa quem já confirmou).
    //   e-mail confirmado = abriu, mas não definiu senha (ou esqueceu). Aí o
    //     convite é recusado e o que vale é a recuperação de senha, que é a
    //     mesma coisa que o "Esqueci minha senha" da tela de login.
    // `precisa_senha` vive no user_metadata, então a tela de primeiro acesso
    // continua aparecendo em qualquer um dos dois caminhos.
    if (acao === 'reenviar') {
      if (!user_id) throw new Error('user_id obrigatório para reenviar')

      // ⚠ Admin do tenant A não reenvia convite de usuário do tenant B: sem
      // esta conferência, o `user_id` vem do cliente e dá para pedir qualquer um.
      const { data: alvoTenant } = await supabaseAdmin
        .from('user_tenant')
        .select('user_id')
        .eq('user_id', user_id)
        .eq('tenant_id', tenantRow.tenant_id)
        .maybeSingle()
      if (!alvoTenant) throw new Error('Usuário não pertence a este tenant')

      const { data: alvo, error: getErr } = await supabaseAdmin.auth.admin.getUserById(user_id)
      if (getErr || !alvo?.user?.email) throw new Error(getErr?.message || 'Usuário não encontrado')
      const destinatario = alvo.user.email

      if (!alvo.user.email_confirmed_at) {
        const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(destinatario, {
          redirectTo: destino,
          data: { precisa_senha: true },
        })
        if (error) throw new Error(error.message)
        return new Response(JSON.stringify({ success: true, tipo: 'convite', email: destinatario, destino, aviso }), {
          headers: { ...cors, 'Content-Type': 'application/json' },
        })
      }

      // Recuperação só existe no endpoint público — o cliente admin não a
      // dispara. Daí o cliente anônimo aqui dentro: é o mesmo caminho do
      // "Esqueci minha senha", com o destino decidido pelo servidor.
      const supabaseAnon = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { auth: { autoRefreshToken: false, persistSession: false } }
      )
      const { error: recErr } = await supabaseAnon.auth.resetPasswordForEmail(destinatario, { redirectTo: destino })
      if (recErr) throw new Error(recErr.message)
      return new Response(JSON.stringify({ success: true, tipo: 'recuperacao', email: destinatario, destino, aviso }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // ── Convidar ────────────────────────────────────────────────────────────
    if (!email) throw new Error('Email obrigatório')

    // `precisa_senha` vai no user_metadata e é o que obriga a definir senha no
    // primeiro acesso. O link do convite AUTENTICA, e o convidado nasce sem
    // senha — sem esta marca ele entraria direto e, quando o link expirasse,
    // ficaria sem forma de voltar. A marca vem do servidor de propósito:
    // detectar pelo `type=invite` da URL não sobreviveria a um F5.
    const { data: invited, error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      email,
      { redirectTo: destino, data: { precisa_senha: true } }
    )
    if (inviteErr) {
      // A mensagem crua ("already been registered") não diz o que fazer, e o
      // que fazer é justamente o botão ao lado.
      const m = inviteErr.message || ''
      throw new Error(/already.*registered|already exists/i.test(m)
        ? 'Este e-mail já tem cadastro. Use o botão "Reenviar" na linha dele para mandar um novo link.'
        : m)
    }

    // Adiciona ao tenant
    const { error: tenantErr } = await supabaseAdmin
      .from('user_tenant')
      .upsert(
        { user_id: invited.user.id, tenant_id: tenantRow.tenant_id, role },
        { onConflict: 'user_id,tenant_id' }
      )
    if (tenantErr) throw new Error(tenantErr.message)

    return new Response(JSON.stringify({ success: true, tipo: 'convite', email, destino, aviso }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
