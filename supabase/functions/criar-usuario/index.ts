import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

    const { email, role = 'member', redirectTo } = await req.json()
    if (!email) throw new Error('Email obrigatório')

    // Convida o usuário (envia email com link de acesso)
    const { data: invited, error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      email,
      { redirectTo: redirectTo || Deno.env.get('APP_URL') || '' }
    )
    if (inviteErr) throw new Error(inviteErr.message)

    // Adiciona ao tenant
    const { error: tenantErr } = await supabaseAdmin
      .from('user_tenant')
      .upsert(
        { user_id: invited.user.id, tenant_id: tenantRow.tenant_id, role },
        { onConflict: 'user_id,tenant_id' }
      )
    if (tenantErr) throw new Error(tenantErr.message)

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
