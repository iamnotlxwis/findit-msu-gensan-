const SUPABASE_URL = "https://bmtearyxlnrzgcuvcepw.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_Lck0L35G-vtAqFRQfMUH2A_fhQ2neY4";

let supabase = null;
let currentUser = null;
let currentProfile = null;
let currentRole = null;
let selectedItem = null;
let filter = "All";
let categoryFilter = "All";
let sortOrder = "newest";
let allItems = [];
let recentlyViewed = JSON.parse(localStorage.getItem("finditRecentlyViewed") || "[]");
let activeDetailItem = null;
let activeReportItem = null;

const $ = (selector) => document.querySelector(selector);
const grid = $("#items");
const search = $("#search");
const auth = $("#auth");
const submission = $("#submission");
const claimDialog = $("#claimDialog");
const toast = $("#toast");

function notify(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
}
function clearNotice() {
  if (!toast) return;
  toast.classList.remove("show");
  toast.textContent = "";
}
function errorAt(selector, message = "") {
  const element = $(selector);
  if (element) element.textContent = message;
}
function esc(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}
function header() {
  if ($("#login")) $("#login").hidden = !!currentUser;
  if ($("#logout")) $("#logout").hidden = !currentUser;
  if ($("#account")) $("#account").hidden = !currentUser;
  if ($("#notificationsButton")) $("#notificationsButton").hidden = !currentUser;
  if ($("#adminDashboard")) $("#adminDashboard").hidden = currentRole !== "admin";
  if ($("#userLabel")) $("#userLabel").textContent =
    currentProfile?.display_name || currentUser?.email || "";
}
function openLogin() {
  if (!auth) return;
  if (!auth.open) auth.showModal();
}
async function needLogin() {
  if (currentUser) return true;
  openLogin();
  errorAt("#authError", "Sign in with your Google account to continue.");
  return false;
}

function render() {
  if (!grid || !search) return;
  const query = search.value.trim().toLowerCase();
  const rows = allItems.filter((item) =>
    (filter === "All" || item.item_type === filter) &&
    (categoryFilter === "All" || item.category === categoryFilter) &&
    (!$("#dateFilter")?.value || item.event_date === $("#dateFilter").value) &&
    (!$("#buildingFilter")?.value.trim() || (item.building || item.campus_location).toLowerCase().includes($("#buildingFilter").value.trim().toLowerCase())) &&
    [item.title, item.description, item.category, item.campus_location, item.building]
      .join(" ").toLowerCase().includes(query)
  ).sort((a, b) => sortOrder === "newest"
    ? new Date(b.created_at) - new Date(a.created_at)
    : new Date(a.created_at) - new Date(b.created_at));
  if ($("#count")) $("#count").textContent = rows.length + " ITEMS";
  if ($("#empty")) $("#empty").hidden = rows.length > 0;

  grid.innerHTML = rows.map((item) => {
    const firstPhoto = item.media?.[0]?.storage_path || item.image_path;
    const photo = firstPhoto && supabase
      ? '<img src="' + esc(supabase.storage.from("item-images").getPublicUrl(firstPhoto).data.publicUrl) + '" alt="Item photo" loading="lazy">'
      : '<span class="item-symbol">⌕</span>';
    const claim = currentUser && currentUser.id !== item.owner_id && item.status === "active"
      ? '<button class="claim-button" data-claim="' + esc(item.id) + '">Submit a claim</button>'
      : "";
    return '<article class="card"><button class="card-open" data-view="' + esc(item.id) + '" aria-label="View ' + esc(item.title) + '"><div class="visual"><span class="tag ' + esc(item.item_type) + '">' +
      esc(item.item_type.toUpperCase()) + '</span>' + photo +
      '</div><div class="body"><h3>' + esc(item.title) + '</h3><p>' +
      esc(item.description) + '</p><div class="meta">' + esc(item.category) + ' · ' +
      esc(item.campus_location) + ' · ' +
      esc(item.event_date || new Date(item.created_at).toLocaleDateString()) +
      '</div></div></button><div class="card-actions">' + claim + '</div></article>';
  }).join("");

  grid.querySelectorAll("[data-claim]").forEach((button) => {
    button.addEventListener("click", () => openClaim(button.dataset.claim));
  });
  grid.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => openItemDetails(button.dataset.view));
  });
}


const accountDialog = $("#accountDialog");
let accountData = { posts: [], claims: [], received: [], reports: [] };
let accountTab = "posts";
let conversations = [];
let activeConversation = null;
let messageChannel = null;
let notificationChannel = null;

