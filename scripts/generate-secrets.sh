#!/usr/bin/env bash
# Generate .env and api/.env with real secrets.
#
# The upstream project shipped JWT_SECRET=secret and an admin password of
# "selfhostsim". Nothing in the code enforces changing them, so this script
# exists to make doing the right thing the easy thing.
#
# Safe to read before you run it; it writes two files and prints one password.
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -f .env || -f api/.env ]]; then
  echo "Refusing to overwrite an existing .env or api/.env." >&2
  echo "Move them aside first if you really want fresh secrets." >&2
  exit 1
fi

rand() { openssl rand -hex 32; }

MONGO_PASS="$(rand)"
JWT_SECRET="$(rand)"
ADMIN_PASS="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)"

# Pick the tailnet address when Tailscale is up, so the phone and your other
# devices can reach this without any further editing.
TAILSCALE_IP="$(tailscale ip -4 2>/dev/null | head -n1 || true)"
API_HOST="${TAILSCALE_IP:-localhost}"

sed -e "s|^MONGO_ROOT_PASS=.*|MONGO_ROOT_PASS=${MONGO_PASS}|" \
    -e "s|^PUBLIC_API_BASE_URL=.*|PUBLIC_API_BASE_URL=http://${API_HOST}:3001/api/v1|" \
    .env.example > .env

sed -e "s|^MONGO_ROOT_PASS=.*|MONGO_ROOT_PASS=${MONGO_PASS}|" \
    -e "s|^MONGO_URI=.*|MONGO_URI=mongodb://sendline:${MONGO_PASS}@sendline-db:27017/sendline?authSource=admin|" \
    -e "s|^JWT_SECRET=.*|JWT_SECRET=${JWT_SECRET}|" \
    -e "s|^DEFAULT_ADMIN_PASSWORD=.*|DEFAULT_ADMIN_PASSWORD=${ADMIN_PASS}|" \
    api/.env.example > api/.env

chmod 600 .env api/.env

echo "Wrote .env and api/.env (mode 600)."
echo
echo "  admin username : admin"
echo "  admin password : ${ADMIN_PASS}"
echo "  API address    : http://${API_HOST}:3001/api/v1"
if [[ -z "${TAILSCALE_IP}" ]]; then
  echo
  echo "Tailscale is not up, so this fell back to localhost. Once you run"
  echo "'tailscale up', put the 100.x.y.z address into PUBLIC_API_BASE_URL in"
  echo ".env and into SENDLINE_API_BASE_URL in android/gradle.properties."
else
  echo
  echo "Put this in android/gradle.properties before building the APK:"
  echo "  SENDLINE_API_BASE_URL=http://${TAILSCALE_IP}:3001/api/v1/"
fi
echo
echo "Still to fill in by hand in api/.env: the FIREBASE_* block and the SMTP_* block."
