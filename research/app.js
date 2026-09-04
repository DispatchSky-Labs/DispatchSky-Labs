const API_ORIGIN = "https://research-api-production-43e3.up.railway.app";
const DRAFT_KEY = "sadiom_fds_cohort_01_draft";
const ATTRIBUTION_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
const form = document.querySelector("#research-form");
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

function localSnapshot() {
  return { ...state, answers: answersFromForm(), savedAt: new Date().toISOString() };
}

function clientContext() {
  return {
    path: location.pathname,
    language: navigator.language,
    viewport: `${innerWidth}x${innerHeight}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    referrer: document.referrer.slice(0, 500),
  };
}

function persistLocal() {
  localStorage.setItem(DRAFT_KEY, JSON.stringify(localSnapshot()));
  saveStatus.textContent = "Draft saved on this device.";
}

async function saveRemote() {
  if (state.submitted) return;
  persistLocal();
  state.revision += 1;
  saveStatus.textContent = "Saving draft…";
  const response = await fetch(`${API_ORIGIN}/v1/research/flight-dispatch-study/application/draft`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      applicationId: state.applicationId,
      revision: state.revision,
      answers: answersFromForm(),
      attribution: state.attribution,
      client: clientContext(),
    }),
  });
  if (!response.ok) throw new Error("save_failed");
  const saved = await response.json();
  state.applicationId = saved.applicationId;
  localStorage.setItem(DRAFT_KEY, JSON.stringify(localSnapshot()));
  saveStatus.textContent = "Draft saved.";
}

let timer;
function scheduleSave() {
  if (state.submitted) return;
  persistLocal();
  clearTimeout(timer);
  timer = setTimeout(() => saveRemote().catch(() => { saveStatus.textContent = "Saved on this device. Online save will retry."; }), 1100);
}

if (existing?.answers && !existing.submitted) {
  fillForm(existing.answers);
  saveStatus.textContent = "Draft restored.";
}

// Record an attributed application visit even when the visitor leaves before typing.
if (!state.submitted) {
  saveRemote().catch(() => { saveStatus.textContent = "Draft ready. Online save will retry when you begin."; });
}

form.addEventListener("input", scheduleSave);
form.addEventListener("change", scheduleSave);
window.addEventListener("pagehide", persistLocal);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  message.className = "message";
  message.textContent = "";
  if (!form.checkValidity()) {
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
      }),
    });
    if (!response.ok) throw new Error("submit_failed");
    state.submitted = true;
    localStorage.setItem(DRAFT_KEY, JSON.stringify(localSnapshot()));
    message.className = "message success";
    message.textContent = "Application received. If your perspective fits this cohort, Sadiom may contact you with an invitation.";
    saveStatus.textContent = "Application submitted.";
    form.querySelectorAll("input, textarea, button").forEach((element) => { element.disabled = true; });
  } catch {
    message.className = "message error";
    message.textContent = "Your draft is safe, but the application could not be submitted. Please try again shortly.";
    button.disabled = false;
    button.textContent = "Submit application";
  }
});