function statusLabel(status) {
  return String(status || "unknown").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function accountRow(title, detail, status, date) {
  return '<article class="activity-row"><div><strong>' + esc(title) + '</strong><small>' + esc(detail || "") + '</small></div><div class="activity-side"><span class="activity-status">' + esc(statusLabel(status)) + '</span><small>' + esc(date ? new Date(date).toLocaleDateString() : "") + '</small></div></article>';
}
function renderAccountTab() {
  const target = $("#accountContent");
  if (!target) return;
  if (accountTab === "messages") { renderConversations(); loadConversations(); return; }
  if (accountTab === "history") { renderRecentlyViewed(); return; }
  if (accountTab === "reports") { const rows = accountData.reports || []; target.innerHTML = rows.length ? rows.map(row => accountRow(row.items?.title || "Campus item", row.reason, row.status, row.created_at)).join("") : '<div class="account-empty"><p>You have not submitted any reports.</p></div>'; return; }
  if (accountTab === "reputation") { renderReputation(); return; }
  const rows = accountData[accountTab] || [];
  if (!rows.length) {
    const messages = { posts: "No posts yet.", claims: "No submitted claims yet.", received: "No one has claimed your listings yet." };
    target.innerHTML = '<div class="account-empty"><span>♡</span><p>' + messages[accountTab] + '</p></div>';
    return;
  }
  if (accountTab === "posts") {
    target.innerHTML = rows.map((item) =>
      '<article class="received-row"><div class="received-main"><strong>' + esc(item.title) +
      '</strong><small>' + esc(item.item_type.toUpperCase() + " · " + item.campus_location) +
      '</small><span class="activity-status">' + esc(statusLabel(item.status)) +
      '</span></div><div class="post-row-actions">' +
      (item.status !== "returned" && item.status !== "archived" ? '<button type="button" class="claim-review accept" data-return-post="' + esc(item.id) + '">Mark returned</button>' : '') +
      '<button type="button" class="claim-review reject" data-delete-post="' + esc(item.id) + '">Remove post</button></div></article>'
    ).join("");
    target.querySelectorAll("[data-return-post]").forEach((button) => button.addEventListener("click", () => markPostReturned(button.dataset.returnPost, button)));
    target.querySelectorAll("[data-delete-post]").forEach((button) => {
      button.addEventListener("click", () => deleteOwnPost(button.dataset.deletePost, button));
    });
  } else if (accountTab === "claims") {
    target.innerHTML = rows.map((claim) => accountRow(claim.items?.title || "Campus item", claim.items?.item_type?.toUpperCase() + " · " + claim.message, claim.status, claim.created_at) + (claim.status === "accepted" ? '<button class="claim-review accept" data-handover="' + esc(claim.id) + '" data-side="claimant">Confirm received item</button>' : "")).join("");
    target.querySelectorAll("[data-handover]").forEach(button => button.addEventListener("click", () => confirmHandover(button.dataset.handover,button.dataset.side,button)));
  } else {
    target.innerHTML = rows.map((claim) => {
      const item = claim.items || {};
      const actions = claim.status === "pending"
        ? '<div class="claim-review-actions"><button type="button" class="claim-review accept" data-claim-action="accepted" data-claim-id="' + esc(claim.id) + '">Accept</button><button type="button" class="claim-review reject" data-claim-action="rejected" data-claim-id="' + esc(claim.id) + '">Reject</button></div>'
        : claim.status === "accepted" ? '<button type="button" class="claim-review accept" data-handover="' + esc(claim.id) + '" data-side="owner">Confirm handed over</button>' : "";
      return '<article class="received-row"><div class="received-main"><strong>' + esc(item.title || "Campus item") + '</strong><small>' + esc(item.item_type || "") + " · " + esc(claim.message) + '</small><span class="activity-status">' + esc(statusLabel(claim.status)) + '</span></div>' + actions + '</article>';
    }).join("");
    target.querySelectorAll("[data-handover]").forEach(button => button.addEventListener("click", () => confirmHandover(button.dataset.handover,button.dataset.side,button)));
    target.querySelectorAll("[data-claim-action]").forEach((button) => {
      button.addEventListener("click", () => reviewClaim(button.dataset.claimId, button.dataset.claimAction, button));
    });
  }
}

function renderConversations() {
  const target = $("#accountContent");
  if (!target) return;
  if (!conversations.length) {
    target.innerHTML = '<div class="account-empty"><span>♡</span><p>No conversations yet. Accepted claims will appear here.</p></div>';
    return;
  }
  target.innerHTML = conversations.map((conversation) =>
    '<button type="button" class="conversation-row" data-conversation="' + esc(conversation.id) + '">' +
    '<span class="conversation-avatar">♡</span><span class="conversation-info"><strong>' +
    esc(conversation.partnerName) + '</strong><small>' + esc(conversation.items?.title || "Campus item") +
    '</small></span><span class="conversation-arrow">›</span></button>'
  ).join("");
  target.querySelectorAll("[data-conversation]").forEach((button) =>
    button.addEventListener("click", () => openConversation(button.dataset.conversation))
  );
}
async function loadConversations() {
  if (!currentUser || !supabase) return;
  const { data, error } = await supabase.from("conversations")
    .select("id,item_id,participant_one,participant_two,created_at,items!conversations_item_id_fkey(title)")
    .order("created_at", { ascending: false });
  if (error) {
    $("#accountContent").innerHTML = '<p class="form-error">Could not load conversations: ' + esc(error.message) + '</p>';
    return;
  }
  const rows = data || [];
  const otherIds = [...new Set(rows.map((row) =>
    row.participant_one === currentUser.id ? row.participant_two : row.participant_one
  ))];
  let profiles = [];
  if (otherIds.length) {
    const result = await supabase.from("profiles").select("id,display_name").in("id", otherIds);
    if (result.error) {
      $("#accountContent").innerHTML = '<p class="form-error">Could not load conversation names.</p>';
      return;
    }
    profiles = result.data || [];
  }
  conversations = rows.map((row) => {
    const otherId = row.participant_one === currentUser.id ? row.participant_two : row.participant_one;
    return { ...row, partnerName: profiles.find((profile) => profile.id === otherId)?.display_name || "MSU student" };
  });
  if (accountTab === "messages") renderConversations();
}
async function openConversation(conversationId) {
  activeConversation = conversations.find((row) => row.id === conversationId);
  if (!activeConversation) return;
  $("#messageTitle").textContent = activeConversation.partnerName;
  $("#messageSubtitle").textContent = activeConversation.items?.title || "Private conversation";
  errorAt("#messageError");
  $("#messageInput").value = "";
  $("#messageDialog").showModal();
  await loadMessages();
  if (messageChannel) await supabase.removeChannel(messageChannel);
  messageChannel = supabase.channel("findit-messages-" + conversationId)
    .on("postgres_changes", {
      event: "INSERT", schema: "public", table: "messages",
      filter: "conversation_id=eq." + conversationId
    }, (payload) => {
      if (payload.new.sender_id !== currentUser.id) loadMessages();
    }).subscribe();
}
async function loadMessages() {
  if (!activeConversation) return;
  const target = $("#messageList");
  const { data, error } = await supabase.from("messages")
    .select("id,conversation_id,sender_id,body,created_at,profiles!messages_sender_id_fkey(display_name)")
    .eq("conversation_id", activeConversation.id)
    .order("created_at", { ascending: true });
  if (error) {
    target.innerHTML = '<p class="form-error">Could not load messages: ' + esc(error.message) + '</p>';
    return;
  }
  const rows = data || [];
  target.innerHTML = rows.length ? rows.map((message) => {
    const own = message.sender_id === currentUser.id;
    return '<article class="message-bubble ' + (own ? "mine" : "theirs") + '"><small>' +
      esc(own ? "You" : message.profiles?.display_name || "Student") + '</small><p>' +
      esc(message.body || "") + '</p><time>' + esc(new Date(message.created_at).toLocaleString()) +
      '</time></article>';
  }).join("") : '<p class="account-empty">No messages yet. Say hello to arrange a safe handover.</p>';
  target.scrollTop = target.scrollHeight;
}
async function sendMessage(event) {
  event.preventDefault();
  errorAt("#messageError");
  const body = $("#messageInput").value.trim();
  if (!body || !activeConversation || !currentUser) return;
  const button = $("#sendMessage");
  button.disabled = true;
  const { error } = await supabase.from("messages").insert({
    conversation_id: activeConversation.id, sender_id: currentUser.id, body
  });
  button.disabled = false;
  if (error) { errorAt("#messageError", error.message); return; }
  $("#messageInput").value = "";
  await loadMessages();
}
async function closeMessageDialog() {
  $("#messageDialog").close();
  if (messageChannel && supabase) {
    await supabase.removeChannel(messageChannel);
    messageChannel = null;
  }
  activeConversation = null;
}

async function reviewClaim(claimId, nextStatus, button) {
  if (!["accepted", "rejected"].includes(nextStatus) || !currentUser) return;
  const claim = accountData.received.find((row) => row.id === claimId);
  if (!claim || claim.status !== "pending") return;
  const confirmed = window.confirm(nextStatus === "accepted" ? "Accept this claim and prepare a private handover conversation?" : "Reject this claim?");
  if (!confirmed) return;
  button.disabled = true;
  const { error } = await supabase.from("claims").update({ status: nextStatus }).eq("id", claimId).eq("status", "pending");
  if (error) { button.disabled = false; notify("Unable to update claim: " + error.message); return; }
  if (nextStatus === "accepted") {
    const participants = [currentUser.id, claim.claimant_id].sort();
    const { error: conversationError } = await supabase.from("conversations").upsert({ item_id: claim.item_id, participant_one: participants[0], participant_two: participants[1] }, { onConflict: "item_id,participant_one,participant_two", ignoreDuplicates: true });
    if (conversationError) { console.error("FindIt conversation setup:", conversationError); notify("Claim accepted, but the private chat could not be prepared yet."); }
    else notify("Claim accepted. A private handover conversation is ready.");
  } else notify("Claim rejected.");
  await loadAccountData();
}
async function deleteOwnPost(itemId, button) {
  if (!currentUser || !itemId) return;
  const item = accountData.posts.find((row) => row.id === itemId);
  if (!item) return;
  const confirmed = window.confirm('Remove "' + item.title + '"? This permanently deletes the post and its related claims, reports and saved entries.');
  if (!confirmed) return;

  button.disabled = true;
  button.textContent = "Removing...";
  const { error } = await supabase.from("items")
    .delete()
    .eq("id", itemId)
    .eq("owner_id", currentUser.id);

  if (error) {
    button.disabled = false;
    button.textContent = "Remove post";
    notify("Could not remove post: " + error.message);
    return;
  }

  allItems = allItems.filter((row) => row.id !== itemId);
  accountData.posts = accountData.posts.filter((row) => row.id !== itemId);
  if (item.image_path) {
    const { error: storageError } = await supabase.storage
      .from("item-images").remove([item.image_path]);
    if (storageError) console.warn("FindIt image cleanup:", storageError.message);
  }
  render();
  renderAccountTab();
  notify("Your post has been removed.");
}

async function openAdminDashboard() {
  if (!currentUser || currentRole !== "admin") return notify("Admin access required.");
  $("#adminDialog").showModal();
  await loadAdminDashboard();
}

async function loadAdminDashboard() {
  const target = $("#adminContent");
  target.innerHTML = '<p class="loading-state">Loading moderation queue...</p>';
  const [items, reports] = await Promise.all([
    supabase.from("items")
      .select("id,title,item_type,status,moderation_status,created_at,owner_id,profiles!items_owner_id_fkey(display_name)")
      .order("created_at", { ascending: false }).limit(100),
    supabase.from("reports")
      .select("id,item_id,reporter_id,reason,status,created_at,items!reports_item_id_fkey(title),profiles!reports_reporter_id_fkey(display_name)")
      .order("created_at", { ascending: false }).limit(100)
  ]);
  if (items.error || reports.error) {
    target.innerHTML = '<p class="form-error">Could not load admin data: ' +
      esc(items.error?.message || reports.error?.message) + '</p>';
    return;
  }
  const itemRows = items.data || [];
  const reportRows = reports.data || [];
  const pending = itemRows.filter(row => row.moderation_status === "pending");
  target.innerHTML =
    '<div class="admin-stats"><div><strong>' + itemRows.length + '</strong><small>Listings</small></div><div><strong>' + pending.length + '</strong><small>Pending review</small></div><div><strong>' + reportRows.filter(row => row.status === "open").length + '</strong><small>Open reports</small></div></div>' +
    '<h3>Listing moderation</h3>' +
    (itemRows.length ? itemRows.map(row =>
      '<article class="admin-row"><div class="admin-row-main"><strong>' + esc(row.title) + '</strong><small>' +
      esc(row.item_type.toUpperCase() + " · " + (row.profiles?.display_name || "Student")) +
      '</small><span class="activity-status">' + esc(statusLabel(row.moderation_status)) + ' · ' + esc(statusLabel(row.status)) +
      '</span></div><div class="admin-actions">' +
      (row.moderation_status !== "published" ? '<button class="claim-review accept" data-admin-item="' + esc(row.id) + '" data-next-moderation="published">Publish</button>' : '') +
      (row.moderation_status !== "rejected" ? '<button class="claim-review reject" data-admin-item="' + esc(row.id) + '" data-next-moderation="rejected">Reject</button>' : '') +
      '</div></article>'
    ).join("") : '<p class="account-empty">No listings found.</p>') +
    '<h3>Community reports</h3>' +
    (reportRows.length ? reportRows.map(row =>
      '<article class="admin-row"><div class="admin-row-main"><strong>' + esc(row.items?.title || "Removed listing") + '</strong><small>' +
      esc(row.profiles?.display_name || "Student") + ' · ' + esc(new Date(row.created_at).toLocaleDateString()) +
      '</small><p>' + esc(row.reason) + '</p><span class="activity-status">' + esc(statusLabel(row.status)) +
      '</span></div><div class="admin-actions">' +
      (row.status === "open" ? '<button class="claim-review accept" data-admin-report="' + esc(row.id) + '" data-next-report="reviewed">Mark reviewed</button><button class="claim-review reject" data-admin-report="' + esc(row.id) + '" data-next-report="dismissed">Dismiss</button>' : '') +
      '</div></article>'
    ).join("") : '<p class="account-empty">No reports submitted.</p>');

  target.querySelectorAll("[data-admin-item]").forEach(button => button.addEventListener("click", async () => {
    button.disabled = true;
    const { error } = await supabase.from("items")
      .update({ moderation_status: button.dataset.nextModeration })
      .eq("id", button.dataset.adminItem);
    if (error) { button.disabled = false; return notify("Moderation failed: " + error.message); }
    await logAdminAction("Changed listing moderation","item",button.dataset.adminItem,{status:button.dataset.nextModeration});
    notify("Listing moderation updated.");
    await loadAdminDashboard();
    await loadItems();
  }));
  target.querySelectorAll("[data-admin-report]").forEach(button => button.addEventListener("click", async () => {
    button.disabled = true;
    const { error } = await supabase.from("reports")
      .update({ status: button.dataset.nextReport })
      .eq("id", button.dataset.adminReport);
    if (error) { button.disabled = false; return notify("Report update failed: " + error.message); }
    await logAdminAction("Updated report","report",button.dataset.adminReport,{status:button.dataset.nextReport});
    notify("Report status updated.");
    await loadAdminDashboard();
  }));
  await loadAdminExtras(target);
}


function rememberViewed(itemId) {
  recentlyViewed = [itemId, ...recentlyViewed.filter(id => id !== itemId)].slice(0,20);
  localStorage.setItem("finditRecentlyViewed", JSON.stringify(recentlyViewed));
}
function renderRecentlyViewed() {
  const target = $("#accountContent");
  const rows = recentlyViewed.map(id => allItems.find(item => item.id === id)).filter(Boolean);
  target.innerHTML = rows.length ? rows.map(item => accountRow(item.title, (item.item_type || "").toUpperCase() + " · " + (item.building || item.campus_location), item.status, item.created_at)).join("") : '<div class="account-empty"><p>No recently viewed listings yet.</p></div>';
}
async function renderReputation() {
  const target = $("#accountContent");
  const { data, error } = await supabase.from("profiles").select("reputation_points,successful_returns").eq("id", currentUser.id).single();
  if (error) { target.innerHTML = '<p class="form-error">Could not load reputation.</p>'; return; }
  target.innerHTML = '<section class="reputation-card"><div class="reputation-score">' + Number(data.reputation_points || 0) + '</div><h3>Community points</h3><p>' + Number(data.successful_returns || 0) + ' successful returns</p><small>Earn 10 points when both sides confirm a handover.</small></section>';
}
async function confirmHandover(claimId, side, button) {
  if (!currentUser || !["owner","claimant"].includes(side)) return;
  button.disabled = true;
  const claim = [...accountData.received, ...accountData.claims].find(row => row.id === claimId);
  if (!claim) { button.disabled = false; return; }
  const itemId = claim.item_id;
  const ownerId = side === "owner" ? currentUser.id : claim.items?.owner_id;
  const claimantId = side === "claimant" ? currentUser.id : claim.claimant_id;
  let { data, error } = await supabase.from("handover_confirmations").select("*").eq("claim_id", claimId).maybeSingle();
  if (!data && !error) {
    const created = await supabase.from("handover_confirmations").insert({ item_id:itemId, claim_id:claimId, owner_id:ownerId, claimant_id:claimantId }).select("*").single();
    data = created.data; error = created.error;
  }
  if (error || !data) { button.disabled=false; return notify("Could not prepare handover: " + (error?.message || "Unknown error")); }
  const column = side === "owner" ? "owner_confirmed_at" : "claimant_confirmed_at";
  const update = await supabase.from("handover_confirmations").update({ [column]: new Date().toISOString() }).eq("id", data.id);
  if (update.error) { button.disabled=false; return notify("Confirmation failed: " + update.error.message); }
  notify("Your handover confirmation was recorded. The item closes after both sides confirm.");
  await loadAccountData(); await loadItems();
}
async function logAdminAction(action, targetType, targetId, details={}) {
  if (!currentUser) return;
  const { error } = await supabase.from("admin_activity_logs").insert({admin_id:currentUser.id,action,target_type:targetType,target_id:targetId,details});
  if (error) console.warn("Admin activity log:", error.message);
}
function downloadCsv(filename, rows) {
  const keys = [...new Set(rows.flatMap(row => Object.keys(row)))];
  const quote = value => '"' + String(value ?? "").replace(/"/g,'""') + '"';
  const csv = [keys.map(quote).join(","), ...rows.map(row => keys.map(key => quote(typeof row[key] === "object" ? JSON.stringify(row[key]) : row[key])).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([csv], {type:"text/csv;charset=utf-8;"}));
  const link = document.createElement("a"); link.href=url; link.download=filename; link.click(); URL.revokeObjectURL(url);
}
async function loadAdminExtras(target) {
  const [profiles, logs, settings] = await Promise.all([
    supabase.from("profiles").select("id,display_name,is_suspended,reputation_points,successful_returns,created_at").order("created_at",{ascending:false}).limit(100),
    supabase.from("admin_activity_logs").select("id,admin_id,action,target_type,target_id,details,created_at").order("created_at",{ascending:false}).limit(100),
    supabase.from("findit_settings").select("listing_expiry_days").eq("id",true).single()
  ]);
  const profileRows = profiles.data || [], logRows = logs.data || [];
  target.insertAdjacentHTML("beforeend",
    '<h3>Platform settings</h3><div class="admin-setting"><label for="expiryDays">Listing expiry (days)</label><input id="expiryDays" type="number" min="1" max="365" value="' + Number(settings.data?.listing_expiry_days || 30) + '"><button class="claim-review accept" id="saveExpiry">Save</button></div>' +
    '<h3>Student management</h3>' + profileRows.map(row => '<article class="admin-row"><div class="admin-row-main"><strong>' + esc(row.display_name || "Student") + '</strong><small>' + Number(row.reputation_points||0) + ' points · ' + Number(row.successful_returns||0) + ' returns</small><span class="activity-status">' + (row.is_suspended ? "Suspended" : "Active") + '</span></div><button class="claim-review ' + (row.is_suspended ? "accept" : "reject") + '" data-suspend="' + esc(row.id) + '" data-state="' + (!row.is_suspended) + '">' + (row.is_suspended ? "Restore" : "Suspend") + '</button></article>').join("") +
    '<div class="admin-export"><button class="button button-secondary" id="exportReports">Export reports CSV</button><button class="button button-secondary" id="exportLogs">Export activity CSV</button></div>' +
    '<h3>Admin activity history</h3>' + (logRows.length ? logRows.map(row => '<article class="admin-row"><div class="admin-row-main"><strong>' + esc(row.action) + '</strong><small>' + esc(row.target_type || "system") + ' · ' + esc(new Date(row.created_at).toLocaleString()) + '</small></div></article>').join("") : '<p class="account-empty">No admin actions recorded yet.</p>')
  );
  $("#saveExpiry")?.addEventListener("click", async () => {
    const days = Number($("#expiryDays").value);
    if (!Number.isInteger(days) || days < 1 || days > 365) return notify("Choose between 1 and 365 days.");
    const {error} = await supabase.from("findit_settings").update({listing_expiry_days:days,updated_at:new Date().toISOString()}).eq("id",true);
    if (error) return notify("Could not save expiry setting: " + error.message);
    await logAdminAction("Updated listing expiry","settings",null,{days}); notify("Listing expiry updated.");
  });
  target.querySelectorAll("[data-suspend]").forEach(button => button.addEventListener("click", async () => {
    const {error} = await supabase.from("profiles").update({is_suspended:button.dataset.state === "true"}).eq("id",button.dataset.suspend);
    if (error) return notify("Could not update student: " + error.message);
    await logAdminAction(button.dataset.state === "true" ? "Suspended student" : "Restored student","profile",button.dataset.suspend);
    await loadAdminDashboard();
  }));
  $("#exportReports")?.addEventListener("click", async () => {
    const {data,error}=await supabase.from("reports").select("id,item_id,reporter_id,reason,status,created_at");
    if(error) return notify("Export failed: "+error.message); downloadCsv("findit-reports.csv",data||[]);
  });
  $("#exportLogs")?.addEventListener("click", async () => downloadCsv("findit-admin-activity.csv",logRows));
}

async function loadNotifications() {
  if (!currentUser || !supabase || !$("#notificationList")) return;
  const { data, error } = await supabase.from("notifications")
    .select("id,title,body,read_at,created_at")
    .order("created_at", { ascending: false }).limit(40);
  if (error) {
    $("#notificationList").innerHTML = '<p class="form-error">Could not load notifications: ' + esc(error.message) + '</p>';
    return;
  }
  const rows = data || [];
  const unread = rows.filter(row => !row.read_at).length;
  if ($("#notificationCount")) {
    $("#notificationCount").textContent = unread > 9 ? "9+" : String(unread);
    $("#notificationCount").hidden = unread === 0;
  }
  $("#notificationList").innerHTML = rows.length ? rows.map(row =>
    '<article class="notification-row ' + (row.read_at ? "is-read" : "is-unread") + '">' +
    '<div><strong>' + esc(row.title) + '</strong><p>' + esc(row.body) + '</p><small>' +
    esc(new Date(row.created_at).toLocaleString()) + '</small></div>' +
    (!row.read_at ? '<button type="button" class="notification-read" data-read-notification="' + esc(row.id) + '">Mark read</button>' : '') +
    '</article>'
  ).join("") : '<div class="account-empty"><span>♡</span><p>You are all caught up.</p></div>';

  $("#notificationList").querySelectorAll("[data-read-notification]").forEach(button => {
    button.addEventListener("click", async () => {
      const { error: updateError } = await supabase.from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", button.dataset.readNotification).eq("user_id", currentUser.id);
      if (updateError) return notify("Couldn't update notification: " + updateError.message);
      await loadNotifications();
    });
  });
}
async function openNotifications() {
  if (!await needLogin()) return;
  if (!$("#notificationDialog")) return;
  $("#notificationDialog").showModal();
  await loadNotifications();
}
async function markAllNotificationsRead() {
  if (!currentUser || !supabase) return;
  const { error } = await supabase.from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", currentUser.id).is("read_at", null);
  if (error) return notify("Couldn't mark notifications as read: " + error.message);
  await loadNotifications();
}
function subscribeNotifications() {
  if (!supabase || !currentUser) return;
  if (notificationChannel) supabase.removeChannel(notificationChannel);
  notificationChannel = supabase.channel("findit-notifications-" + currentUser.id)
    .on("postgres_changes", {
      event: "INSERT", schema: "public", table: "notifications",
      filter: "user_id=eq." + currentUser.id
    }, () => {
      loadNotifications();
      notify("You have a new notification.");
    }).subscribe();
  loadNotifications();
}

async function markPostReturned(itemId, button) {
  if (!currentUser || !supabase) return;
  const confirmed = window.confirm("Mark this item as returned? This will close the listing and complete any accepted claim.");
  if (!confirmed) return;
  button.disabled = true;
  const { error } = await supabase.from("items").update({ status: "returned" })
    .eq("id", itemId).eq("owner_id", currentUser.id);
  if (error) {
    button.disabled = false;
    return notify("Couldn't update listing: " + error.message);
  }
  await supabase.from("claims").update({ status: "completed" })
    .eq("item_id", itemId).eq("status", "accepted");
  notify("Item marked as returned. Nice one!");
  await loadAccountData();
  await loadItems();
}

async function loadAccountData() {
  if (!supabase || !currentUser) return;
  $("#accountContent").innerHTML = '<p class="loading-state">Loading your activity...</p>';
  const [posts, claims, received, reports] = await Promise.all([
    supabase.from("items").select("id,title,item_type,campus_location,status,created_at").eq("owner_id", currentUser.id).order("created_at", { ascending: false }),
    supabase.from("claims").select("id,message,status,created_at,items!claims_item_id_fkey(title,item_type,owner_id)").eq("claimant_id", currentUser.id).order("created_at", { ascending: false }),
    supabase.from("claims").select("id,item_id,claimant_id,message,status,created_at,items!inner(title,item_type,owner_id)").eq("items.owner_id", currentUser.id).order("created_at", { ascending: false }),
    supabase.from("reports").select("id,reason,status,created_at,items!reports_item_id_fkey(title)").eq("reporter_id", currentUser.id).order("created_at", { ascending: false })
  ]);
  const failed = [posts, claims, received, reports].find((result) => result.error);
  if (failed) {
    console.error("FindIt account activity:", failed.error);
    $("#accountContent").innerHTML = '<p class="form-error">Could not load your activity. ' + esc(failed.error.message) + '</p>';
    return;
  }
  accountData = { posts: posts.data || [], claims: claims.data || [], received: received.data || [], reports: reports.data || [] };
  renderAccountTab();
}
async function openAccount() {
  if (!await needLogin()) return;
  $("#accountName").textContent = currentProfile?.display_name || "Student";
  $("#accountEmail").textContent = currentUser.email || "";
  $("#accountAvatar").textContent = (currentProfile?.display_name || currentUser.email || "S").trim().charAt(0).toUpperCase();
  $("#profileName").value = currentProfile?.display_name || "";
  errorAt("#profileError");
  accountTab = "posts";
  document.querySelectorAll(".account-tab").forEach((button) => button.classList.toggle("active", button.dataset.accountTab === accountTab));
  accountDialog.showModal();
  await loadAccountData();
}
async function saveProfile(event) {
  event.preventDefault();
  errorAt("#profileError");
  const displayName = $("#profileName").value.trim();
  if (displayName.length < 2) return errorAt("#profileError", "Please enter at least 2 characters.");
  const button = $("#saveProfile");
  button.disabled = true;
  button.textContent = "Saving...";
  const { data, error } = await supabase.from("profiles").update({ display_name: displayName }).eq("id", currentUser.id).select("display_name").single();
  button.disabled = false;
  button.textContent = "Save profile";
  if (error) return errorAt("#profileError", error.message);
  currentProfile = data;
  header();
  $("#accountName").textContent = displayName;
  $("#accountAvatar").textContent = displayName.charAt(0).toUpperCase();
  notify("Your profile has been updated.");
}


function openItemDetails(itemId) {
  activeDetailItem = allItems.find((item) => item.id === itemId);
  if (!activeDetailItem) return;
  const item = activeDetailItem;
  rememberViewed(item.id);
  const photos = (item.media?.length ? item.media.map(row => row.storage_path) : (item.image_path ? [item.image_path] : []));
  const image = photos.length
    ? '<div class="detail-gallery">' + photos.map(path => '<img class="detail-image" src="' + esc(supabase.storage.from("item-images").getPublicUrl(path).data.publicUrl) + '" alt="' + esc(item.title) + '">').join("") + '</div>'
    : '<div class="detail-placeholder">♡</div>';
  const ownerCanClaim = currentUser && currentUser.id !== item.owner_id && item.status === "active";
  $("#detailContent").innerHTML = image +
    '<div class="eyebrow">' + esc(item.item_type.toUpperCase()) + ' ITEM</div>' +
    '<h2>' + esc(item.title) + '</h2><p>' + esc(item.description) + '</p>' +
    '<div class="detail-meta"><span>' + esc(item.category) + '</span><span>' + esc(item.building || item.campus_location) + '</span><span>' + esc(item.event_date || new Date(item.created_at).toLocaleDateString()) + '</span></div>' +
    (ownerCanClaim ? '<button class="button button-primary full-button" id="detailClaim">Submit a claim ↗</button>' : "") +
    (currentUser && currentUser.id !== item.owner_id ? '<button class="button button-secondary full-button report-listing-button" id="detailReport">Report this listing</button>' : "");
  if (ownerCanClaim) $("#detailClaim").addEventListener("click", () => {
    $("#itemDetails").close();
    openClaim(item.id);
  });
  if (currentUser && currentUser.id !== item.owner_id) {
    $("#detailReport")?.addEventListener("click", () => {
      $("#itemDetails").close();
      openReport(item.id);
    });
  }
  $("#itemDetails").showModal();
}
function openReport(itemId) {
  if (!currentUser) return needLogin();
  activeReportItem = allItems.find((item) => item.id === itemId);
  if (!activeReportItem || activeReportItem.owner_id === currentUser.id) return;
  $("#reportItemTitle").textContent = activeReportItem.title;
  $("#reportForm").reset();
  errorAt("#reportError");
  $("#reportDialog").showModal();
}

async function submitReport(event) {
  event.preventDefault();
  errorAt("#reportError");
  if (!currentUser || !activeReportItem) return;
  const category = $("#reportReason").value;
  const details = $("#reportDetails").value.trim();
  const reason = category + (details ? ": " + details : "");
  if (reason.length > 1000) return errorAt("#reportError", "Please keep your report under 1,000 characters.");

  const button = $("#submitReport");
  button.disabled = true;
  button.textContent = "Sending...";
  const existing = await supabase.from("reports").select("id")
    .eq("item_id", activeReportItem.id).eq("reporter_id", currentUser.id).limit(1);
  if (existing.error) {
    button.disabled = false;
    button.textContent = "Submit report";
    return errorAt("#reportError", "Could not check your previous reports. " + existing.error.message);
  }
  if (existing.data?.length) {
    button.disabled = false;
    button.textContent = "Submit report";
    return errorAt("#reportError", "You've already reported this listing.");
  }

  const { error } = await supabase.from("reports").insert({
    item_id: activeReportItem.id, reporter_id: currentUser.id, reason
  });
  button.disabled = false;
  button.textContent = "Submit report";
  if (error) return errorAt("#reportError", "Could not submit report: " + error.message);

  $("#reportDialog").close();
  activeReportItem = null;
  notify("Thanks. Your report has been sent to the FindIt admin.");
}

async function loadItems() {
  if (!supabase || !grid) return;
  grid.innerHTML = '<p class="loading">Loading campus listings...</p>';
  const { data, error } = await supabase.from("items")
    .select("id,item_type,title,description,category,campus_location,building,event_date,status,created_at,owner_id,image_path,expires_at,verification_question,item_media(storage_path)")
    .eq("moderation_status", "published")
    .in("status", ["active", "claimed"]).or("expires_at.is.null,expires_at.gt." + new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(60);

  if (error) {
    grid.innerHTML = "";
    if ($("#count")) $("#count").textContent = "UNAVAILABLE";
    console.error("FindIt listings:", error);
    notify("Couldn't load listings: " + error.message);
    return;
  }
  allItems = data || [];
  allItems.forEach(item => item.media = item.item_media || []);
  render();

  const [total, lost, found, returned] = await Promise.all([
    supabase.from("items").select("id", { count: "exact", head: true }).eq("moderation_status", "published").in("status", ["active", "claimed"]),
    supabase.from("items").select("id", { count: "exact", head: true }).eq("moderation_status", "published").eq("item_type", "lost").in("status", ["active", "claimed"]),
    supabase.from("items").select("id", { count: "exact", head: true }).eq("moderation_status", "published").eq("item_type", "found").in("status", ["active", "claimed"]),
    supabase.from("items").select("id", { count: "exact", head: true }).eq("moderation_status", "published").eq("status", "returned")
  ]);
  if ($("#statTotal")) $("#statTotal").textContent = total.count ?? "—";
  if ($("#statLost")) $("#statLost").textContent = lost.count ?? "—";
  if ($("#statFound")) $("#statFound").textContent = found.count ?? "—";
  if ($("#statReturned")) $("#statReturned").textContent = returned.count ?? "—";
}

async function refreshSession() {
  if (!supabase) return;
  const { data, error } = await supabase.auth.getSession();
  if (error) console.error("FindIt session:", error);
  currentUser = data?.session?.user || null;
  currentProfile = null;
  if (notificationChannel) { await supabase.removeChannel(notificationChannel); notificationChannel = null; }
  if (currentUser) subscribeNotifications();
  currentRole = null;
  if (currentUser) {
    const roleResult = await supabase.from("user_roles").select("role").eq("user_id", currentUser.id).maybeSingle();
    if (!roleResult.error) currentRole = roleResult.data?.role || null;
    const result = await supabase.from("profiles")
      .select("display_name").eq("id", currentUser.id).maybeSingle();
    if (!result.error) currentProfile = result.data;
  }
  header();
  render();
}

async function signIn() {
  if (!supabase) return errorAt("#authError", "FindIt is still connecting. Please wait a moment and try again.");
  errorAt("#authError");
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: "https://findit-msu-gensan.vercel.app/"
    }
  });
  if (error) errorAt("#authError", error.message);
}

async function uploadPhoto(file, itemId) {
  if (!file) return null;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5242880) {
    throw new Error("Choose a JPG, PNG, or WebP image under 5 MB.");
  }
  const extension = file.name.split(".").pop().toLowerCase();
  const path = currentUser.id + "/" + itemId + "/" + crypto.randomUUID() + "." + extension;
  const { error } = await supabase.storage.from("item-images")
    .upload(path, file, { contentType: file.type });
  if (error) throw error;
  const { error: mediaError } = await supabase.from("item_media").insert({
    item_id: itemId, uploader_id: currentUser.id, storage_path: path, media_type: "image"
  });
  if (mediaError) throw mediaError;
  return path;
}

