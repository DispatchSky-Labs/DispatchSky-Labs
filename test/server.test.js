import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.NODE_ENV = "test";
process.env.EDCT_SOURCE_URL = "https://secret-source.example/edct";
process.env.EDCT_SOURCE_TOKEN = "";
process.env.ADMIN_TOKEN = "admin-test";
process.env.EDCT_IDLE_SLEEP_MINUTES = "60";
process.env.EDCT_IP_ENRICHMENT_PROVIDER = "ipapi";
process.env.EDCT_DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "edct-api-")), "db.json");

const mod = await import(`../src/server.js?test=${Date.now()}`);
const { isPublicIp, server, store } = mod;
const service = await import(`../src/edctService.js?test=${Date.now()}`);
const nasService = await import("../src/nasStatusService.js");
const originalFetch = global.fetch;

function listen() {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

function close() {
  return new Promise((resolve) => server.close(resolve));
}

test("API output and browser files do not expose source config", async () => {
  const publicText = fs.readFileSync(new URL("../edct/app.js", import.meta.url), "utf8") +
    fs.readFileSync(new URL("../edct/index.html", import.meta.url), "utf8") +
    fs.readFileSync(new URL("../edct/config.js", import.meta.url), "utf8");
  assert.equal(publicText.includes("secret-source"), false);
  assert.equal(publicText.includes("super-secret-token"), false);
  const base = await listen();
  try {
    const response = await fetch(`${base}/api/session`);
    const text = await response.text();
    assert.equal(text.includes("secret-source"), false);
    assert.equal(text.includes("super-secret-token"), false);
    assert.match(response.headers.get("set-cookie"), /HttpOnly/);
    assert.match(response.headers.get("set-cookie"), /Secure/);
    assert.match(response.headers.get("content-security-policy"), /connect-src 'self' https:\/\/api\.sadiom\.com/);
    assert.equal(response.headers.get("cache-control"), "no-store");
  } finally {
    await close();
  }
});

test("health endpoint is sanitized and does not create a session", async () => {
  const base = await listen();
  try {
    const response = await fetch(`${base}/api/health`, { headers: { origin: "https://sadiom.com" } });
    const text = await response.text();
    const body = JSON.parse(text);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("access-control-allow-origin"), "https://sadiom.com");
    assert.equal(body.ok, true);
    assert.equal(body.service, "sadiom-edct-api");
    assert.equal(text.includes("secret-source"), false);
    assert.equal(text.includes("super-secret-token"), false);
    assert.equal(text.includes("EDCT_SOURCE"), false);
  } finally {
    await close();
  }
});

test("session persists across browser refresh via httpOnly cookie", async () => {
  const base = await listen();
  try {
    const first = await fetch(`${base}/api/session`);
    const cookie = first.headers.get("set-cookie").split(";")[0];
    const firstJson = await first.json();
    const second = await fetch(`${base}/api/session`, { headers: { cookie } });
    const secondJson = await second.json();
    assert.deepEqual(firstJson.session, secondJson.session);
    assert.equal(JSON.stringify(secondJson).includes("workspace_id"), false);
  } finally {
    await close();
  }
});

test("manually deleting a flight removes only its EDCT and notification history", async () => {
  const base = await listen();
  const now = new Date();
  const nowIso = now.toISOString();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  try {
    const sessionResponse = await fetch(`${base}/api/session`);
    const cookie = sessionResponse.headers.get("set-cookie").split(";")[0];
    const sessionId = cookie.split("=")[1];
    const workspaceId = store.data.sessions.find((session) => session.id === sessionId).workspace_id;
    const removedFlight = store.insert("flights", {
      id: `flight_events_removed_${suffix}`,
      workspace_id: workspaceId,
      display_flight_number: "SKW1001",
      normalized_acid: "SKW1001",
      origin: "DEN",
      destination: "SFO",
      etd_utc: `${yesterday}T12:00:00.000Z`,
      operational_day_key: yesterday,
      active: true,
      created_at: nowIso,
      updated_at: nowIso
    });
    const retainedFlight = store.insert("flights", {
      id: `flight_events_retained_${suffix}`,
      workspace_id: workspaceId,
      display_flight_number: "SKW1002",
      normalized_acid: "SKW1002",
      origin: "DEN",
      destination: "SFO",
      etd_utc: `${yesterday}T12:00:00.000Z`,
      operational_day_key: yesterday,
      active: true,
      created_at: nowIso,
      updated_at: nowIso
    });
    const insertEvent = (id, workspace, flightId, message, createdAt) => store.insert("edct_events", {
      id,
      workspace_id: workspace,
      flight_id: flightId,
      flight_signature: `${id}|${yesterday}`,
      event_type: "EDCT_ASSIGNED",
      previous_edct_utc: null,
      new_edct_utc: nowIso,
      delay_minutes: 20,
      source_airport: "SFO",
      source_fetch_at: nowIso,
      message,
      created_at: createdAt
    });

    const removedEvent = insertEvent(
      `event_events_removed_${suffix}`,
      workspaceId,
      removedFlight.id,
      `removed-flight-${suffix}`,
      nowIso
    );
    const retainedEvent = insertEvent(
      `event_events_retained_${suffix}`,
      workspaceId,
      retainedFlight.id,
      `retained-flight-${suffix}`,
      new Date(now.getTime() - 1000).toISOString()
    );
    const removedNotification = store.insert("notification_events", {
      id: `notification_events_removed_${suffix}`,
      workspace_id: workspaceId,
      edct_event_id: removedEvent.id,
      title: "Removed flight alert",
      body: removedEvent.message,
      created_at: nowIso
    });
    const retainedNotification = store.insert("notification_events", {
      id: `notification_events_retained_${suffix}`,
      workspace_id: workspaceId,
      edct_event_id: retainedEvent.id,
      title: "Retained flight alert",
      body: retainedEvent.message,
      created_at: nowIso
    });
    store.insert("notification_deliveries", {
      notification_event_id: removedNotification.id,
      session_id: sessionId,
      delivery_state: "failed",
      attempted_at: nowIso,
      delivered_at: null
    });

    const initialResponse = await fetch(`${base}/api/edct/events`, { headers: { cookie } });
    assert.equal(initialResponse.status, 200);
    const initial = await initialResponse.json();
    assert.deepEqual(initial.events.map((event) => event.message), [removedEvent.message, retainedEvent.message]);

    const deleteResponse = await fetch(`${base}/api/flights/${removedFlight.id}`, { method: "DELETE", headers: { cookie } });
    assert.equal(deleteResponse.status, 200);
    const afterDeleteResponse = await fetch(`${base}/api/edct/events`, { headers: { cookie } });
    const afterDelete = await afterDeleteResponse.json();
    assert.deepEqual(afterDelete.events.map((event) => event.message), [retainedEvent.message]);
    assert.equal(store.data.edct_events.some((event) => event.id === removedEvent.id), false);
    assert.equal(store.data.edct_events.some((event) => event.id === retainedEvent.id), true);
    assert.equal(store.data.notification_events.some((notification) => notification.id === removedNotification.id), false);
    assert.equal(store.data.notification_events.some((notification) => notification.id === retainedNotification.id), true);
    assert.equal(store.data.notification_deliveries.some((delivery) => delivery.notification_event_id === removedNotification.id), false);

    const pendingResponse = await fetch(`${base}/api/notifications/pending`, { headers: { cookie } });
    const pending = await pendingResponse.json();
    assert.deepEqual(pending.notifications.map((notification) => notification.notification_key), [retainedNotification.id]);
  } finally {
    await close();
  }
});

