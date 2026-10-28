/* Google reviews proxy — runs on Vercel, never in the browser.
 *
 * The API key lives only in this function's environment. The browser calls
 * /api/reviews and gets back plain JSON with no credentials in it.
 *
 * Required environment variables (Vercel → Settings → Environment Variables):
 *   GOOGLE_PLACES_API_KEY   key with "Places API (New)" enabled
 *   GOOGLE_PLACE_ID         the place ID of the Golden Qube listing
 */

const PLACES_ENDPOINT = 'https://places.googleapis.com/v1/places/';
const FIELD_MASK = 'id,displayName,rating,userRatingCount,googleMapsUri,reviews';

/* A warm serverless instance keeps this between calls. It is the last
   response Google gave us, so a later outage can still be answered with
   real reviews instead of an error. */
let lastGood = null;

module.exports = async (req, res) => {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  const placeId = process.env.GOOGLE_PLACE_ID;

  if (!key || !placeId) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({
      ok: false,
      error: 'not_configured',
      message: 'Set GOOGLE_PLACES_API_KEY and GOOGLE_PLACE_ID on the Vercel project.'
    });
  }

  try {
    const upstream = await fetch(PLACES_ENDPOINT + encodeURIComponent(placeId), {
      headers: {
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': FIELD_MASK
      }
    });

    if (!upstream.ok) {
      const detail = (await upstream.text()).slice(0, 300);
      throw new Error('Places API ' + upstream.status + ': ' + detail);
    }

    const payload = shape(await upstream.json());
    if (!payload.reviews.length && lastGood) throw new Error('empty review list');

    lastGood = payload;

    /* This one header is the hourly refresh. Vercel's CDN serves the cached
       copy for an hour, then keeps serving it while it fetches a fresh one in
       the background — so visitors never wait on Google, and Google sees at
       most ~24 calls a day no matter how much traffic the site gets. */
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json(payload);

  } catch (err) {
    if (lastGood) {
      // hand back the last good copy, and retry sooner than the usual hour
      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600');
      return res.status(200).json(Object.assign({}, lastGood, { stale: true }));
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({
      ok: false,
      error: 'upstream_failed',
      message: String((err && err.message) || err)
    });
  }
};

/* Google's shape is verbose and will keep changing — flatten it to just what
   the cards render, so the front end never touches the raw response. */
function shape(place) {
  const reviews = (place.reviews || []).map(r => {
    const who = r.authorAttribution || {};
    return {
      name: who.displayName || 'Google user',
      photo: who.photoUri || '',
      profile: who.uri || '',
      rating: Number(r.rating) || 0,
      text: ((r.originalText && r.originalText.text) || (r.text && r.text.text) || '').trim(),
      publishedAt: r.publishTime || '',
      relative: r.relativePublishTimeDescription || ''
    };
  }).filter(r => r.text);

  return {
    ok: true,
    place: (place.displayName && place.displayName.text) || '',
    rating: typeof place.rating === 'number' ? place.rating : null,
    total: typeof place.userRatingCount === 'number' ? place.userRatingCount : null,
    url: place.googleMapsUri || '',
    reviews,
    fetchedAt: new Date().toISOString()
  };
}