async function createItem(event) {
  event.preventDefault();
  errorAt("#postError");
  if (!supabase) return errorAt("#postError", "FindIt is still connecting. Please try again.");
  if (!await needLogin()) return;

  const description = $("#itemDescription").value.trim();
  if (description.length < 5) {
    return errorAt("#postError", "Please write at least 5 characters in the description.");
  }

  const button = $("#submitItem");
  button.disabled = true;
  button.textContent = "Publishing...";
  try {
    const possibleDuplicate = allItems.find(row => row.item_type === $("#itemType").value && row.title.toLowerCase() === $("#itemTitle").value.trim().toLowerCase() && row.category === $("#itemCategory").value && (row.building || row.campus_location).toLowerCase() === ($("#itemBuilding").value.trim() || $("#itemLocation").value.trim()).toLowerCase());
    if (possibleDuplicate && !window.confirm("A similar listing already exists. Post anyway?")) return;
    const item = {
      owner_id: currentUser.id,
      item_type: $("#itemType").value,
      title: $("#itemTitle").value.trim(),
      category: $("#itemCategory").value,
      campus_location: $("#itemLocation").value.trim(),
      building: $("#itemBuilding").value.trim() || null,
      verification_question: $("#verificationQuestion").value.trim() || null,
      event_date: $("#itemDate").value || null,
      description
    };
    const { data, error } = await supabase.from("items").insert(item).select("id").single();
    if (error) throw error;

    const files = Array.from($("#itemPhoto").files || []);
    if (files.length > 5) throw new Error("Choose no more than 5 photos.");
    const uploadedPaths = [];
    for (const file of files) uploadedPaths.push(await uploadPhoto(file, data.id));
    if (uploadedPaths.length) {
      const { error: pathError } = await supabase.from("items")
        .update({ image_path: uploadedPaths[0] }).eq("id", data.id);
      if (pathError) throw pathError;
    }

    submission.close();
    $("#postForm").reset();
    notify("Your item has been posted.");
    await loadItems();
  } catch (error) {
    console.error("FindIt post:", error);
    errorAt("#postError", error.message || "Couldn't publish your item.");
  } finally {
    button.disabled = false;
    button.textContent = "Publish item";
  }
}

