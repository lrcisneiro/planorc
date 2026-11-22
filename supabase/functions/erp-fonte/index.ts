// ============================================================
// erp-fonte — fala com a fonte de dados do ERP em nome do usuário.
//
// POR QUE EXISTE (duas razões, e as duas são impeditivas sem ela):
//
// 1. A CREDENCIAL NÃO PODE PASSAR PELO NAVEGADOR. O Planorc fala com o banco
//    pelo cliente JS; tudo que a tela lê, o usuário lê no DevTools. Guardar a
//    senha do ERP numa tabela — com qualquer RLS — é publicá-la para quem
//    alcança a tela. Aqui ela fica no `vault`, é lida com service role e NUNCA
//    volta para o cliente: nem na listagem, nem no download, nem no erro.
//
// 2. NÃO HÁ CORS NO SERVIDOR DO ERP. Medido em 22/nov no stage do GoodData:
//    a resposta não traz `access-control-allow-origin`, então o `fetch` do
//    navegador morre antes de sair. A chamada tem de ser servidor→servidor.
//
// ⚠⚠ O DOWNLOAD É PASSTHROUGH DE STREAM, nunca `arrayBuffer()`. O zip tem
// 25 MB e a função roda com memória limitada: bufferizar o corpo inteiro para
// repassá-lo é a forma de descobrir o limite em produção, no dia do
// fechamento. `upstream.body` vai direto para a resposta.
//
// Ações: `listar` (o que há na pasta) e `baixar` (um arquivo).
// `segredo` grava/atualiza a credencial — o único caminho por onde ela entra.
// ============================================================
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

/** Lista de um índice HTML de diretório (Apache autoindex / WebDAV).
 *  ⚠ É MELHOR ESFORÇO e está declarado como tal: cada servidor desenha o
 *  índice do seu jeito. Quando não reconhece nada, a tela cai no nome de
 *  arquivo do cadastro — que é o caminho que sempre funciona. Falhar aqui não
 *  pode impedir o download. */
