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
process.env.EDCT_DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "edct-api-")), "db.json");

const mod = await import(`../src/server.js?test=${Date.now()}`);
const { server, store } = mod;
const service = await import(`../src/edctService.js?test=${Date.now()}`);
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
