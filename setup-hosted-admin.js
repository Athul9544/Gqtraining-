/* Turns on the hosted blog admin at <your-site>/admin.html.
 *
 *   node setup-hosted-admin.js        (or double-click setup-hosted-admin.cmd)
 *
 * The hosted admin needs two environment variables on Vercel that the local
 * admin does not:
 *
 *   ADMIN_PASSWORD   the login password
 *   GITHUB_TOKEN     a fine-grained PAT with "Contents: Read and write",
 *                    because a serverless function has no working copy and no
 *                    git — it publishes through the GitHub Contents API
 *
 * Both already exist in .env.local. This script reads them from there, checks
 * the token can actually write before it bothers uploading anything, pushes
 * both to Vercel, and redeploys so they take effect.
 *
 * It never prints either value.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = __dirname;
const REPO = process.env.GITHUB_REPO || 'Athul9544/Gqtraining-';
const BRANCH = process.env.GITHUB_BRANCH || 'main';

/* ------------------------------------------------------------- small bits */

const line = (s) => process.stdout.write(s + '\n');
const step = (n, s) => line('\n[' + n + '] ' + s);

function fail(message, hint) {
  line('\n  x ' + message);
  if (hint) line('    ' + hint);
  process.exitCode = 1;
  throw new Error('stop');
}

/* vercel is a .cmd shim on Windows, which CreateProcess will not run without
   a shell, so everything goes through one. */
function run(command, args, input) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: ROOT, shell: true });

    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });

    if (input != null) child.stdin.end(input);
    else child.stdin.end();

    child.on('close', (code) => resolve({ code, out: out.trim() }));
    child.on('error', (err) => resolve({ code: 1, out: String(err.message) }));
  });
}

function readEnvLocal() {
  const file = path.join(ROOT, '.env.local');
  if (!fs.existsSync(file)) fail('.env.local is missing.', 'It holds the two values this script uploads.');

  const values = {};
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((raw) => {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eq = trimmed.indexOf('=');
    if (eq < 1) return;
    let value = trimmed.slice(eq + 1).trim();
    if (/^(".*"|'.*')$/.test(value)) value = value.slice(1, -1);
    values[trimmed.slice(0, eq).trim()] = value;
  });
  return values;
}

/* A token that may write answers 409 to a stale sha, because it gets as far as
   comparing it. A token that may only read is turned away with 403 first, so
   this tells the two apart without writing anything either way. */
async function tokenCanWrite(token) {
  const response = await fetch(
    'https://api.github.com/repos/' + REPO + '/contents/data/posts.json',
    {
      method: 'PUT',
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'golden-qube-setup',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: 'permission probe — never applied',
        content: Buffer.from('probe').toString('base64'),
        branch: BRANCH,
        sha: '0'.repeat(40)
      })
    }
  );
  return { ok: response.status === 409, status: response.status };
}

async function setVar(name, value) {
  /* Adding over an existing variable fails, so clear it first. A missing one
     makes the remove fail harmlessly, which is why its result is ignored. */
  await run('vercel', ['env', 'rm', name, 'production', '--yes']);

  const added = await run('vercel', ['env', 'add', name, 'production'], value);
  if (added.code !== 0) fail('Could not set ' + name + ' on Vercel.', added.out.split('\n').slice(-3).join(' '));
  line('    ' + name + ' set');
}

/* ------------------------------------------------------------------- main */

(async function main() {
  line('Golden Qube — turning on the hosted blog admin');

  step(1, 'Reading .env.local');
  const env = readEnvLocal();
  if (!env.ADMIN_PASSWORD) fail('ADMIN_PASSWORD is not in .env.local.');
  if (!env.GITHUB_TOKEN) fail('GITHUB_TOKEN is not in .env.local.');
  line('    both values found');

  step(2, 'Checking you are signed in to Vercel');
  const who = await run('vercel', ['whoami']);
  const account = who.out.split('\n').map(s => s.trim()).filter(Boolean).pop();
  if (who.code !== 0) fail('Not signed in to Vercel.', 'Run:  vercel login');
  line('    signed in as ' + account);

  step(3, 'Checking the GitHub token can write to ' + REPO);
  const probe = await tokenCanWrite(env.GITHUB_TOKEN);
  if (!probe.ok) {
    line('    GitHub answered ' + probe.status + ' — this token cannot write.');
    fail(
      'The hosted admin would sign in but fail on save.',
      'Fix it first: github.com -> Settings -> Developer settings ->\n' +
      '    Fine-grained tokens -> this token -> Repository permissions ->\n' +
      '    Contents: Read and write.  Editing the permission keeps the same\n' +
      '    token value, so .env.local does not change.'
    );
  }
  line('    the token can write');

  step(4, 'Sending both values to Vercel (production)');
  await setVar('ADMIN_PASSWORD', env.ADMIN_PASSWORD);
  await setVar('GITHUB_TOKEN', env.GITHUB_TOKEN);

  step(5, 'Redeploying so they take effect');
  const deploy = await run('vercel', ['deploy', '--prod', '--yes']);
  if (deploy.code !== 0) {
    line('    the redeploy did not finish:');
    line('    ' + deploy.out.split('\n').slice(-3).join('\n    '));
    line('\n  The variables are set. Redeploy from the Vercel dashboard and the');
    line('  hosted admin will come up.');
    return;
  }

  line('\nDone. Open /admin.html on the live site and sign in with the same');
  line('password you use locally.');
})().catch((err) => {
  if (err && err.message === 'stop') return;
  line('\n  x ' + String((err && err.message) || err));
  process.exitCode = 1;
});
