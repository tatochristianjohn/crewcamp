#!/usr/bin/env bash
# CrewCamp - one-command production deploy to Netlify.
#   NETLIFY_AUTH_TOKEN  your Netlify personal access token  (User settings -> Applications -> Personal access tokens)
#   NETLIFY_SITE_ID     the site's API ID                   (Site configuration -> General -> Site information)
#   ADMIN_INITIAL_PASSWORD  (optional, first deploy only) 8+ characters; saved as a Netlify environment variable
# Put them in your shell, or in a file called .env.deploy next to package.json (it is git-ignored). The token is read from the
# environment by the Netlify CLI itself, so it never appears on the command line, in logs or in the repo.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env.deploy ]; then set -a; . ./.env.deploy; set +a; fi
: "${NETLIFY_AUTH_TOKEN:?Set NETLIFY_AUTH_TOKEN (see scripts/deploy.sh header)}"
: "${NETLIFY_SITE_ID:?Set NETLIFY_SITE_ID (see scripts/deploy.sh header)}"
export NETLIFY_AUTH_TOKEN NETLIFY_SITE_ID

echo "==> 1/5 install dependencies (@netlify/blobs is bundled into the function)"
npm install --no-audit --no-fund --omit=dev

echo "==> 2/5 run the test suite (no network needed)"
npm test

if [ -n "${ADMIN_INITIAL_PASSWORD:-}" ]; then
  echo "==> 3/5 save ADMIN_INITIAL_PASSWORD on the site"
  npx --yes netlify-cli env:set ADMIN_INITIAL_PASSWORD "$ADMIN_INITIAL_PASSWORD" --context production >/dev/null
else
  echo "==> 3/5 ADMIN_INITIAL_PASSWORD not given: assuming it is already set on the site"
fi

echo "==> 4/5 deploy to production (public/ + netlify/functions incl. the 15-minute sweep)"
OUT=$(npx --yes netlify-cli deploy --prod --dir=public --functions=netlify/functions --json)
URL=$(printf '%s' "$OUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s.slice(s.indexOf("{")));console.log(j.url||j.deploy_url||"")}catch{}})')
echo "    deployed: ${URL:-(see Netlify dashboard)}"

echo "==> 5/5 check the live site"
if [ -n "$URL" ]; then node scripts/verify.mjs "$URL"; else echo "    (no URL returned by the CLI; run: node scripts/verify.mjs https://<your-site>.netlify.app)"; fi
