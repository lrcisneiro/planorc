-- ============================================================
-- Corrige o alerta "RLS Disabled in Public" em public.visao_plano
-- Habilita RLS (sem policy = nenhum acesso via API pública → seguro).
-- O alerta do Supabase desaparece e os dados ficam preservados.
-- ============================================================
ALTER TABLE public.visao_plano ENABLE ROW LEVEL SECURITY;

-- OPCIONAL — só se a tabela tiver a coluna tenant_id e você quiser
-- liberar o acesso por tenant (mesmo padrão das outras tabelas):
-- CREATE POLICY "visao_plano_rls" ON public.visao_plano FOR ALL
--   USING (tenant_id = current_tenant_id())
--   WITH CHECK (tenant_id = current_tenant_id());