test("admin API requires bearer auth and admin page is not publicly served", async () => {
  const base = await listen();
  try {
    const queryAuth = await fetch(`${base}/api/admin/usage?token=admin-test`);
    assert.equal(queryAuth.status, 403);
    assert.equal(queryAuth.headers.get("cache-control"), "no-store");
    assert.match(queryAuth.headers.get("x-robots-tag"), /noindex/);
    const bearerAuth = await fetch(`${base}/api/admin/usage`, { headers: { authorization: "Bearer admin-test" } });
    assert.equal(bearerAuth.status, 200);
    assert.equal(bearerAuth.headers.get("cache-control"), "no-store");
    const summaryQueryAuth = await fetch(`${base}/api/admin/summary?token=admin-test`);
    assert.equal(summaryQueryAuth.status, 403);
    assert.match(summaryQueryAuth.headers.get("x-robots-tag"), /noindex/);
    const summaryBearerAuth = await fetch(`${base}/api/admin/summary`, { headers: { authorization: "Bearer admin-test" } });
    assert.equal(summaryBearerAuth.status, 200);
    assert.equal(summaryBearerAuth.headers.get("cache-control"), "no-store");
    const summaryText = await summaryBearerAuth.text();
    const summary = JSON.parse(summaryText);
    assert.equal(summary.backendState, "awake");
    assert.equal(typeof summary.activeSessionsNow, "number");
    assert.equal(typeof summary.uniqueProfilesToday, "number");
    assert.ok(Array.isArray(summary.topDestinations));
    assert.ok(Array.isArray(summary.topCallsignPrefixes));
    assert.ok(Array.isArray(summary.likelyOperatorSignals));
    assert.ok(Array.isArray(summary.activeProfiles));
    assert.ok(Array.isArray(summary.recentProfiles));
    assert.equal(typeof summary.securitySummary, "object");
    assert.equal(summaryText.includes("secret-source"), false);
    assert.equal(summaryText.includes("source_record"), false);
    assert.equal(summaryText.includes("normalized_records"), false);
    assert.equal(summaryText.includes("workspace_id"), false);
    assert.equal(summaryText.includes("session_id"), false);
    assert.equal(summaryText.includes("ip_hash"), false);
    const adminPage = await fetch(`${base}/edct/admin`);
    assert.equal(adminPage.status, 404);
  } finally {
    await close();
  }
});

test("heartbeat updates active session state without noisy heartbeat events", async () => {
  const base = await listen();
  try {
    const initial = await fetch(`${base}/api/session`);
    const cookie = initial.headers.get("set-cookie").split(";")[0];
    const heartbeat = await fetch(`${base}/api/session/heartbeat`, { method: "POST", headers: { cookie } });
    assert.equal(heartbeat.status, 200);
    const heartbeatBody = await heartbeat.json();
    assert.ok(heartbeatBody.lastHeartbeatAt);
    assert.equal(store.data.usage_events.some((event) => event.event_type === "HEARTBEAT_SEEN"), false);

    const session = store.data.sessions.find((item) => item.last_heartbeat_at === heartbeatBody.lastHeartbeatAt);
    assert.ok(session);
    assert.equal(Boolean(session.last_activity_at), true);

    const oldTs = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    for (const existing of store.data.sessions) {
      store.update("sessions", existing.id, { last_seen_at: oldTs, last_activity_at: oldTs, last_heartbeat_at: oldTs });
    }
    const summary = await fetch(`${base}/api/admin/summary`, { headers: { authorization: "Bearer admin-test" } });
    const body = await summary.json();
    assert.equal(body.activeSessionsNow, 0);
  } finally {
    await close();
  }
});