async function openClaim(id) {
  if (!supabase) return notify("FindIt is still connecting. Please try again.");
  if (!await needLogin()) return;
  selectedItem = allItems.find((item) => item.id === id);
  if (!selectedItem) return;
  $("#claimForm").reset();
  $("#claimQuestionLabel").textContent = selectedItem.verification_question || "Verification answer (describe a unique detail)";
  $("#claimAnswer").placeholder = selectedItem.verification_question || "Describe a unique detail only the owner would know";
  errorAt("#claimError");
  claimDialog.showModal();
}

async function submitClaim(event) {
  event.preventDefault();
  errorAt("#claimError");
  if (!supabase || !currentUser || !selectedItem) return;
  const button = $("#claimForm button[type=submit]");
  button.disabled = true;
  const answer = $("#claimAnswer").value.trim();
  const { error } = await supabase.from("claims").insert({
    item_id: selectedItem.id,
    claimant_id: currentUser.id,
    verification_answer: answer,
    message: $("#claimMessage").value.trim()
  });
  button.disabled = false;
  if (error) {
    errorAt("#claimError", error.code === "23505"
      ? "You've already sent a claim for this item." : error.message);
    return;
  }
  claimDialog.close();
  notify("Claim request sent to the item owner.");
}

$("#login")?.addEventListener("click", openLogin);
$("#account")?.addEventListener("click", openAccount);
$("#adminDashboard")?.addEventListener("click", openAdminDashboard);
$("#notificationsButton")?.addEventListener("click", openNotifications);
$("#markAllNotifications")?.addEventListener("click", markAllNotificationsRead);
$("#profileForm")?.addEventListener("submit", saveProfile);
document.querySelectorAll("[data-account-tab]").forEach((button) => button.addEventListener("click", () => { accountTab = button.dataset.accountTab; document.querySelectorAll(".account-tab").forEach((tab) => tab.classList.toggle("active", tab === button)); renderAccountTab(); }));
$("#messageForm")?.addEventListener("submit", sendMessage);
$("#closeMessages")?.addEventListener("click", closeMessageDialog);
$("#messageDialog")?.addEventListener("close", async () => { if (messageChannel && supabase) { await supabase.removeChannel(messageChannel); messageChannel = null; } activeConversation = null; });
$("#accountDialog")?.querySelector("[data-close-account]")?.addEventListener("click", () => accountDialog.close());
$("#googleLogin")?.addEventListener("click", signIn);
$("#themeToggle")?.addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
$("#preferencesButton")?.addEventListener("click", async () => { if (!await needLogin()) return; $("#preferencesDialog").showModal(); await loadPreferences(); });
$("#preferencesForm")?.addEventListener("submit", savePreferences);
$("#logout")?.addEventListener("click", signOut);
["#post", "#post2", "#report"].forEach((selector) => {
  $(selector)?.addEventListener("click", async () => {
    if (await needLogin() && submission) submission.showModal();
  });
});
$("#postForm")?.addEventListener("submit", createItem);
$("#claimForm")?.addEventListener("submit", submitClaim);
$("#reportForm")?.addEventListener("submit", submitReport);
document.querySelectorAll(".close-button").forEach((button) => {
  button.addEventListener("click", (event) => {
    event.preventDefault();
    button.closest("dialog")?.close();
  });
});
$("#itemPhoto")?.addEventListener("change", () => {
  const files = Array.from($("#itemPhoto").files || []);
  $("#fileName").textContent = files.length ? files.map(file => file.name).join(", ") : "No files selected";
  $("#uploadZone")?.classList.toggle("has-file", !!files.length);
  $("#photoPreviews").innerHTML = files.slice(0,5).map(file => '<img alt="Photo preview" src="' + URL.createObjectURL(file) + '">').join("");
});
const uploadZone = $("#uploadZone");
uploadZone?.addEventListener("dragover", (event) => {
  event.preventDefault();
  uploadZone.classList.add("dragging");
});
uploadZone?.addEventListener("dragleave", () => uploadZone.classList.remove("dragging"));
uploadZone?.addEventListener("drop", (event) => {
  event.preventDefault();
  uploadZone.classList.remove("dragging");
  const files = Array.from(event.dataTransfer.files || []).slice(0,5);
  if (!files.length) return;
  const transfer = new DataTransfer();
  files.forEach(file => transfer.items.add(file));
  $("#itemPhoto").files = transfer.files;
  $("#itemPhoto").dispatchEvent(new Event("change", { bubbles: true }));
});

