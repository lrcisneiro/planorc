-- Nomes de empresa e filial, para a planilha do seed ficar legível.
-- Exporte como CSV e salve na pasta do projeto como `seed2027_nomes.csv`.
select 'EMPRESA' as tipo, codigo, descricao from empresa
union all
select 'FILIAL',  codigo, descricao from filial
order by tipo, codigo;
