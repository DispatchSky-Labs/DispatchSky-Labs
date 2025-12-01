# Cloudflare Worker CORS Proxy Setup

This guide will help you set up a Cloudflare Worker to act as a CORS proxy for fetching aviation weather data.

## Step 1: Create a Cloudflare Account (if you don't have one)

1. Go to https://dash.cloudflare.com/sign-up
2. Sign up for a free account

## Step 2: Create a Worker

1. Go to https://workers.cloudflare.com
2. Click "Create a Worker"
3. Give it a name (e.g., `weather-cors-proxy`)
4. Choose a subdomain (e.g., `weather-cors-proxy.your-subdomain.workers.dev`)

## Step 3: Deploy the Worker Code

1. In the Worker editor, delete the default code
2. Copy the contents of `cloudflare-worker-cors-proxy.js`
3. Paste it into the editor
4. Click "Save and Deploy"

## Step 4: Get Your Worker URL

After deployment, your worker will be available at:
```
https://weather-cors-proxy.your-subdomain.workers.dev
```

(Replace with your actual worker name and subdomain)

## Step 5: Configure the HTML File

1. Open `pro_beta.html` in a text editor
2. In the browser console, run:
```javascript
localStorage.setItem('ct_cloudflare_worker_url', 'https://your-worker-name.your-subdomain.workers.dev');
```
3. Refresh the page

Or you can hardcode it by finding this line in the code:
```javascript
const CLOUDFLARE_WORKER_URL=localStorage.getItem('ct_cloudflare_worker_url')||'';
```

And change it to:
```javascript
const CLOUDFLARE_WORKER_URL='https://your-worker-name.your-subdomain.workers.dev';
```

## Step 6: Test

1. Open `pro_beta.html` in your browser
2. Check the browser console for any errors
3. The weather data should now load successfully!

## Troubleshooting

- **Worker not responding**: Make sure the worker is deployed and the URL is correct
- **CORS errors still appearing**: Check that the worker URL includes the `?url=` parameter format
- **403 errors**: The worker validates that URLs are from aviationweather.gov - make sure you're using the correct URLs

## Custom Domain (Optional)

If you want to use a custom domain:
1. Go to your Cloudflare Worker settings
2. Click "Add Custom Domain"
3. Add your domain (e.g., `weather-proxy.sadiom.com`)
4. Update the worker URL in the HTML file

## Rate Limits

Cloudflare Workers free tier includes:
- 100,000 requests per day
- This should be more than enough for weather data updates every minute

