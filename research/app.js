const API_ORIGIN = "https://research-api-production-43e3.up.railway.app";
const DRAFT_KEY = "sadiom_fds_cohort_01_draft";
const ATTRIBUTION_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
const form = document.querySelector("#research-form");
const application = document.querySelector("#application");
const consentGate = document.querySelector("#consent");
const agreeButton = document.querySelector("#agree-analytics");
const consentStatus = document.querySelector("#consent-status");
const saveStatus = document.querySelector("#save-status");
const message = document.querySelector("#form-message");

function newId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}

function readLocal() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); } catch { return null; }
}

const existing = readLocal();
const state = {
  applicationId: existing?.applicationId || newId(),
  revision: existing?.revision || 0,
  attribution: existing?.attribution || Object.fromEntries(ATTRIBUTION_KEYS.map((key) => [key, new URLSearchParams(location.search).get(key)]).filter(([, value]) => value)),
  submitted: existing?.submitted || false,
  analyticsConsent: existing?.analyticsConsent || false,
  analyticsConsentAt: existing?.analyticsConsentAt || null,
};
const richClient = existing?.client || {};
const engagement = {
  openedAt: existing?.engagement?.openedAt || new Date().toISOString(),
  lastActivityAt: new Date().toISOString(),
  inputEvents: existing?.engagement?.inputEvents || 0,
  changeEvents: existing?.engagement?.changeEvents || 0,
  validationFailures: existing?.engagement?.validationFailures || 0,
  visibilityChanges: existing?.engagement?.visibilityChanges || 0,
  maxScrollPercent: existing?.engagement?.maxScrollPercent || 0,
  fieldsTouched: existing?.engagement?.fieldsTouched || [],
};

function answersFromForm() {
  const answers = {};
  for (const element of form.elements) {
    if (!element.name) continue;
    if (element.type === "checkbox") {
      if (element.name === "contactConsent" || element.name === "retentionConsent" || element.name === "redditReviewConsent") {
        answers[element.name] = element.checked;
      } else {
        answers[element.name] ||= [];
        if (element.checked) answers[element.name].push(element.value);
      }
    } else if (element.type === "radio") {
      if (element.checked) answers[element.name] = element.value;
    } else {
      answers[element.name] = element.value;
    }
  }
  return answers;
}

function fillForm(answers = {}) {
  for (const element of form.elements) {
    if (!element.name || answers[element.name] === undefined) continue;
    if (element.type === "checkbox") {
      element.checked = Array.isArray(answers[element.name]) ? answers[element.name].includes(element.value) : Boolean(answers[element.name]);
    } else if (element.type === "radio") {
      element.checked = answers[element.name] === element.value;
    } else {
      element.value = answers[element.name] || "";
    }
  }
}

function engagementSnapshot() {
  return {
    ...engagement,
    lastActivityAt: new Date().toISOString(),
    elapsedSeconds: Math.max(0, Math.round((Date.now() - new Date(engagement.openedAt).getTime()) / 1000)),
  };
}

function localSnapshot() {
  return { ...state, answers: answersFromForm(), client: clientContext(), engagement: engagementSnapshot(), savedAt: new Date().toISOString() };
}