test("admin profiles expose enriched device geo network and watched flight activity", async () => {
  const base = await listen();
  const now = new Date().toISOString();
  try {
    const sessionWorkspace = store.insert("workspaces", {
      id: "ws_profile_home",
      created_at: now,
      updated_at: now,
      optional_label: "",
      monitoring_enabled: true,
      refresh_interval_minutes: 5
    });
    const flightWorkspace = store.insert("workspaces", {
      id: "ws_profile_flights",
      created_at: now,
      updated_at: now,
      optional_label: "",
      monitoring_enabled: true,
      refresh_interval_minutes: 5
    });
    store.insert("sessions", {
      id: "sess_profile_enriched",
      workspace_id: sessionWorkspace.id,
      created_at: now,
      last_seen_at: now,
      last_activity_at: now,
      last_heartbeat_at: now,
      user_agent_approx: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
      ip_hash: "redacted",
      country: "US",
      region: "UT",
      region_label: "Utah",
      city: "Salt Lake City",
      timezone: "America/Denver",
      timezone_label: "Mountain Time",
      asn: "AS7922",
      organization: "Comcast",
      notification_permission: "granted",
      api_activity_count: 3,
      page_load_count: 2
    });
    store.usage("LOOKUP_ATTEMPTED", flightWorkspace.id, "sess_profile_enriched", { destination: "SFO" });
    for (const [flightNumber, origin, destination] of [
      ["SKW5592", "RDD", "SFO"],
      ["UAL1597", "CMH", "SFO"],
      ["AAL3288", "ORD", "PHX"]
    ]) {
      store.insert("flights", {
        workspace_id: flightWorkspace.id,
        display_flight_number: flightNumber,
        normalized_acid: flightNumber,
        origin,
        destination,
        etd_utc: now,
        operational_day_key: now.slice(0, 10),
        active: true,
        created_at: now,
        updated_at: now
      });
    }
    const response = await fetch(`${base}/api/admin/summary`, { headers: { authorization: "Bearer admin-test" } });
    assert.equal(response.status, 200);
    const text = await response.text();
    const body = JSON.parse(text);
    const profile = body.recentProfiles.find((item) => item.organization === "Comcast");
    assert.ok(profile);
    assert.equal(profile.browser, "Safari");
    assert.equal(profile.platform, "macOS");
    assert.equal(profile.approximateDevice, "Mac");
    assert.equal(profile.region, "Utah");
    assert.equal(profile.timezone, "Mountain Time");
    assert.equal(profile.asn, "AS7922");
    assert.equal(profile.currentWatchedFlightsCount, 3);
    assert.deepEqual(profile.topDestinations.map((item) => item.airport).sort(), ["PHX", "SFO"]);
    assert.deepEqual(profile.topCallsignPrefixes.map((item) => item.prefix).sort(), ["AAL", "SKW", "UAL"]);
    assert.equal(profile.inferredUserType, "Likely Pilot");
    assert.equal(text.includes("workspace_id"), false);
    assert.equal(text.includes("session_id"), false);
    assert.equal(text.includes("ip_hash"), false);
    assert.equal(text.includes("source_record"), false);
  } finally {
    await close();
  }
});

test("admin profile device browser detection handles common dispatcher browsers", async () => {
  const base = await listen();
  const now = new Date().toISOString();
  const cases = [
    {
      id: "sess_ua_safari_iphone",
      organization: "UA Safari iPhone",
      ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      browser: "Safari",
      platform: "iOS",
      device: "iPhone"
    },
    {
      id: "sess_ua_chrome_windows",
      organization: "UA Chrome Windows",
      ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      browser: "Chrome",
      platform: "Windows",
      device: "Windows PC"
    },
    {
      id: "sess_ua_edge_windows",
      organization: "UA Edge Windows",
      ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0",
      browser: "Edge",
      platform: "Windows",
      device: "Windows PC"
    },
    {
      id: "sess_ua_android_tablet",
      organization: "UA Android Tablet",
      ua: "Mozilla/5.0 (Linux; Android 14; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      browser: "Chrome",
      platform: "Android",
      device: "Android Tablet"
    }
  ];
  try {
    for (const item of cases) {
      const workspace = store.insert("workspaces", {
        id: `ws_${item.id}`,
        created_at: now,
        updated_at: now,
        optional_label: "",
        monitoring_enabled: true,
        refresh_interval_minutes: 5
      });
      store.insert("sessions", {
        id: item.id,
        workspace_id: workspace.id,
        created_at: now,
        last_seen_at: now,
        last_activity_at: now,
        last_heartbeat_at: now,
        user_agent_approx: item.ua,
        ip_hash: "redacted",
        country: "US",
        region: "CA",
        region_label: "California",
        city: "Los Angeles",
        timezone: "America/Los_Angeles",
        timezone_label: "Pacific Time",
        asn: "AS000",
        organization: item.organization,
        notification_permission: "default",
        api_activity_count: 1,
        page_load_count: 1
      });
    }
    const response = await fetch(`${base}/api/admin/summary`, { headers: { authorization: "Bearer admin-test" } });
    assert.equal(response.status, 200);
    const body = await response.json();
    for (const item of cases) {
      const profile = body.recentProfiles.find((candidate) => candidate.organization === item.organization);
      assert.ok(profile, item.organization);
      assert.equal(profile.browser, item.browser);
      assert.equal(profile.platform, item.platform);
      assert.equal(profile.approximateDevice, item.device);
    }
  } finally {
    await close();
  }
});

