import 'dotenv/config';

export const env = {
  PORT: process.env.PORT || 5500,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

// Fail fast if required env vars are missing
const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
for (const key of required) {
  if (!env[key]) {
    console.error(`[ENV] Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

// Debug: confirm env loaded correctly
console.log('[ENV] SUPABASE_URL      =', env.SUPABASE_URL);
console.log('[ENV] SERVICE_ROLE_KEY  =', env.SUPABASE_SERVICE_ROLE_KEY ? `SET (${env.SUPABASE_SERVICE_ROLE_KEY.slice(0, 20)}...)` : 'NOT SET');
console.log('[ENV] PORT              =', env.PORT);
