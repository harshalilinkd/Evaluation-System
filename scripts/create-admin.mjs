/**
 * Creates the first HR Admin, so somebody can reach Settings and add everyone else.
 *
 *   npm run bootstrap:admin -- "you@company.com" "your-password" "Your Name"
 *
 * Chicken-and-egg: Settings -> Users is HR-only, so the very first HR account
 * cannot be made through the interface. This is the one way in. After it, every
 * other person is added from Settings.
 *
 * Credentials come from the command line, never from a file — a password
 * committed to the repository is a password that has leaked.
 *
 * Safe to re-run: an existing account has its password reset and its role
 * ensured, rather than erroring.
 */

import { createClient } from "@supabase/supabase-js";

const [email, password, fullName] = process.argv.slice(2);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function bail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

if (!url || !serviceKey) {
  bail(
    "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local.\n" +
      "The service key is the one under Project Settings -> API Keys -> secret.",
  );
}
if (!email || !password) {
  bail('Usage: npm run bootstrap:admin -- "you@company.com" "your-password" "Your Name"');
}
// Same rule the Settings screen applies, so the two cannot disagree.
if (password.length < 10) bail("Use a password of at least 10 characters.");

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/* ---------- 1. The auth account ---------- */

let userId;

const { data: created, error: createError } = await admin.auth.admin.createUser({
  email,
  password,
  // No inbox round-trip: whoever runs this has server credentials already.
  email_confirm: true,
  user_metadata: { full_name: fullName ?? email.split("@")[0] },
});

if (created?.user) {
  userId = created.user.id;
  console.log(`Created auth account for ${email}`);
} else {
  const exists = /already|registered|exists/i.test(createError?.message ?? "");
  if (!exists) bail(`Could not create the account: ${createError?.message}`);

  // Re-run: find them and reset the password to what was just supplied.
  const { data: list, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (listError) bail(`Could not look up the existing account: ${listError.message}`);

  const found = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!found) bail("The account exists but could not be found. Check the email address.");

  userId = found.id;
  const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
    password,
    email_confirm: true,
  });
  if (updateError) bail(`Could not reset the password: ${updateError.message}`);
  console.log(`${email} already existed — password reset.`);
}

/* ---------- 2. The profile ---------- */

// on_auth_user_created (migration 0001) makes this row. If it is missing, the
// migrations have not been applied — which is worth saying plainly, because the
// symptom otherwise is a login that succeeds and then bounces to /login.
const { data: profile, error: profileError } = await admin
  .from("profiles")
  .select("id")
  .eq("id", userId)
  .maybeSingle();

if (profileError) bail(`Could not read profiles: ${profileError.message}`);

if (!profile) {
  bail(
    "The account was created, but no profile row appeared.\n" +
      "That means the migrations have not been applied to this project.\n" +
      "Run: npx supabase db push",
  );
}

if (fullName) {
  const { error } = await admin.from("profiles").update({ full_name: fullName }).eq("id", userId);
  if (error) bail(`Could not set the name: ${error.message}`);
}

/* ---------- 3. The roles ---------- */

// EMPLOYEE as well as HR_ADMIN: §9's simultaneous-roles case. HR fills in their
// own appraisal like everybody else.
const { error: rolesError } = await admin
  .from("user_roles")
  .upsert(
    [
      { profile_id: userId, role: "EMPLOYEE" },
      { profile_id: userId, role: "HR_ADMIN" },
    ],
    { onConflict: "profile_id,role" },
  );

if (rolesError) bail(`Could not grant the role: ${rolesError.message}`);

console.log(`\n${email} is now an HR Admin.`);
console.log("Sign in, then add everyone else from Settings -> Users.\n");
