# Golden Qube — gqtraining.vercel.app

Marketing site for Golden Qube, an AI digital marketing training academy.
Static HTML, CSS and vanilla JavaScript — no framework and no build step.

## Pages

| File | Page |
|---|---|
| `index.html` | Home |
| `training.html` | Training course details |
| `blog.html` | Blog |
| `post.html` | A single article, chosen by `?p=<slug>` |
| `contact.html` | Contact |
| `admin.html` | Password-protected blog manager (not linked from the site) |

`styles.css` and `script.js` are shared by the public pages. Training-page
styles are prefixed `tp-` so they cannot affect the other pages. The admin page
is deliberately separate — it loads only `admin.css` and `admin.js`.

## Running it

Any static file server will do:

```bash
python -m http.server 8080
```

Then open <http://localhost:8080/>.

One thing will not work locally: the Google reviews in Learner Stories. That
needs the serverless function below, which only runs on Vercel. The page falls
back to the testimonials written into the HTML, which is the intended
behaviour when the API is unavailable.

## Google reviews

`api/reviews.js` is a Vercel serverless function that fetches reviews from the
Google Places API. The key never reaches the browser. Set these on the Vercel
project before it will return anything:

- `GOOGLE_PLACES_API_KEY` — a key with **Places API (New)** enabled
- `GOOGLE_PLACE_ID` — the place ID of the Golden Qube listing

It caches for an hour at the CDN edge and keeps the last good response to serve
during an outage, so the section never empties out.

Note: the Places API returns at most 5 reviews and Google chooses which.

## Blog admin

`admin.html` manages the articles on the blog page. It is not linked from
anywhere on the site and is excluded in `robots.txt`; reach it at
`/admin.html`.

**How the pieces fit together**

- `data/posts.json` is the only source of truth for the blog.
- `blog-render.js` reads that file on `blog.html` and `post.html`. It runs in
  the browser with no server involved.
- `api/admin.js` handles login and writes. Either way the result is a commit
  that changes `data/posts.json`, which triggers a Vercel deploy — so the live
  blog updates roughly a minute after you press save.
- Uploaded images go to `assets/img/blog/` in the same commit.

There are two ways it can store a save, chosen by `BLOG_STORE`:

| Store | Used by | How it publishes |
|---|---|---|
| `local` | `dev-server.js` on your machine | Writes the files to the working copy, then `git add`, `commit`, `push`. Needs **no GitHub token** — git is already authenticated. |
| `github` | the admin hosted on Vercel | Commits through the GitHub Contents API, because there is no working copy there. |

**Running the admin on your own machine (the way it works today)**

```bash
node dev-server.js
```

Then open <http://localhost:4321/admin.html> and sign in. Saving writes
`data/posts.json`, commits and pushes it, and the public blog follows the
deploy about a minute later. Only the admin screen is local; visitors see the
normal live site.

The only value it needs is `ADMIN_PASSWORD` in `.env.local`, which is already
there. Set `GIT_AUTOPUSH=0` if you would rather it wrote the files and left
committing to you.

**Environment variables** (Vercel → Settings → Environment Variables, or
`.env.local` for the local server above)

| Name | Required | What it is |
|---|---|---|
| `ADMIN_PASSWORD` | yes | The login password |
| `BLOG_STORE` | no | `local` or `github`. `dev-server.js` sets `local`; elsewhere it defaults to `github` |
| `GIT_AUTOPUSH` | no | `local` store only. `0` writes the files without committing |
| `GITHUB_TOKEN` | github store only | Fine-grained PAT, **Contents: Read and write** on this repo |
| `GITHUB_REPO` | no | Defaults to `Athul9544/Gqtraining-` |
| `GITHUB_BRANCH` | no | Defaults to `main` |
| `ADMIN_SESSION_SECRET` | no | Signs session cookies; falls back to `ADMIN_PASSWORD` |

Redeploy after adding them — environment variables are only picked up by a new
deployment. Until both required values are set, the login screen says which one
is missing.

**How the password is handled.** It exists only as a Vercel environment
variable. The browser posts an attempt to `/api/admin`, the server compares it
with a constant-time hash check and replies with an HttpOnly, Secure,
SameSite=Strict cookie signed with HMAC-SHA256. No page, script or committed
file contains the password, and the session cookie cannot be read by
JavaScript. Repeated failures from one address are throttled.

Changing the password is a one-field edit in Vercel followed by a redeploy.
That also invalidates every existing session, because the cookie signature is
derived from it.

**What a post can contain.** Title, tag, date, a short description for the
card, an image, alt text, article text, and an optional external link. Leave
the article text empty and set an external link to make "Read More" point
somewhere else; leave both empty and the card simply has no link. Untick
*Published* to keep a post off the blog as a draft.

Article text takes a small, deliberately limited subset of Markdown — `##`
headings, `-` bullets, `**bold**`, `*italic*` and `[text](url)`. Everything
else is rendered as plain text, so a post can never inject HTML into the page.

## Deploying

```bash
vercel deploy --prod
vercel alias set <deployment-url> gqtraining.vercel.app
```

## Still to do

- **The Vercel team is blocked** — "Your Team exceeded our fair use limits and
  has been blocked." Writes to the project API are refused, so no environment
  variables can be added to the project, and `gqtraining.vercel.app` returns
  402. Deployments from GitHub still work and `gqtraining-ruby.vercel.app`
  serves normally. This is a billing/support matter in the Vercel dashboard.

  The blog admin does not depend on it — `node dev-server.js` publishes
  through git. Hosting the admin at `/admin.html` does, as do the Google
  reviews below.
- **The GitHub token can read but not write.** GitHub refuses with *"Resource
  not accessible by personal access token"*. It is only needed by the `github`
  store, so nothing is blocked by it today. To use it later, grant
  **Contents: Read and write** at GitHub → Settings → Developer settings →
  Fine-grained tokens → that token → Repository permissions. Editing the
  permission does not change the token value.
- The floating WhatsApp button on `index.html`, `training.html` and `blog.html`
  still points at the placeholder `wa.me/910000000000`. It was removed from
  `contact.html`.
- `aiqube.team@gmail.com` is still the Enrol Now address on `index.html` and
  `blog.html`; the contact page now uses `Goldenqubetraining@gmail.com`.
- A form endpoint. The contact form and the footer subscribe both validate
  input and show a confirmation, but nothing is actually sent anywhere.
- Learner Stories testimonials are placeholder copy with stock photography.
  See `assets/img/CREDITS.txt`.
- `assets/logos/CREDITS.txt` lists logo sources and the one tool still using a
  lettered tile instead of a real logo.