search?.addEventListener("input", render);
$("#dateFilter")?.addEventListener("change", render);
$("#buildingFilter")?.addEventListener("input", render);
$("#categoryFilter")?.addEventListener("change", (event) => {
  categoryFilter = event.target.value;
  render();
});
$("#sortOrder")?.addEventListener("change", (event) => {
  sortOrder = event.target.value;
  render();
});
document.querySelectorAll(".filter").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelector(".filter.active")?.classList.remove("active");
    button.classList.add("active");
    filter = button.dataset.filter;
    render();
  });
});

async function loadPreferences() {
  if (!currentUser || !supabase) return;
  const {data} = await supabase.from("user_preferences").select("theme,email_notifications").eq("user_id",currentUser.id).maybeSingle();
  const theme = data?.theme || localStorage.getItem("finditTheme") || "light";
  $("#themePreference").value = theme;
  $("#emailNotifications").checked = data?.email_notifications ?? true;
  setTheme(theme);
}
function setTheme(theme) {
  const resolved = theme === "system" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : theme;
  document.documentElement.dataset.theme = resolved;
  localStorage.setItem("finditTheme", theme);
  if ($("#themeToggle")) $("#themeToggle").textContent = resolved === "dark" ? "☀" : "☾";
}
async function savePreferences(event) {
  event.preventDefault();
  const theme = $("#themePreference").value;
  const payload = {user_id:currentUser.id,theme,email_notifications:$("#emailNotifications").checked,updated_at:new Date().toISOString()};
  const {error} = await supabase.from("user_preferences").upsert(payload,{onConflict:"user_id"});
  if (error) { $("#preferencesError").textContent = error.message; return; }
  setTheme(theme); $("#preferencesDialog").close(); notify("Preferences saved.");
}

async function startFindIt() {
  try {
    let createClient = window.supabase?.createClient;
    if (typeof createClient !== "function") {
      try {
        ({ createClient } = await import("https://esm.sh/@supabase/supabase-js@2"));
      } catch (firstError) {
        console.warn("Primary Supabase CDN failed:", firstError);
        ({ createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm"));
      }
    }
    if (typeof createClient !== "function") throw new Error("Supabase client could not be loaded.");

    supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
    supabase.auth.onAuthStateChange((_event, session) => {
      currentUser = session?.user || null;
      currentProfile = null;
      if (currentUser) subscribeNotifications();
      header();
      render();
    });

    await refreshSession();
    await loadItems();
    clearNotice();
  } catch (error) {
    console.error("FindIt startup failed:", error);
    notify("FindIt couldn't connect. Check your internet connection, then refresh. Details: " + error.message);
  }
}

header();
render();
startFindIt();
