import { createClient } from 'npm:@supabase/supabase-js@2'

// Exclui um usuário do tenant e da autenticação.
//
// Precisa de service_role (auth.admin.deleteUser não existe no cliente), daí ser
// Edge Function. Espelha a validação de `criar-usuario`: só admin do tenant, e
// a identidade do chamador vem do token, nunca do corpo da requisição.
//
// É destrutivo e sem volta — por isso as três travas abaixo, que valem no
// servidor e não só na tela.

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

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    if (authError || !user) throw new Error('Token inválido')

    const { data: tenantRow } = await supabaseAdmin
      .from('user_tenant')
      .select('tenant_id, role')
      .eq('user_id', user.id)
      .single()

    if (!tenantRow || tenantRow.role !== 'admin') {
      throw new Error('Somente administradores podem excluir usuários')
    }

    const { user_id } = await req.json()
    if (!user_id) throw new Error('user_id obrigatório')

    // 1. Ninguém se exclui. Fora o susto, o admin perderia o próprio acesso no
    //    meio da operação e não teria como desfazer.
    if (user_id === user.id) throw new Error('Você não pode excluir o seu próprio usuário')

    // 2. O alvo tem de ser do MESMO tenant de quem está excluindo — senão um
    //    admin de um tenant apagaria usuário de outro.
    const { data: alvo } = await supabaseAdmin
      .from('user_tenant')
      .select('user_id, role')
      .eq('user_id', user_id)
      .eq('tenant_id', tenantRow.tenant_id)
      .maybeSingle()
    if (!alvo) throw new Error('Usuário não encontrado neste tenant')

    // 3. Não deixar o tenant sem admin: sem nenhum, ninguém mais gerencia
    //    usuários nem acessos, e só dá para destravar pelo SQL Editor.
    if (alvo.role === 'admin') {
      const { count } = await supabaseAdmin
        .from('user_tenant')
        .select('user_id', { count: 'exact', head: true })
        .eq('tenant_id', tenantRow.tenant_id)
        .eq('role', 'admin')
      if ((count ?? 0) <= 1) throw new Error('Este é o último administrador do tenant — promova outro antes de excluir')
    }

    // Escopo e capacidades primeiro: se a exclusão do auth falhar no meio, o que
    // sobra são linhas órfãs de permissão, e permissão órfã é pior do que
    // cadastro órfão — ela voltaria a valer se o id fosse reaproveitado.
    await supabaseAdmin.from('user_acesso_regra').delete().eq('user_id', user_id)
    await supabaseAdmin.from('user_acesso_funcao').delete().eq('user_id', user_id)
    await supabaseAdmin.from('user_tenant').delete().eq('user_id', user_id).eq('tenant_id', tenantRow.tenant_id)

    const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(user_id)
    if (delErr) throw new Error(delErr.message)

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
