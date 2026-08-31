#!/usr/bin/env bash
# ============================================================
# Planorc · Realizado — gera os lotes mensais para importar na tela /realizado
#
#   ./scripts/realizado.sh                 # pergunta ano/meses (Enter aceita o default)
#   ./scripts/realizado.sh -y              # não pergunta nada: ano corrente, todos os meses
#   ./scripts/realizado.sh --mes 8         # só agosto do ano corrente (fechamento do mês)
#   ./scripts/realizado.sh --ano 2025 -y   # o ano inteiro de 2025
#
# Flags repassadas ao gerador: --ano, --mes, --perfil, --arquivo, --saida.
# As regras de conversão ficam no perfil (scripts/perfis/*.json), não aqui.
# ============================================================
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GERADOR="$RAIZ/scripts/gerar_lotes_mensais.py"
DIR_PERFIS="$RAIZ/scripts/perfis"
SAIDA="$RAIZ/lotes_saida"

ANO=""; MESES=""; PERFIL=""; ARQUIVO=""; SIM=0
while [ $# -gt 0 ]; do
  case "$1" in
    --ano)     ANO="$2"; shift 2 ;;
    --mes)     MESES="$2"; shift 2 ;;
    --perfil)  PERFIL="$2"; shift 2 ;;
    --arquivo) ARQUIVO="$2"; shift 2 ;;
    --saida)   SAIDA="$2"; shift 2 ;;
    -y|--sim)  SIM=1; shift ;;
    -h|--help) sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)         echo "opção desconhecida: $1 (use --help)" >&2; exit 1 ;;
  esac
done

# não interativo quando não há terminal (cron, pipe)
[ -t 0 ] || SIM=1

azul()  { printf '\033[36m%s\033[0m\n' "$*"; }
fraco() { printf '\033[2m%s\033[0m\n' "$*"; }

command -v python3 >/dev/null || { echo "✗ python3 não encontrado." >&2; exit 1; }
python3 -c "import openpyxl" 2>/dev/null || {
  echo "✗ falta a biblioteca openpyxl. Instale com:" >&2
  echo "    pip3 install openpyxl" >&2
  exit 1
}

# ---- perfil: se houver mais de um, deixa escolher ----
if [ -z "$PERFIL" ]; then
  ENCONTRADOS=()   # sem mapfile: o bash do macOS ainda é o 3.2
  while IFS= read -r p; do ENCONTRADOS+=("$p"); done \
    < <(find "$DIR_PERFIS" -maxdepth 1 -name '*.json' ! -name '_*' | sort)
  if [ "${#ENCONTRADOS[@]}" -eq 0 ]; then
    echo "✗ nenhum perfil em $DIR_PERFIS — copie _modelo.json e ajuste." >&2; exit 1
  elif [ "${#ENCONTRADOS[@]}" -eq 1 ]; then
    PERFIL="$(basename "${ENCONTRADOS[0]}" .json)"
  elif [ "$SIM" -eq 1 ]; then
    echo "✗ há vários perfis — informe --perfil." >&2; exit 1
  else
    azul "Perfis disponíveis:"
    i=1; for p in "${ENCONTRADOS[@]}"; do echo "  $i) $(basename "$p" .json)"; i=$((i+1)); done
    read -r -p "Perfil [1]: " ESC; ESC="${ESC:-1}"
    PERFIL="$(basename "${ENCONTRADOS[$((ESC-1))]}" .json)"
  fi
fi

# ---- arquivo de origem ----
if [ -z "$ARQUIVO" ]; then
  PADRAO="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('arquivo_padrao') or 'LancamentoContabil.csv')" "$DIR_PERFIS/$PERFIL.json")"
  BASE="${PADRAO%.*}"
  for c in "$PADRAO" "$RAIZ/$PADRAO" "$BASE.zip" "$RAIZ/$BASE.zip"; do
    [ -f "$c" ] && { ARQUIVO="$c"; break; }
  done
fi
if [ -z "$ARQUIVO" ] || [ ! -f "$ARQUIVO" ]; then
  echo "✗ não achei o arquivo do razão. Passe com --arquivo <caminho>." >&2; exit 1
fi

descreve() {  # tamanho legível + data de modificação
  if stat -f '%z' "$1" >/dev/null 2>&1; then
    printf '%s · %s' "$(du -h "$1" | cut -f1 | tr -d ' ')" "$(stat -f '%Sm' -t '%d/%m %H:%M' "$1")"
  else
    printf '%s · %s' "$(du -h "$1" | cut -f1 | tr -d ' ')" "$(stat -c '%y' "$1" | cut -c1-16)"
  fi
}

echo
azul "Planorc · Realizado — lotes mensais"
fraco "perfil  : $PERFIL"
fraco "arquivo : $(basename "$ARQUIVO") · $(descreve "$ARQUIVO")"
fraco "saída   : $SAIDA"
echo

ANO_HOJE="$(date +%Y)"
# nada de "cond && { ... }" aqui: com set -e, o && que dá 1 encerra o script calado
if [ -z "$ANO" ]; then
  if [ "$SIM" -eq 0 ]; then
    read -r -p "Ano [$ANO_HOJE]: " r
    ANO="${r:-$ANO_HOJE}"
  else
    ANO="$ANO_HOJE"
  fi
fi
if [ -z "$MESES" ] && [ "$SIM" -eq 0 ]; then
  read -r -p "Meses — Enter = todos, ou ex.: 8 · 1,2 · 1-3 [todos]: " r
  MESES="${r:-}"
fi

CMD=(python3 "$GERADOR" "$ARQUIVO" "$SAIDA" --perfil "$PERFIL" --ano "$ANO")
if [ -n "$MESES" ]; then CMD+=(--mes "$MESES"); fi

echo
fraco "\$ ${CMD[*]}"
echo
"${CMD[@]}"

echo
azul "Pronto. Agora: app → Realizado → Importar → arraste os arquivos de $(basename "$SAIDA")/"
if [ "$SIM" -eq 0 ] && command -v open >/dev/null; then open "$SAIDA"; fi
exit 0
