/**
 * Cloudflare Worker CORS Proxy for Aviation Weather Data
 * 
 * Deploy this to Cloudflare Workers:
 * 1. Go to https://workers.cloudflare.com
 * 2. Create a new Worker
 * 3. Paste this code
 * 4. Save and deploy
 * 5. Update the WORKER_URL in pro_beta.html with your worker URL
 */

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  // Only allow GET requests
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  // Get the target URL from query parameter
  const url = new URL(request.url);
  const targetUrl = url.searchParams.get('url');

  if (!targetUrl) {
    return new Response('Missing url parameter', { status: 400 });
  }

  // Validate that the URL is from aviationweather.gov
  try {
    const targetUrlObj = new URL(targetUrl);
    if (!targetUrlObj.hostname.includes('aviationweather.gov')) {
      return new Response('Invalid domain', { status: 403 });
    }
  } catch (e) {
    return new Response('Invalid URL', { status: 400 });
  }

  try {
    // Fetch the target URL
    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; WeatherApp/1.0)',
      },
    });

    // Check if the response is ok
    if (!response.ok) {
      return new Response(`Upstream error: ${response.status}`, { 
        status: response.status 
      });
    }

    // Get the response body as array buffer to preserve binary data (gzip)
    const arrayBuffer = await response.arrayBuffer();

    // Create new response with CORS headers
    return new Response(arrayBuffer, {
      status: response.status,
      statusText: response.statusText,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': response.headers.get('Content-Type') || 'application/octet-stream',
        'Content-Encoding': response.headers.get('Content-Encoding') || '',
        'Cache-Control': 'public, max-age=60',
      },
    });
  } catch (error) {
    return new Response(`Proxy error: ${error.message}`, { 
      status: 500 
    });
  }
}

