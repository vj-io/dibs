#!/usr/bin/env bash
# Scans files tracked or staged in git for likely secrets.
# Prints file:line and the pattern name only; never prints the matched value.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

self="scripts/secret-scan.sh"
findings=0

names=(
  "JWT-like string"
  "Supabase secret key (sb_secret_)"
  "database URL with password"
  "secret-like assignment (SECRET/SERVICE_ROLE/PASSWORD/API_KEY/TOKEN)"
  "private key header"
)
pats=(
  'eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+'
  'sb_secret_[A-Za-z0-9_-]+'
  'postgres(ql)?://[^[:space:]:/@]+:[^[:space:]@]+@'
  "[A-Z0-9_]*(SECRET|SERVICE_ROLE|PASSWORD|API_KEY|TOKEN)[A-Z0-9_]*[[:space:]]*[:=][[:space:]]*[\"']?[^\"'[:space:]]+"
  'BEGIN [A-Z ]*PRIVATE KEY'
)
assign_index=3

scan_file() {
  local f="$1" i nums n
  for i in "${!pats[@]}"; do
    nums=$(grep -nE -- "${pats[$i]}" "$f" 2>/dev/null | {
      if [ "$i" -eq "$assign_index" ]; then
        grep -vE 'process\.env|<[^>]+>|your-' || true
      else
        cat
      fi
    } | cut -d: -f1 || true)
    while IFS= read -r n; do
      [ -n "$n" ] || continue
      findings=$((findings + 1))
      printf '%s:%s: %s\n' "$f" "$n" "${names[$i]}"
    done <<< "$nums"
  done
}

# Env files: only .env.example may be tracked.
while IFS= read -r f; do
  [ -n "$f" ] || continue
  case ${f##*/} in
    .env.example) ;;
    .env*) findings=$((findings + 1)); printf '%s: env file is tracked (only .env.example may be)\n' "$f" ;;
  esac
done < <(git ls-files)

files=$( { git ls-files; git diff --cached --name-only; } | sort -u )

while IFS= read -r f; do
  [ -n "$f" ] || continue
  [ "$f" = "$self" ] && continue
  [ "$f" = "package-lock.json" ] && continue
  [ -f "$f" ] || continue
  grep -Iq . -- "$f" || continue   # skip binary and empty files
  scan_file "$f"
done <<< "$files"

if [ "$findings" -gt 0 ]; then
  echo "secret scan: $findings finding(s); values not shown"
  exit 1
fi
echo "secret scan: clean"
exit 0
