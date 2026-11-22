# 711acks — Phase 4B-3: Controlled Supabase Edge Functions Deployment Report

- **Phase:** 4B-3 (Controlled Supabase Edge Functions Deployment)
- **Target Project:** `711acks` — Supabase Free Plan, Southeast Asia (Singapore)
- **Execution Environment:** AI Studio Workspace Sandbox (`/app/applet`)
- **Final Verdict:** **`BLOCKED`**

---

## Executive Summary

Controlled deployment was halted at the **Pre-Execution Verification Gate** before executing any deployment or secret mutation commands.

Inside this workspace environment:
1. The **Supabase CLI (`supabase`) is not installed**, no Supabase project is linked (`supabase/.temp` absent), and no Supabase CLI login session (`~/.supabase`) or access token exists.
2. Live **project confirmation** (`711acks` Project Reference ID) and live **JWT Signing Key inspection** (legacy `HS256` vs. asymmetric ECC `ES256`) cannot be performed from an unauthenticated sandbox container.
3. The exact **production `ALLOWED_ORIGINS` URL** (live Vercel production domain) has not yet been confirmed, and real secret values (`ADMIN_OTP_PEPPER`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`) must be configured directly from your authenticated local terminal or Supabase Dashboard — **never** entered in chat.
4. **Stage B smoke tests** (real Password -> SMTP OTP -> Verify -> Approve Submission -> Logout) additionally require the single owner account (`auth.users` + `public.admin_profiles`), which is deferred until Phase 4B-4 under the current restrictions.

Zero deployment, database, auth, secret, code, or Vercel changes were executed. All strict restrictions were fully honored.

---

## 1. Pre-Execution Checks & Commands Executed

Only read-only environment inspection commands were executed. No secret values were printed, requested, or stored.

### Command 1 — Supabase CLI, Project Link & Relevant Env Var Names Check
```bash
echo "=== CLI CHECK ===" && (which supabase || echo "supabase: NOT FOUND") && (npx --no-install supabase --version 2>/dev/null || echo "npx local supabase: NOT FOUND") && echo "=== SUPABASE TEMP/LINK CHECK ===" && ls -la supabase/.temp 2>/dev/null || echo "supabase/.temp: NOT FOUND" && echo "=== ENV VAR NAMES CHECK (NO VALUES) ===" && env | cut -d= -f1 | grep -E '^(SUPABASE|VITE_SUPABASE|ADMIN_OTP|SMTP|ALLOWED_ORIGINS|ALLOW_LOCALHOST|VERCEL)' || echo "No matching Supabase/SMTP/Vercel env vars set"
```
**Observed Output (Exit Code `0`):**
- `supabase: NOT FOUND`
- `npx local supabase: NOT FOUND`
- `supabase/.temp: NOT FOUND`
- `No matching Supabase/SMTP/Vercel env vars set`

### Command 2 — Local Supabase CLI Auth Config & `.env*` Check
```bash
echo "=== HOME SUPABASE CONFIG ===" && ls -la ~/.supabase 2>/dev/null || echo "~/.supabase: NOT FOUND" && echo "=== WORKSPACE ENV FILES ===" && ls -la .env* 2>/dev/null || echo "No .env* files"
```
**Observed Output (Exit Code `0`):**
- `~/.supabase: NOT FOUND`
- Only `.env.example` exists in the workspace root (zero `.env` or `.env.local` files).

---

## 2. Pre-Execution Gate Status

| Gate # | Required Pre-Execution Check | Status | Evidence / Notes |
|---|---|---|---|
| 1 | Confirm currently linked Supabase project is `711acks` production | **BLOCKED** | `supabase` CLI is not installed and `supabase/.temp` / `~/.supabase` do not exist in this container. Cannot verify linked project ref remotely. |
| 2 | Review deployment commands & exact custom secret names | **PASSED** | Verified against `supabase/config.toml`, `_shared/adminAuthShared.ts`, `_shared/smtpClient.ts`, and all 6 function entry points (see Section 5). Custom secret names only: `ADMIN_OTP_PEPPER`, `ADMIN_OTP_VALIDITY_MINUTES`, `ALLOWED_ORIGINS`, `ALLOW_LOCALHOST_CORS`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`. (`SUPABASE_*` platform variables are auto-injected and excluded from `supabase secrets set`.) |
| 3 | Confirm production `ALLOWED_ORIGINS` value and `ALLOW_LOCALHOST_CORS=false` | **BLOCKED** | `ALLOW_LOCALHOST_CORS="false"` is confirmed for production, but the exact live Vercel production origin (`https://<production-domain>`) is not yet confirmed or deployed. |
| 4 | Inspect project JWT signing configuration & document compatibility of the two `verify_jwt=true` functions | **BLOCKED (Live Check Pending)** | Could not query the live `711acks` project's Auth JWT Signing Keys (`HS256` vs `ES256`) without authenticated Supabase access. See Section 4 for the exact Dashboard inspection & compatibility criteria. |
| 5 | Never print, request, expose, or commit secret values | **PASSED** | Zero secret values were requested, printed, exposed, or committed. |

---

## 3. Deployment & Smoke-Test Results

### 3.1 Edge Function Deployment Results
Deployment did **not** execute because Pre-Execution Gates 1, 3, and 4 were blocked.

| Function Name | Expected `verify_jwt` | Deployment Status |
|---|---|---|
| `admin-auth-initiate` | `false` (`--no-verify-jwt`) | **Not Executed (Blocked)** |
| `admin-auth-resend` | `false` (`--no-verify-jwt`) | **Not Executed (Blocked)** |
| `admin-auth-verify` | `false` (`--no-verify-jwt`) | **Not Executed (Blocked)** |
| `admin-auth-complete-recovery` | `false` (`--no-verify-jwt`) | **Not Executed (Blocked)** |
| `admin-auth-logout` | `true` | **Not Executed (Blocked)** |
| `approve-community-submission` | `true` | **Not Executed (Blocked)** |

### 3.2 Smoke-Test Results
| Stage | Scope | Status | Reason |
|---|---|---|---|
| **Stage A** | CORS `403` rejection, allowlisted `OPTIONS` `200`, `405` method guard, unauthenticated `401`/`400` boundary (no `503`) | **Not Executed (Blocked)** | Functions are not yet deployed and production `ALLOWED_ORIGINS` is not yet configured. |
| **Stage B** | Live Step 1 password -> Gmail SMTP OTP -> Step 2 verify -> `approve-community-submission` -> `admin-auth-logout` -> password recovery | **Not Executed (Blocked)** | Requires deployed functions **plus** Phase 4B-4 single-owner account (`auth.users` + `public.admin_profiles`), which is prohibited in Phase 4B-3. |

---

## 4. JWT Signing Configuration & `verify_jwt = true` Compatibility Analysis

Because live project metadata could not be queried from this container, check **Supabase Dashboard -> Project Settings -> JWT Keys** on the `711acks` project before running Stage B tests:

- **If `711acks` uses legacy symmetric `HS256` JWT signing:**
  - Both `admin-auth-logout` and `approve-community-submission` (`verify_jwt = true`) are directly compatible with the Edge Functions gateway and with in-handler `userClient.auth.getUser()`.
- **If `711acks` uses newer asymmetric ECC (`ES256`) JWT signing keys (Supabase JWT Signing Keys migration):**
  - The Edge Functions gateway's `verify_jwt = true` check may return `401 Invalid JWT` on `ES256`-signed user access tokens before invoking the handler, even though both handlers perform full `userClient.auth.getUser()` validation (and `approve-community-submission` also enforces `userClient.rpc('is_verified_admin')`).
  - **Rule:** Do **not** weaken `verify_jwt = true` preemptively. Deploy with `verify_jwt = true` as configured in `supabase/config.toml`, verify the active signing algorithm in Dashboard -> **JWT Keys**, and confirm live post-OTP Bearer token acceptance during Stage B testing. Report back if the gateway rejects valid `ES256` tokens so any configuration update can be explicitly approved.

---

## 5. Exact Local Workstation Execution Plan (Recommended Fix to Unblock Phase 4B-3)

Because real secrets and Supabase CLI login must stay strictly on your local workstation (outside this sandbox and never pasted into chat), execute the following steps directly from your local repository root:

### Step 1 — Install/Verify Supabase CLI & Confirm Linked `711acks` Project
```bash
supabase --version
supabase login
supabase link --project-ref <711ACKS_PROJECT_REF>
# Confirm the linked project ref matches your Singapore 711acks project:
cat supabase/.temp/project-ref
```

### Step 2 — Check JWT Signing Keys in Dashboard (No Changes)
- Open **Supabase Dashboard -> `711acks` -> Project Settings -> JWT Keys** and note whether the active signing key is **Legacy JWT Secret (`HS256`)** or **Asymmetric ECC (`ES256`)**.

### Step 3 — Set Required Custom Secrets Locally (Never Paste Values in Chat)
Generate a 64-character random hex pepper locally (`openssl rand -hex 32`), confirm your exact production Vercel origin (e.g., `https://your-production-domain.vercel.app`, no trailing slash), and run:
```bash
supabase secrets set \
  ADMIN_OTP_PEPPER="$(openssl rand -hex 32)" \
  ADMIN_OTP_VALIDITY_MINUTES="120" \
  ALLOWED_ORIGINS="https://<YOUR_PRODUCTION_VERCEL_ORIGIN>" \
  ALLOW_LOCALHOST_CORS="false" \
  SMTP_HOST="smtp.gmail.com" \
  SMTP_PORT="465" \
  SMTP_SECURE="true" \
  SMTP_USER="<YOUR_GMAIL_SENDER_ADDRESS>" \
  SMTP_PASS="<YOUR_16_CHAR_GOOGLE_APP_PASSWORD>" \
  SMTP_FROM="711acks Security <YOUR_GMAIL_SENDER_ADDRESS>"

# Verify secret names are present (shows digests only, never plaintext):
supabase secrets list
```
*(Do NOT include `SUPABASE_URL`, `SUPABASE_ANON_KEY`, or `SUPABASE_SERVICE_ROLE_KEY` — Supabase auto-injects them.)*

### Step 4 — Deploy the Four Pre-Auth Functions (`--no-verify-jwt`) & Verify
```bash
supabase functions deploy admin-auth-initiate --no-verify-jwt
supabase functions deploy admin-auth-resend --no-verify-jwt
supabase functions deploy admin-auth-verify --no-verify-jwt
supabase functions deploy admin-auth-complete-recovery --no-verify-jwt

supabase functions list
```

### Step 5 — Deploy the Two JWT-Verified Functions & Verify All Six
```bash
supabase functions deploy admin-auth-logout
supabase functions deploy approve-community-submission

supabase functions list
```
Confirm in **Supabase Dashboard -> Edge Functions** that all 6 functions are `ACTIVE` and match `supabase/config.toml` (`verify_jwt = false` on the first 4; `verify_jwt = true` on `admin-auth-logout` and `approve-community-submission`).

### Step 6 — Run Stage A Smoke Tests (No Owner Account Needed)
Replace `<PROJECT_URL>`, `<ANON_KEY>`, and `<YOUR_PRODUCTION_VERCEL_ORIGIN>` locally:
```bash
# 1. Unapproved Origin MUST return HTTP 403 with no Access-Control-Allow-Origin
curl -i -X OPTIONS "<PROJECT_URL>/functions/v1/admin-auth-initiate" \
  -H "Origin: https://evil.example.com" \
  -H "Access-Control-Request-Method: POST"

# 2. Approved Origin preflight MUST return HTTP 200 with exact Access-Control-Allow-Origin & Cache-Control: no-store
curl -i -X OPTIONS "<PROJECT_URL>/functions/v1/admin-auth-initiate" \
  -H "Origin: https://<YOUR_PRODUCTION_VERCEL_ORIGIN>" \
  -H "Access-Control-Request-Method: POST"

# 3. Pre-auth initiate with bogus credentials MUST return HTTP 401 (NOT 503 — proves secrets + rate-limit RPC work)
curl -i -X POST "<PROJECT_URL>/functions/v1/admin-auth-initiate" \
  -H "Origin: https://<YOUR_PRODUCTION_VERCEL_ORIGIN>" \
  -H "apikey: <ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"email":"not-owner@example.com","password":"wrong-password"}'

# 4. Pre-auth resend/verify/recovery malformed inputs MUST return HTTP 400 (NOT 503)
curl -i -X POST "<PROJECT_URL>/functions/v1/admin-auth-resend" \
  -H "Origin: https://<YOUR_PRODUCTION_VERCEL_ORIGIN>" \
  -H "apikey: <ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{}'

curl -i -X POST "<PROJECT_URL>/functions/v1/admin-auth-verify" \
  -H "Origin: https://<YOUR_PRODUCTION_VERCEL_ORIGIN>" \
  -H "apikey: <ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{}'

curl -i -X POST "<PROJECT_URL>/functions/v1/admin-auth-complete-recovery" \
  -H "Origin: https://<YOUR_PRODUCTION_VERCEL_ORIGIN>" \
  -H "apikey: <ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{}'

# 5. Authenticated endpoints without user JWT MUST return HTTP 401
curl -i -X POST "<PROJECT_URL>/functions/v1/admin-auth-logout" \
  -H "Origin: https://<YOUR_PRODUCTION_VERCEL_ORIGIN>" \
  -H "apikey: <ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{}'

curl -i -X POST "<PROJECT_URL>/functions/v1/approve-community-submission" \
  -H "Origin: https://<YOUR_PRODUCTION_VERCEL_ORIGIN>" \
  -H "apikey: <ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

## 6. Remaining Blockers

1. **Sandbox Cannot Reach/Authenticate to `711acks` Supabase CLI:** `supabase` CLI is absent, no project is linked, and no access token is present in `/app/applet`. Deployment must be run from your authenticated local workstation.
2. **Production `ALLOWED_ORIGINS` URL Not Yet Confirmed:** Exact production HTTPS origin is needed before setting `ALLOWED_ORIGINS` (can be updated later via `supabase secrets set ALLOWED_ORIGINS="..."` without redeploying code).
3. **Live JWT Signing Key Type Unverified:** Active signing key (`HS256` vs. `ES256`) on `711acks` must be checked in Supabase Dashboard -> Project Settings -> JWT Keys.
4. **Stage B Smoke Tests Blocked Until Phase 4B-4:** Full live OTP delivery, session minting, `approve-community-submission`, and `admin-auth-logout` E2E verification require the single owner account to exist (prohibited during Phase 4B-3).

---

## 7. Final Verdict

### **`BLOCKED`**

Execution stopped cleanly at the pre-execution verification gate without modifying any code, migrations, database objects, policies, secrets, auth users, or deployments. Once you run the local workstation CLI steps above (with zero secrets shared in chat) and share the redacted Stage A outputs and JWT Signing Key type, we can verify the results and move cleanly to Phase 4B-4.
