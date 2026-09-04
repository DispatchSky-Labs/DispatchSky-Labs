const API = "https://research-api-production-43e3.up.railway.app";
const labels = {
  currently_installed:"Installed now",previously_installed:"Used previously",never_downloaded:"Never used",
  exploring_no_plans:"Exploring; no school plans",planning_not_enrolled:"Planning; not enrolled",enrolled_not_started:"Enrolled; not started",in_school:"Currently in school",school_complete_not_certificated:"School complete; not certificated",certificated:"Certificated dispatcher",instructor:"Dispatch instructor",other_aviation_not_pursuing_school:"Other aviation; not pursuing school",other:"Other",
  subscribed:"Subscribed or paid",considered:"Considered; did not subscribe",saw_not_considered:"Saw offer; did not consider",never_saw:"Never saw offer",purchase_failed:"Purchase or restore failed",unsure:"Unsure",not_applicable:"Not applicable",
  price_value:"Price or value",not_in_school_yet:"Not in school yet",waiting_until_school_or_adx:"Waiting until school/ADX",not_enough_use:"Not enough use",content_fit:"Content did not fit",unclear_offer:"Offer unclear",trust_privacy:"Trust or privacy",technical_failure:"Technical/purchase failure",another_tool:"Uses another tool",direct:"Direct",referral:"Referral",reddit:"Reddit",
};
const login = document.querySelector("#login");
const dashboard = document.querySelector("#dashboard");
const loginForm = document.querySelector("#login-form");
const keyInput = document.querySelector("#admin-key");
const loginError = document.querySelector("#login-error");
let key = sessionStorage.getItem("research_admin_key") || "";

function displayLabel(value){return labels[value] || String(value).replaceAll("_"," ");}
function escapeHtml(value){return String(value).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");}
function bars(targetId, values={}){
  const target=document.querySelector(`#${targetId}`); const entries=Object.entries(values); target.innerHTML="";
  if(!entries.length){target.innerHTML='<p class="empty">No data yet.</p>';return;}
  const max=Math.max(...entries.map(([,value])=>value));
  for(const [name,value] of entries){const row=document.createElement("div");row.className="bar-row";row.innerHTML=`<span>${escapeHtml(displayLabel(name))}</span><span class="bar"><i style="width:${(value/max)*100}%"></i></span><strong>${Number(value)||0}</strong>`;target.append(row);}
}
function yesNo(value){return `<span class="${value?"yes":"no"}">${value?"Yes":"No"}</span>`;}
function render(data){
  const t=data.totals; document.querySelector("#updated").textContent=`Updated ${new Date(data.generatedAt).toLocaleString()}`;
  const cards=[[t.visitors,"Browser visitors"],[t.pageRequests,"Page requests"],[t.uniqueNetworkAddresses,"Network addresses"],[t.likelyBotRequests,"Likely bot requests"],[t.started,"Started form"],[t.submitted,"Submitted"],[`${t.startRatePercent}%`,"Start rate"],[`${t.submissionRatePercent}%`,"Submission rate"]];
  document.querySelector("#totals").innerHTML=cards.map(([value,label])=>`<div class="card"><strong>${value}</strong><span>${label}</span></div>`).join("");
  for(const id of ["source","dispatchSchoolStage","appStatus","subscriptionExperience","subscriptionReasons","visitsByDay","country","networkAddress"]) bars(id,data.breakdowns[id]);
  document.querySelector("#recent").innerHTML=data.recent.map((row)=>`<tr><td>${escapeHtml(new Date(row.savedAt).toLocaleString())}</td><td>${escapeHtml(row.ip||"—")}</td><td>${escapeHtml(row.country||"—")}</td><td>${escapeHtml(displayLabel(row.source))}</td><td>${yesNo(row.started)}</td><td>${yesNo(row.submitted)}</td><td>${yesNo(row.likelyBot)}</td><td>${escapeHtml(displayLabel(row.dispatchSchoolStage||"—"))}</td><td>${Number(row.revision)||0}</td><td title="${escapeHtml(row.userAgent||"")}">${escapeHtml(String(row.userAgent||"—").slice(0,80))}</td></tr>`).join("");
}
async function load(){
  const response=await fetch(`${API}/v1/research/admin/summary`,{headers:{"X-Admin-Token":key}});
  if(!response.ok) throw new Error(response.status===401?"That research key was not accepted.":"Analytics could not be loaded.");
  render(await response.json()); login.hidden=true; dashboard.hidden=false; sessionStorage.setItem("research_admin_key",key);
}
loginForm.addEventListener("submit",async(event)=>{event.preventDefault();loginError.textContent="";key=keyInput.value;try{await load();}catch(error){loginError.textContent=error.message;}});
document.querySelector("#refresh").addEventListener("click",()=>load().catch((error)=>alert(error.message)));
document.querySelectorAll("[data-download]").forEach((button)=>button.addEventListener("click",async()=>{
  const dataset=button.dataset.download; const response=await fetch(`${API}/v1/research/admin/export?dataset=${dataset}`,{headers:{"X-Admin-Token":key}}); if(!response.ok){alert("Download failed.");return;}
  const blob=await response.blob();const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`flight-dispatch-research-${dataset}-${new Date().toISOString().slice(0,10)}.ndjson`;a.click();URL.revokeObjectURL(url);
}));
if(key) load().catch(()=>sessionStorage.removeItem("research_admin_key"));