function clientContext() {
  return {
    ...richClient,
    path: location.pathname,
    language: navigator.language,
    viewport: `${innerWidth}x${innerHeight}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    referrer: document.referrer.slice(0, 500),
    userAgent: navigator.userAgent.slice(0, 1000),
    platform: navigator.userAgentData?.platform || navigator.platform || "",
    screen: `${screen.width}x${screen.height}`,
    colorDepth: screen.colorDepth,
    touchPoints: navigator.maxTouchPoints || 0,
    cookiesEnabled: navigator.cookieEnabled,
    doNotTrack: navigator.doNotTrack,
    webdriver: Boolean(navigator.webdriver),
    languages: navigator.languages || [navigator.language],
    hardwareConcurrency: navigator.hardwareConcurrency || null,
    deviceMemoryGb: navigator.deviceMemory || null,
    analyticsConsent: state.analyticsConsent,
    analyticsConsentAt: state.analyticsConsentAt,
  };
}

async function collectRichClientContext() {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (connection) richClient.connection = {
    effectiveType: connection.effectiveType || null,
    downlinkMbps: connection.downlink || null,
    roundTripMs: connection.rtt || null,
    saveData: Boolean(connection.saveData),
  };
  if (navigator.storage?.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      richClient.storage = { quotaBytes: estimate.quota || null, usageBytes: estimate.usage || null };
    } catch {}
  }
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    const extension = gl?.getExtension("WEBGL_debug_renderer_info");
    richClient.graphics = {
      vendor: extension ? gl.getParameter(extension.UNMASKED_VENDOR_WEBGL) : gl?.getParameter(gl.VENDOR) || null,
      renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER) || null,
    };
  } catch {}
}

function collectLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { richClient.location = { permission: "unavailable" }; return resolve(false); }
    richClient.location = { permission: "requested" };
    navigator.geolocation.getCurrentPosition((position) => {
      const { latitude, longitude, accuracy, altitude, altitudeAccuracy, heading, speed } = position.coords;
      richClient.location = { permission: "granted", latitude, longitude, accuracyMeters: accuracy, altitude, altitudeAccuracy, heading, speed, capturedAt: new Date(position.timestamp).toISOString() };
      resolve(true);
    }, (error) => {
      richClient.location = { permission: error.code === 1 ? "denied" : "unavailable", errorCode: error.code };
      resolve(false);
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
  });
}

function persistLocal() {
  localStorage.setItem(DRAFT_KEY, JSON.stringify(localSnapshot()));
  saveStatus.textContent = "Draft saved on this device.";
}

function remotePayload() {
  return {
    applicationId: state.applicationId,
    revision: state.revision,
    answers: answersFromForm(),
    attribution: state.attribution,
    client: clientContext(),
    engagement: engagementSnapshot(),
    consent: { analytics: state.analyticsConsent, agreedAt: state.analyticsConsentAt },
  };
}

async function saveRemote(options = {}) {
  if (state.submitted || !state.analyticsConsent) return;
  persistLocal();
  state.revision += 1;
  saveStatus.textContent = "Saving draft…";
  const response = await fetch(`${API_ORIGIN}/v1/research/flight-dispatch-study/application/draft`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(remotePayload()),
    keepalive: Boolean(options.keepalive),
  });
  if (!response.ok) throw new Error("save_failed");
  const saved = await response.json();
  state.applicationId = saved.applicationId;
  localStorage.setItem(DRAFT_KEY, JSON.stringify(localSnapshot()));
  saveStatus.textContent = "Draft saved.";
}

let timer;
function scheduleSave() {
  if (state.submitted || !state.analyticsConsent) return;
  persistLocal();
  clearTimeout(timer);
  timer = setTimeout(() => saveRemote().catch(() => { saveStatus.textContent = "Saved on this device. Online save will retry."; }), 1100);
}

if (existing?.answers && !existing.submitted) {
  fillForm(existing.answers);
  saveStatus.textContent = "Draft restored.";
}

function revealApplication() {
  consentGate.hidden = true;
  application.hidden = false;
}

if (state.analyticsConsent && richClient.location?.permission === "granted") {
  revealApplication();
  collectRichClientContext().finally(() => saveRemote().catch(() => { saveStatus.textContent = "Draft ready. Online save will retry when you begin."; }));
} else {
  state.analyticsConsent = false;
  state.analyticsConsentAt = null;
}

agreeButton.addEventListener("click", async () => {
  agreeButton.disabled = true;
  agreeButton.textContent = "Requesting location…";
  consentStatus.textContent = "Please allow location access in your browser to continue.";
  const locationPromise = collectLocation();
  const [, locationResult] = await Promise.allSettled([collectRichClientContext(), locationPromise]);
  if (locationResult.status !== "fulfilled" || locationResult.value !== true) {
    state.analyticsConsent = false;
    state.analyticsConsentAt = null;
    agreeButton.disabled = false;
    agreeButton.textContent = "Agree and try location again";
    consentStatus.textContent = "Location access is required to view the questionnaire. Check your browser permission and try again.";
    return;
  }
  state.analyticsConsent = true;
  state.analyticsConsentAt = new Date().toISOString();
  consentStatus.textContent = "";
  revealApplication();
  application.scrollIntoView({ behavior: "smooth", block: "start" });
  await saveRemote().catch(() => { saveStatus.textContent = "Draft ready. Online save will retry when you begin."; });
});

function recordFieldEvent(event, type) {
  engagement.lastActivityAt = new Date().toISOString();
  engagement[type] += 1;
  if (event.target?.name && !engagement.fieldsTouched.includes(event.target.name)) engagement.fieldsTouched.push(event.target.name);
  scheduleSave();
}

form.addEventListener("input", (event) => recordFieldEvent(event, "inputEvents"));
form.addEventListener("change", (event) => recordFieldEvent(event, "changeEvents"));
let lastScrollBand = 0;
window.addEventListener("scroll", () => {
  const available = Math.max(1, document.documentElement.scrollHeight - innerHeight);
  const percent = Math.min(100, Math.round((scrollY / available) * 100));
  engagement.maxScrollPercent = Math.max(engagement.maxScrollPercent, percent);
  const band = Math.floor(engagement.maxScrollPercent / 10);
  if (band > lastScrollBand) { lastScrollBand = band; scheduleSave(); }
}, { passive: true });
document.addEventListener("visibilitychange", () => {
  engagement.visibilityChanges += 1;
  engagement.lastActivityAt = new Date().toISOString();
  if (document.visibilityState === "hidden") saveRemote({ keepalive: true }).catch(() => {});
});
window.addEventListener("pagehide", () => { persistLocal(); saveRemote({ keepalive: true }).catch(() => {}); });

const pageView = new Image(1, 1);
const pageViewParams = new URLSearchParams(location.search);
pageViewParams.set("path", location.pathname);
pageView.src = `${API_ORIGIN}/v1/research/flight-dispatch-study/page-view.gif?${pageViewParams}`;

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  message.className = "message";
  message.textContent = "";
  if (!form.checkValidity()) {
    engagement.validationFailures += 1;
    form.reportValidity();
    message.className = "message error";
    message.textContent = "Please complete the required questions before submitting.";
    return;
  }
  const feedbackMethods = form.querySelectorAll('input[name="feedbackMethods"]:checked');
  const studyTools = form.querySelectorAll('input[name="studyTools"]:checked');
  if (!feedbackMethods.length || !studyTools.length) {
    message.className = "message error";
    message.textContent = "Please select at least one study tool and one feedback method.";
    return;
  }
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = "Submitting…";
  try {
    await saveRemote();
    const response = await fetch(`${API_ORIGIN}/v1/research/flight-dispatch-study/application/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        applicationId: state.applicationId,
        answers: answersFromForm(),
        attribution: state.attribution,
        client: clientContext(),
        engagement: engagementSnapshot(),
        consent: { analytics: state.analyticsConsent, agreedAt: state.analyticsConsentAt },
      }),
    });
    if (!response.ok) throw new Error("submit_failed");
    state.submitted = true;
    localStorage.setItem(DRAFT_KEY, JSON.stringify(localSnapshot()));
    message.className = "message success";
    message.textContent = "Responses received. If your perspective fits a research opportunity, Sadiom may contact you with an invitation.";
    saveStatus.textContent = "Application submitted.";
    button.textContent = "Submitted";
    button.hidden = true;
    const finePrint = form.querySelector(".fine-print");
    if (finePrint) finePrint.textContent = "Submission received. No purchase is required.";
    form.querySelectorAll("input, textarea, button").forEach((element) => { element.disabled = true; });
  } catch {
    message.className = "message error";
    message.textContent = "Your draft is safe, but the application could not be submitted. Please try again shortly.";
    button.disabled = false;
    button.textContent = "Submit responses";
  }
});