function lerIndice(html: string): { nome: string; tamanho: string; modificado: string }[] {
  const out: { nome: string; tamanho: string; modificado: string }[] = []
  const re = /<a href="([^"?][^"]*)"[^>]*>([^<]+)<\/a>\s*([^<]*)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const href = m[1]
    if (href.startsWith('/') || href.includes('://') || href.endsWith('/')) continue   // pai e subpastas
    const resto = (m[3] || '').trim().split(/\s{2,}/)
    out.push({
      nome: decodeURIComponent(href),
      modificado: resto[0] || '',
      tamanho: resto[1] || '',
    })
  }
  return out
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  try {
    const auth = req.headers.get('Authorization')
    if (!auth) return json({ erro: 'Não autenticado.' }, 401)
    const { data: { user }, error: eAuth } = await admin.auth.getUser(auth.replace('Bearer ', ''))
    if (eAuth || !user) return json({ erro: 'Token inválido.' }, 401)

    // ⚠ O PAPEL É CONFERIDO AQUI, não só na tela. Esta função fala com o ERP
    // usando uma credencial que o chamador não tem — se ela aceitasse qualquer
    // token, viraria um proxy aberto para a área de stage do cliente.
    const { data: vinculo } = await admin.from('user_tenant')
      .select('tenant_id, role').eq('user_id', user.id).limit(1).maybeSingle()
    if (!vinculo) return json({ erro: 'Usuário sem tenant.' }, 403)
    const papel = String(vinculo.role || '')
    const podeEscrever = papel === 'admin' || papel === 'member'

    const body = await req.json().catch(() => ({})) as Record<string, string>
    const acao = body.acao || ''
    const fonteId = body.fonte_id || ''
    if (!fonteId) return json({ erro: 'Informe a fonte.' }, 400)

    const { data: fonte } = await admin.from('erp_fonte')
      .select('id,tenant_id,nome,tipo,url_base,usuario,secret_id,perfil,arquivo,ativo')
      .eq('id', fonteId).maybeSingle()
    if (!fonte) return json({ erro: 'Fonte não encontrada.' }, 404)
    // ⚠ O service role ignora RLS, então o recorte por tenant vai EXPLÍCITO.
    // Sem esta linha a função entregaria a fonte de outro cliente a quem
    // soubesse o uuid — exatamente o que o RLS faria sozinho na tela.
    if (fonte.tenant_id !== vinculo.tenant_id) return json({ erro: 'Fonte de outro tenant.' }, 403)

    // ── gravar a credencial ───────────────────────────────────────────────
    if (acao === 'segredo') {
      if (papel !== 'admin') return json({ erro: 'Só administrador define a credencial.' }, 403)
      const senha = body.senha ?? ''
      if (!senha) return json({ erro: 'Informe a senha.' }, 400)
      // ⚠ O schema `vault` NÃO é exposto pelo PostgREST — por isso a ponte
      // `erp_segredo_gravar`, que roda SECURITY DEFINER e só o service role
      // executa (v3_196).
      const { error: eSec } = await admin.rpc('erp_segredo_gravar', { p_fonte: fonte.id, p_senha: senha })
      if (eSec) return json({ erro: 'Não foi possível guardar a credencial: ' + eSec.message }, 500)
      return json({ ok: true })
    }

    if (!podeEscrever) return json({ erro: 'Sem permissão para importar.' }, 403)
    if (!fonte.ativo) return json({ erro: 'Fonte desativada.' }, 400)
    if (fonte.tipo !== 'HTTP') return json({ erro: `Tipo "${fonte.tipo}" ainda não é suportado.` }, 400)

    // ── credencial: lida aqui, nunca devolvida ────────────────────────────
    let headers: Record<string, string> = {}
    if (fonte.usuario) {
      const { data: senha } = await admin.rpc('erp_segredo_ler', { p_fonte: fonte.id })
      if (!senha) return json({ erro: 'A fonte tem usuário mas não tem credencial guardada. Informe a senha no cadastro.' }, 400)
      headers = { Authorization: 'Basic ' + btoa(`${fonte.usuario}:${senha}`) }
    }

    const base = fonte.url_base.endsWith('/') ? fonte.url_base : fonte.url_base + '/'

    if (acao === 'listar') {
      const r = await fetch(base, { headers })
      if (!r.ok) return json({ erro: `O servidor respondeu ${r.status} ao listar.` }, 502)
      const arquivos = lerIndice(await r.text())
      return json({ arquivos, sugerido: fonte.arquivo || null })
    }

    if (acao === 'baixar') {
      const nome = body.arquivo || fonte.arquivo || ''
      if (!nome) return json({ erro: 'Informe o arquivo.' }, 400)
      // ⚠ Sem `..` e sem caminho: o nome vem do cliente, e a URL é montada
      // aqui com a credencial do tenant. Deixar subir de diretório
      // transformaria a função num leitor de tudo o que a conta alcança.
      if (nome.includes('/') || nome.includes('\\') || nome.includes('..')) {
        return json({ erro: 'Nome de arquivo inválido.' }, 400)
      }
      const r = await fetch(base + encodeURIComponent(nome), { headers })
      if (!r.ok) return json({ erro: `O servidor respondeu ${r.status} ao baixar "${nome}".` }, 502)
      // Passthrough: o corpo nunca é materializado nesta função.
      // ⚠ `Last-Modified` VAI JUNTO, e não é enfeite: é o que diz se o job do
      // ERP rodou. Sem ela a tela carimbaria a hora do DOWNLOAD, e importar um
      // arquivo de três dias atrás pareceria importar o de hoje.
      // ⚠ `Last-Modified` e `Content-Length` são CORS-safelisted, então o JS os
      // lê sem mais nada — `Expose-Headers` vai por garantia, porque um
      // proxy no caminho pode não ser tão generoso.
      return new Response(r.body, {
        headers: {
          ...cors,
          'Access-Control-Expose-Headers': 'Content-Length, Last-Modified',
          'Content-Type': r.headers.get('content-type') || 'application/octet-stream',
          ...(r.headers.get('content-length') ? { 'Content-Length': r.headers.get('content-length')! } : {}),
          ...(r.headers.get('last-modified') ? { 'Last-Modified': r.headers.get('last-modified')! } : {}),
        },
      })
    }

    return json({ erro: `Ação desconhecida: "${acao}".` }, 400)
  } catch (e) {
    // ⚠ A mensagem do erro é devolvida crua em muitos lugares deste projeto;
    // aqui não: um erro de fetch pode carregar a URL com a credencial embutida.
    console.error('erp-fonte:', e)
    return json({ erro: 'Falha ao falar com a fonte do ERP. Confira a URL, o usuário e a senha no cadastro.' }, 500)
  }
})