test("IP enrichment accepts public IPv6 and stores sanitized network fields", async () => {
  const base = await listen();
  const publicIpv6 = "2601:681:4300:1234::abcd";
  assert.equal(isPublicIp(publicIpv6), true);
  assert.equal(isPublicIp("fd12:3456:789a::1"), false);
  assert.equal(isPublicIp("fe80::1"), false);
  global.fetch = async (url, init) => {
    if (String(url).startsWith(base)) return originalFetch(url, init);
    assert.match(String(url), /^https:\/\/ipapi\.co\//);
    assert.equal(init.headers.accept, "application/json");
    return new Response(JSON.stringify({
      country_code: "US",
      region: "Utah",
      city: "Salt Lake City",
      timezone: "America/Denver",
      asn: "AS7922",
      org: "Comcast Cable Communications LLC"
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const response = await fetch(`${base}/api/session`, {
      headers: {
        "x-forwarded-for": `10.0.0.10, ${publicIpv6}`,
        "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/125.0.0.0 Mobile/15E148 Safari/604.1"
      }
    });
    assert.equal(response.status, 200);
    const cookie = response.headers.get("set-cookie").split(";")[0];
    const summary = await fetch(`${base}/api/admin/summary`, {
      headers: { authorization: "Bearer admin-test", cookie }
    });
    const body = await summary.json();
    const profile = body.recentProfiles.find((item) => item.organization === "Comcast");
    assert.ok(profile);
    assert.equal(profile.region, "Utah");
    assert.equal(profile.timezone, "Mountain Time");
    assert.equal(profile.asn, "AS7922");
    assert.equal(profile.browser, "Chrome");
    assert.equal(profile.platform, "iOS");
    assert.equal(profile.approximateDevice, "iPhone");
    global.fetch = async (url, init) => {
      if (String(url).startsWith(base)) return originalFetch(url, init);
      return new Response("provider unavailable", { status: 503 });
    };
    await fetch(`${base}/api/session`, {
      headers: {
        cookie,
        "x-forwarded-for": "198.51.100.20",
        "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/125.0.0.0 Mobile/15E148 Safari/604.1"
      }
    });
    const preserved = await fetch(`${base}/api/admin/summary`, {
      headers: { authorization: "Bearer admin-test", cookie }
    });
    const preservedBody = await preserved.json();
    const preservedProfile = preservedBody.recentProfiles.find((item) => item.shortSessionId === profile.shortSessionId);
    assert.equal(preservedProfile.organization, "Comcast");
    assert.equal(preservedProfile.asn, "AS7922");
  } finally {
    global.fetch = originalFetch;
    await close();
  }
});

test("IP enrichment falls back when the configured provider returns empty", async () => {
  const base = await listen();
  global.fetch = async (url, init) => {
    if (String(url).startsWith(base)) return originalFetch(url, init);
    if (String(url).startsWith("https://ipapi.co/")) {
      return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (String(url).startsWith("https://ipinfo.io/")) {
      return new Response(JSON.stringify({
        country: "US",
        region: "California",
        city: "San Francisco",
        timezone: "America/Los_Angeles",
        org: "AS714 Apple Inc."
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return originalFetch(url, init);
  };
  try {
    const response = await fetch(`${base}/api/session`, {
      headers: {
        "x-forwarded-for": "17.58.1.1",
        "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/125.0.0.0 Mobile/15E148 Safari/604.1"
      }
    });
    assert.equal(response.status, 200);
    const cookie = response.headers.get("set-cookie").split(";")[0];
    const summary = await fetch(`${base}/api/admin/summary`, {
      headers: { authorization: "Bearer admin-test", cookie }
    });
    const body = await summary.json();
    const profile = body.recentProfiles.find((item) => item.organization === "Apple Inc.");
    assert.ok(profile);
    assert.equal(profile.region, "California");
    assert.equal(profile.timezone, "Pacific Time");
    assert.equal(profile.asn, "AS714");
  } finally {
    global.fetch = originalFetch;
    await close();
  }
});

test("CORS allows only approved origins and supports credentialed preflight", async () => {
  const base = await listen();
  try {
    const approved = await fetch(`${base}/api/session`, { headers: { origin: "https://sadiom.com" } });
    assert.equal(approved.status, 200);
    assert.equal(approved.headers.get("access-control-allow-origin"), "https://sadiom.com");
    assert.equal(approved.headers.get("access-control-allow-credentials"), "true");
    assert.match(approved.headers.get("set-cookie"), /SameSite=None/);
    const preflight = await fetch(`${base}/api/flights`, {
      method: "OPTIONS",
      headers: {
        origin: "https://sadiom.com",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type"
      }
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "https://sadiom.com");
    const rejected = await fetch(`${base}/api/session`, { headers: { origin: "https://unapproved.example" } });
    assert.equal(rejected.status, 403);
    assert.equal(rejected.headers.get("access-control-allow-origin"), null);
  } finally {
    await close();
  }
});

test("flight lookup returns sanitized candidates and can add one to monitoring", async () => {
  const base = await listen();
  const cookieRes = await fetch(`${base}/api/session`);
  const cookie = cookieRes.headers.get("set-cookie").split(";")[0];
  const sourceUrls = [];
  const sourceRequests = [];
  global.fetch = async (url, init) => {
    if (String(url).startsWith(base)) return originalFetch(url, init);
    sourceUrls.push(String(url));
    sourceRequests.push(init);
    return new Response(JSON.stringify({
      timeBuckets: [
        { flights: [{ acid: "SKW5592", origin: "RDD", destination: "SFO", etd: "E05/1500" }] },
        { flights: [{ acid: "SKW5592", origin: "FAT", destination: "SFO", etd: "E05/1515" }] },
        { flights: [{ acid: "UAL1597", origin: "CMH", destination: "SFO" }] }
      ]
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const missingDestination = await fetch(`${base}/api/edct/lookup?flight=5592&origin=RDD`, { headers: { cookie } });
    assert.equal(missingDestination.status, 400);
    const lookup = await fetch(`${base}/api/edct/lookup?flight=5592&origin=RDD&destination=SFO`, { headers: { cookie } });
    const text = await lookup.text();
    const body = JSON.parse(text);
    assert.equal(lookup.status, 200);
    assert.equal(body.candidates.length, 2);
    assert.equal(sourceUrls.length, 1);
    assert.ok(sourceUrls[0].includes("airport=SFO"));
    assert.equal(sourceRequests[0].headers.authorization, undefined);
    assert.equal(body.candidates[0].flight_number, "SKW5592");
    assert.equal(body.candidates[0].origin, "RDD");
    assert.equal(body.candidates[0].destination, "SFO");
    assert.equal(body.candidates[0].current_edct_utc, "2026-06-05T15:00:00.000Z");
    assert.equal(body.candidates[0].normalized_acid, undefined);
    assert.equal(body.candidates[0].candidate_id, undefined);
    assert.ok(body.candidates[0].candidate_key);
    assert.equal(body.candidates[0].status, "matched");
    assert.equal(body.candidates[0].source_freshness_at, undefined);
    const ualLookup = await fetch(`${base}/api/edct/lookup?flight=UAL1597&destination=SFO`, { headers: { cookie } });
    const ualBody = await ualLookup.json();
    assert.equal(ualLookup.status, 200);
    assert.equal(ualBody.candidates.length, 1);
    assert.equal(ualBody.candidates[0].flight_number, "UAL1597");
    assert.equal(ualBody.candidates[0].origin, "CMH");
    assert.equal(ualBody.candidates[0].current_edct_utc, null);
    assert.equal(ualBody.message, "Flight found in SFO feed, no active time.");
    const noMatch = await fetch(`${base}/api/edct/lookup?flight=DAL9999&destination=SFO`, { headers: { cookie } });
    const noMatchBody = await noMatch.json();
    assert.equal(noMatchBody.message, "No matching flight found in destination feed.");
    assert.equal(text.includes("source_record"), false);
    assert.equal(text.includes("etd_raw"), false);
    assert.equal(text.includes("departure_center"), false);
    assert.equal(text.includes("major_airline"), false);
    const added = await fetch(`${base}/api/edct/lookup/add`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ candidate_key: body.candidates[0].candidate_key })
    });
    assert.equal(added.status, 201, await added.text());
    const flights = await fetch(`${base}/api/flights`, { headers: { cookie } });
    const flightBody = await flights.json();
    assert.ok(flightBody.flights.some((f) => f.display_flight_number === "SKW5592" && f.origin === "RDD" && f.destination === "SFO"));
    assert.equal(JSON.stringify(flightBody).includes("normalized_acid"), false);
    assert.equal(JSON.stringify(flightBody).includes("workspace_id"), false);
  } finally {
    global.fetch = originalFetch;
    await close();
  }
});

test("bulk lookup parses rows, groups airport fetches, and marks duplicate watched flights", async () => {
  const base = await listen();
  const cookieRes = await fetch(`${base}/api/session`);
  const cookie = cookieRes.headers.get("set-cookie").split(";")[0];
  const sourceUrls = [];
  global.fetch = async (url, init) => {
    if (String(url).startsWith(base)) return originalFetch(url, init);
    sourceUrls.push(String(url));
    return new Response(JSON.stringify({
      records: [
        { acid: "SKW5592", origin: "RDD", destination: "SEA", etd: "E05/1500" },
        { acid: "UAL1597", origin: "CMH", destination: "SEA", etd: "E05/1600" },
        { acid: "SKW4115", origin: "ABQ", destination: "PDX", etd: "E05/1700" }
      ]
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const first = await fetch(`${base}/api/edct/lookup/bulk`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ text: "SKW5592   SEA\nUAL1597,SEA\nSKW4115\tPDX" })
    });
    assert.equal(first.status, 200, await first.clone().text());
    const body = await first.json();
    assert.equal(body.candidates.length, 3);
    assert.equal(sourceUrls.length, 2);
    assert.equal(JSON.stringify(body).includes("source_record"), false);
    assert.equal(JSON.stringify(body).includes("normalized_acid"), false);
    const added = await fetch(`${base}/api/edct/lookup/add`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ candidate_key: body.candidates[0].candidate_key })
    });
    assert.equal(added.status, 201, await added.text());
    const duplicate = await fetch(`${base}/api/edct/lookup/bulk`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ text: "SKW5592 SEA" })
    });
    const duplicateBody = await duplicate.json();
    assert.equal(duplicateBody.candidates[0].already_watched, true);
    assert.equal(duplicateBody.candidates[0].status, "already_watched");
  } finally {
    global.fetch = originalFetch;
    await close();
  }
});

test("scheduled polling sleeps when idle and wakes for active monitoring", async () => {
  const oldTs = new Date(Date.now() - 61 * 60 * 1000).toISOString();
  for (const flight of store.data.flights) store.update("flights", flight.id, { active: false, updated_at: oldTs });
  for (const existingSession of store.data.sessions) {
    store.update("sessions", existingSession.id, { last_seen_at: oldTs, last_activity_at: oldTs, last_heartbeat_at: oldTs });
  }
  const workspace = store.insert("workspaces", { created_at: oldTs, updated_at: oldTs, optional_label: "", monitoring_enabled: true, refresh_interval_minutes: 5 });
  const session = store.insert("sessions", {
    id: "sess_idle_polling",
    workspace_id: workspace.id,
    created_at: oldTs,
    last_seen_at: oldTs,
    last_activity_at: oldTs,
    last_heartbeat_at: oldTs,
    user_agent_approx: "test",
    ip_hash: "hash",
    notification_permission: "default",
    api_activity_count: 0,
    page_load_count: 0
  });
  service.noteBackendActivity(store, "Backend woke for test");
  const slept = await service.refreshDueAirports(store);
  assert.equal(slept.sleeping, true);
  assert.ok(store.data.admin_events.some((event) => event.event_type === "backend_slept"));

  const now = new Date().toISOString();
  store.update("sessions", session.id, { last_seen_at: now, last_activity_at: now, last_heartbeat_at: now });
  store.insert("flights", {
    workspace_id: workspace.id,
    display_flight_number: "UAL1597",
    normalized_acid: "UAL1597",
    origin: "CMH",
    destination: "PHX",
    etd_utc: now,
    operational_day_key: now.slice(0, 10),
    active: true,
    created_at: now,
    updated_at: now
  });
  let sourceFetches = 0;
  global.fetch = async (url, init) => {
    sourceFetches += 1;
    return new Response(JSON.stringify({ records: [{ acid: "UAL1597", origin: "CMH", destination: "PHX", etd: "E05/1600" }] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const woke = await service.refreshDueAirports(store);
    assert.equal(woke.sleeping, false);
    assert.ok(woke.airports.includes("PHX"));
    assert.equal(sourceFetches, 1);
    assert.ok(store.data.admin_events.some((event) => event.event_type === "backend_woke"));
  } finally {
    global.fetch = originalFetch;
  }
});

test("idle watched flights do not keep scheduled airport polling alive", async () => {
  const oldTs = new Date(Date.now() - 61 * 60 * 1000).toISOString();
  for (const flight of store.data.flights) store.update("flights", flight.id, { active: false, updated_at: oldTs });
  for (const existingSession of store.data.sessions) {
    store.update("sessions", existingSession.id, { last_seen_at: oldTs, last_activity_at: oldTs, last_heartbeat_at: oldTs });
  }
  const workspace = store.insert("workspaces", { created_at: oldTs, updated_at: oldTs, optional_label: "", monitoring_enabled: true, refresh_interval_minutes: 5 });
  store.insert("sessions", {
    id: "sess_idle_watched_flights",
    workspace_id: workspace.id,
    created_at: oldTs,
    last_seen_at: oldTs,
    last_activity_at: oldTs,
    last_heartbeat_at: oldTs,
    user_agent_approx: "test",
    ip_hash: "hash",
    notification_permission: "default",
    api_activity_count: 0,
    page_load_count: 0
  });
  const flight = store.insert("flights", {
    workspace_id: workspace.id,
    display_flight_number: "UAL2222",
    normalized_acid: "UAL2222",
    origin: "ORD",
    destination: "BIL",
    etd_utc: oldTs,
    operational_day_key: oldTs.slice(0, 10),
    active: true,
    created_at: oldTs,
    updated_at: oldTs
  });
  store.upsertState({
    workspace_id: workspace.id,
    normalized_acid: "UAL2222",
    origin: "ORD",
    destination: "BIL",
    operational_day_key: oldTs.slice(0, 10),
    flight_id: flight.id,
    current_edct_utc: "2026-06-05T15:00:00.000Z",
    previous_edct_utc: null,
    last_change: "EDCT_ASSIGNED",
    last_seen_at: oldTs,
    last_source_fetch_at: oldTs,
    source_record: null
  });
  let sourceFetches = 0;
  global.fetch = async () => {
    sourceFetches += 1;
    return new Response(JSON.stringify({ records: [] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const beforeEvents = store.data.edct_events.length;
    const result = await service.refreshDueAirports(store);
    assert.equal(result.sleeping, true);
    assert.equal(sourceFetches, 0);
    assert.equal(store.data.flights.find((item) => item.id === flight.id).active, true);
    assert.equal(store.data.edct_events.length, beforeEvents);
    assert.ok(store.data.admin_events.some((event) => event.event_type === "workspace_idle"));
  } finally {
    global.fetch = originalFetch;
  }
});

test("recent active workspaces share one airport fetch and expose safe source counters", async () => {
  const oldTs = new Date(Date.now() - 61 * 60 * 1000).toISOString();
  const now = new Date().toISOString();
  for (const flight of store.data.flights) store.update("flights", flight.id, { active: false, updated_at: oldTs });
  for (const existingSession of store.data.sessions) {
    store.update("sessions", existingSession.id, { last_seen_at: oldTs, last_activity_at: oldTs, last_heartbeat_at: oldTs });
  }
  const workspaces = ["A", "B"].map((suffix) => store.insert("workspaces", {
    id: `ws_shared_${suffix}`,
    created_at: oldTs,
    updated_at: oldTs,
    optional_label: "",
    monitoring_enabled: true,
    refresh_interval_minutes: 5
  }));
  for (const [index, workspace] of workspaces.entries()) {
    store.insert("sessions", {
      id: `sess_shared_${index}`,
      workspace_id: workspace.id,
      created_at: oldTs,
      last_seen_at: now,
      last_activity_at: now,
      last_heartbeat_at: now,
      user_agent_approx: "test",
      ip_hash: "hash",
      notification_permission: "default",
      api_activity_count: 1,
      page_load_count: 1
    });
    store.insert("flights", {
      workspace_id: workspace.id,
      display_flight_number: `UAL33${index}`,
      normalized_acid: `UAL33${index}`,
      origin: "ORD",
      destination: "TUL",
      etd_utc: now,
      operational_day_key: now.slice(0, 10),
      active: true,
      created_at: now,
      updated_at: now
    });
  }
  const base = await listen();
  let sourceFetches = 0;
  global.fetch = async (url, init) => {
    if (String(url).startsWith(base)) return originalFetch(url, init);
    sourceFetches += 1;
    return new Response(JSON.stringify({ records: [{ acid: "UAL330", origin: "ORD", destination: "TUL", etd: "E05/1600" }] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await service.refreshDueAirports(store);
    assert.equal(result.sleeping, false);
    assert.deepEqual(result.airports, ["TUL"]);
    assert.equal(sourceFetches, 1);
    assert.ok(store.data.admin_events.some((event) => event.event_type === "workspace_woke"));
    const summaryResponse = await fetch(`${base}/api/admin/summary`, { headers: { authorization: "Bearer admin-test" } });
    const summaryText = await summaryResponse.text();
    const summary = JSON.parse(summaryText);
    assert.ok(summary.sourceEfficiency.activePollingAirports.includes("TUL"));
    assert.equal(summary.sourceEfficiency.idleWorkspaces, 0);
    const tul = summary.sourceEfficiency.sourceEfficiencyByAirport.find((item) => item.airport === "TUL");
    assert.ok(tul);
    assert.equal(tul.fetchCount, 1);
    assert.ok(tul.cacheHits >= 1);
    assert.ok(tul.cacheMisses >= 1);
    assert.equal(tul.failures, 0);
    assert.equal(tul.lastFetchReason, "scheduled");
    assert.equal(typeof tul.cacheAgeSeconds, "number");
    assert.equal(summaryText.includes("source_record"), false);
    assert.equal(summaryText.includes("EDCT_SOURCE"), false);
  } finally {
    global.fetch = originalFetch;
    await close();
  }
});

test("admin polling does not wake idle public monitoring", async () => {
  const base = await listen();
  const oldTs = new Date(Date.now() - 61 * 60 * 1000).toISOString();
  for (const flight of store.data.flights) store.update("flights", flight.id, { active: false, updated_at: oldTs });
  for (const existingSession of store.data.sessions) {
    store.update("sessions", existingSession.id, { last_seen_at: oldTs, last_activity_at: oldTs, last_heartbeat_at: oldTs });
  }
  const workspace = store.insert("workspaces", { created_at: oldTs, updated_at: oldTs, optional_label: "", monitoring_enabled: true, refresh_interval_minutes: 5 });
  store.insert("sessions", {
    id: "sess_admin_no_wake",
    workspace_id: workspace.id,
    created_at: oldTs,
    last_seen_at: oldTs,
    last_activity_at: oldTs,
    last_heartbeat_at: oldTs,
    user_agent_approx: "test",
    ip_hash: "hash",
    notification_permission: "default",
    api_activity_count: 0,
    page_load_count: 0
  });
  store.insert("flights", {
    workspace_id: workspace.id,
    display_flight_number: "UAL4444",
    normalized_acid: "UAL4444",
    origin: "ORD",
    destination: "OMA",
    etd_utc: oldTs,
    operational_day_key: oldTs.slice(0, 10),
    active: true,
    created_at: oldTs,
    updated_at: oldTs
  });
  const wakeCountBefore = store.data.admin_events.filter((event) => event.event_type === "backend_woke").length;
  try {
    const response = await fetch(`${base}/api/admin/summary`, { headers: { authorization: "Bearer admin-test" } });
    assert.equal(response.status, 200);
    const summary = await response.json();
    assert.equal(summary.sourceEfficiency.activePollingAirports.includes("OMA"), false);
    assert.ok(summary.sourceEfficiency.idleWorkspaces >= 1);
    assert.equal(store.data.admin_events.filter((event) => event.event_type === "backend_woke").length, wakeCountBefore);
  } finally {
    await close();
  }
});

test("failed source fetch keeps previous EDCT and successful omission removes it", async () => {
  const base = await listen();
  const cookieRes = await fetch(`${base}/api/session`);
  const cookie = cookieRes.headers.get("set-cookie").split(";")[0];
  global.fetch = async (url, init) => {
    if (String(url).startsWith(base)) return originalFetch(url, init);
    return new Response(JSON.stringify({ records: [{ acid: "SKW5338", origin: "FAT", destination: "SAN", etd: "E051500" }] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const created = await fetch(`${base}/api/flights`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ flight_number: "5338", origin: "FAT", destination: "SAN", etd: "2026-06-05T14:00:00.000Z", scheduled_departure_utc: "2026-06-05T14:00:00.000Z" })
    });
    assert.equal(created.status, 201, await created.text());
    let state = store.data.edct_flight_states.find((s) => s.normalized_acid === "SKW5338" && s.origin === "FAT" && s.destination === "SAN");
    assert.ok(state);
    assert.equal(state.current_edct_utc, "2026-06-05T15:00:00.000Z");
    const publicFlights = await fetch(`${base}/api/flights`, { headers: { cookie } });
    const publicText = await publicFlights.text();
    assert.equal(publicText.includes("workspace_id"), false);
    assert.equal(publicText.includes("normalized_acid"), false);
    assert.equal(publicText.includes("source_record"), false);
    assert.equal(publicText.includes("etd_raw"), false);
    assert.equal(publicText.includes("departure_center"), false);
    assert.equal(publicText.includes("major_airline"), false);
    assert.equal(publicText.includes("source_airport"), false);
    global.fetch = async (url, init) => {
      if (String(url).startsWith(base)) return originalFetch(url, init);
      return new Response("nope", { status: 500 });
    };
    await fetch(`${base}/api/edct/refresh`, { method: "POST", headers: { cookie } });
    state = store.data.edct_flight_states.find((s) => s.normalized_acid === "SKW5338" && s.origin === "FAT" && s.destination === "SAN");
    assert.equal(state.current_edct_utc, "2026-06-05T15:00:00.000Z");
    global.fetch = async (url, init) => {
      if (String(url).startsWith(base)) return originalFetch(url, init);
      return new Response(JSON.stringify({ records: [] }), { status: 200, headers: { "content-type": "application/json" } });
    };
    await fetch(`${base}/api/edct/refresh`, { method: "POST", headers: { cookie } });
    state = store.data.edct_flight_states.find((s) => s.normalized_acid === "SKW5338" && s.origin === "FAT" && s.destination === "SAN");
    assert.equal(state.current_edct_utc, null);
    assert.ok(store.data.edct_events.some((e) => e.event_type === "EDCT_REMOVED"));
  } finally {
    global.fetch = originalFetch;
    await close();
  }
});

test("NAS shadow endpoint is read-only and avoids GDP ended while NAS program active", async () => {
  nasService.resetNasStatusCacheForTests();
  const base = await listen();
  const cookieRes = await fetch(`${base}/api/session`);
  const cookie = cookieRes.headers.get("set-cookie").split(";")[0];
  global.fetch = async (url, init) => {
    const textUrl = String(url);
    if (textUrl.startsWith(base)) return originalFetch(url, init);
    if (textUrl.includes("/ois/oisedit/summary_pub")) {
      return new Response("NATIONAL PROGRAMS\nSAN GDP\nGROUND STOPS\nDELAY INFO", { status: 200, headers: { "content-type": "text/html" } });
    }
    return new Response(JSON.stringify({ records: [{ acid: "SKW5338", origin: "FAT", destination: "SAN", etd: "E051500" }] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const created = await fetch(`${base}/api/flights`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ flight_number: "5338", origin: "FAT", destination: "SAN", etd: "2026-06-05T14:00:00.000Z", scheduled_departure_utc: "2026-06-05T14:00:00.000Z" })
    });
    assert.equal(created.status, 201, await created.text());

    global.fetch = async (url, init) => {
      const textUrl = String(url);
      if (textUrl.startsWith(base)) return originalFetch(url, init);
      if (textUrl.includes("/ois/oisedit/summary_pub")) {
        return new Response("NATIONAL PROGRAMS\nSAN GDP\nGROUND STOPS\nDELAY INFO", { status: 200, headers: { "content-type": "text/html" } });
      }
      return new Response(JSON.stringify({ records: [] }), { status: 200, headers: { "content-type": "application/json" } });
    };
    await fetch(`${base}/api/edct/refresh`, { method: "POST", headers: { cookie } });

    const beforeEvents = store.data.edct_events.length;
    const beforeNotifications = store.data.notification_events.length;
    const shadowResponse = await fetch(`${base}/api/edct/nas-shadow`, { headers: { cookie } });
    assert.equal(shadowResponse.status, 200);
    const shadow = await shadowResponse.json();
    const flight = shadow.flights.find((item) => item.flight === "5338" || item.flight === "SKW5338");
    assert.ok(flight);
    assert.equal(flight.nas.active_gdp, true);
    assert.notEqual(flight.beta_interpretation.label, "GDP ended");
    assert.equal(flight.beta_interpretation.label, "No longer listed");
    assert.equal(store.data.edct_events.length, beforeEvents);
    assert.equal(store.data.notification_events.length, beforeNotifications);
  } finally {
    global.fetch = originalFetch;
    await close();
  }
});

test("NAS shadow endpoint falls back cautiously when NAS fetch fails", async () => {
  nasService.resetNasStatusCacheForTests();
  const base = await listen();
  const cookieRes = await fetch(`${base}/api/session`);
  const cookie = cookieRes.headers.get("set-cookie").split(";")[0];
  global.fetch = async (url, init) => {
    const textUrl = String(url);
    if (textUrl.startsWith(base)) return originalFetch(url, init);
    if (textUrl.includes("/ois/oisedit/summary_pub")) return new Response("nope", { status: 500 });
    return new Response(JSON.stringify({ records: [] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const shadowResponse = await fetch(`${base}/api/edct/nas-shadow`, { headers: { cookie } });
    assert.equal(shadowResponse.status, 200);
    const shadow = await shadowResponse.json();
    assert.equal(shadow.nas.ok, false);
    assert.match(shadow.nas.error, /FAA NAS status fetch failed|unavailable|timed out/i);
  } finally {
    global.fetch = originalFetch;
    await close();
  }
});
