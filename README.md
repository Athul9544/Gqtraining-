# Golden Qube — gqtraining.vercel.app

Marketing site for Golden Qube, an AI digital marketing training academy.
Static HTML, CSS and vanilla JavaScript — no framework and no build step.

## Pages

| File | Page |
|---|---|
| `index.html` | Home |
| `training.html` | Training course details |
| `blog.html` | Blog |
| `contact.html` | Contact |

`styles.css` and `script.js` are shared by all four. Training-page styles are
prefixed `tp-` so they cannot affect the other pages.

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

## Deploying

```bash
vercel deploy --prod
vercel alias set <deployment-url> gqtraining.vercel.app
```

## Still to do

- Real phone and WhatsApp number — currently `+910000000000`
- Office address — currently "Address to be added"
- A form endpoint. The contact form and the footer subscribe both validate
  input and show a confirmation, but nothing is actually sent anywhere.
- Learner Stories testimonials are placeholder copy with stock photography.
  See `assets/img/CREDITS.txt`.
- `assets/logos/CREDITS.txt` lists logo sources and the one tool still using a
  lettered tile instead of a real logo.
