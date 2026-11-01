const SUPABASE_URL = "https://bmtearyxlnrzgcuvcepw.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_Lck0L35G-vtAqFRQfMUH2A_fhQ2neY4";

let supabase = null;
let currentUser = null;
let currentProfile = null;
let selectedItem = null;
let filter = "All";
let categoryFilter = "All";
let sortOrder = "newest";
let allItems = [];
let savedItemIds = new Set();
let activeDetailItem = null;

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
  if ($("#account")) $("#account").hidden = !currentUser;\n  if ($("#userLabel")) $("#userLabel").textContent =
    currentProfile?.display_name || currentUser?.email || "";
}
function openLogin() {
  if (!auth) return;
  if (!auth.open) auth.showModal();
}
async function needLogin() {
  if (currentUser) return true;
  openLogin();
  errorAt("#authError", "Sign in with your MSU Gensan Google account to continue.");
  return false;
}

function render() {
  if (!grid || !search) return;
  const query = search.value.trim().toLowerCase();
  const rows = allItems.filter((item) =>
    (filter === "All" || item.item_type === filter) &&
    (categoryFilter === "All" || item.category === categoryFilter) &&
    [item.title, item.description, item.category, item.campus_location]
      .join(" ").toLowerCase().includes(query)
  ).sort((a, b) => sortOrder === "newest"
    ? new Date(b.created_at) - new Date(a.created_at)
    : new Date(a.created_at) - new Date(b.created_at));
  if ($("#count")) $("#count").textContent = rows.length + " ITEMS";
  if ($("#empty")) $("#empty").hidden = rows.length > 0;

  grid.innerHTML = rows.map((item) => {
    const photo = item.image_path && supabase
      ? '<img src="' + esc(supabase.storage.from("item-images").getPublicUrl(item.image_path).data.publicUrl) + '" alt="Item photo" loading="lazy">'
      : '<span class="item-symbol">⌕</span>';
    const claim = currentUser && currentUser.id !== item.owner_id && item.status === "active"
      ? '<button class="claim-button" data-claim="' + esc(item.id) + '">Submit a claim</button>'
      : "";
    const saved = currentUser
      ? '<button class="save-button ' + (savedItemIds.has(item.id) ? 'is-saved' : '') + '" data-save="' + esc(item.id) + '" aria-label="Save item">' + (savedItemIds.has(item.id) ? '♥ Saved' : '♡ Save') + '</button>'
      : "";
    return '<article class="card"><button class="card-open" data-view="' + esc(item.id) + '" aria-label="View ' + esc(item.title) + '"><div class="visual"><span class="tag ' + esc(item.item_type) + '">' +
      esc(item.item_type.toUpperCase()) + '</span>' + photo +
      '</div><div class="body"><h3>' + esc(item.title) + '</h3><p>' +
      esc(item.description) + '</p><div class="meta">' + esc(item.category) + ' · ' +
      esc(item.campus_location) + ' · ' +
      esc(item.event_date || new Date(item.created_at).toLocaleDateString()) +
      '</div></div></button><div class="card-actions">' + saved + claim + '</div></article>';
  }).join("");

  grid.querySelectorAll("[data-claim]").forEach((button) => {
    button.addEventListener("click", () => openClaim(button.dataset.claim));
  });
  grid.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => openItemDetails(button.dataset.view));
  });
  grid.querySelectorAll("[data-save]").forEach((button) => {
    button.addEventListener("click", () => toggleSavedItem(button.dataset.save));
  });
}


const accountDialog = $("#accountDialog");
let accountData = { posts: [], claims: [], saved: [] };
let accountTab = "posts";

function statusLabel(status) {
  return String(status || "unknown").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function accountRow(title, detail, status, date) {
  return '<article class="activity-row"><div><strong>' + esc(title) + '</strong><small>' + esc(detail || "") + '</small></div><div class="activity-side"><span class="activity-status">' + esc(statusLabel(status)) + '</span><small>' + esc(date ? new Date(date).toLocaleDateString() : "") + '</small></div></article>';
}
function renderAccountTab() {
  const target = $("#accountContent");
  if (!target) return;
  const rows = accountData[accountTab] || [];
  if (!rows.length) {
    const messages = { posts: "You haven't posted any items yet.", claims: "You haven't submitted any claims yet.", saved: "You haven't saved any listings yet." };
    target.innerHTML = '<div class="account-empty"><span>♡</span><p>' + messages[accountTab] + '</p></div>';
    return;
  }
  if (accountTab === "posts") {
    target.innerHTML = rows.map((item) => accountRow(item.title, item.item_type.toUpperCase() + " · " + item.campus_location, item.status, item.created_at)).join("");
  } else if (accountTab === "claims") {
    target.innerHTML = rows.map((claim) => accountRow(claim.items?.title || "Campus item", claim.items?.item_type?.toUpperCase() + " · " + claim.message, claim.status, claim.created_at)).join("");
  } else {
    target.innerHTML = rows.map((saved) => accountRow(saved.items?.title || "Campus item", (saved.items?.item_type || "").toUpperCase() + " · " + (saved.items?.campus_location || ""), saved.items?.status || "saved", saved.created_at)).join("");
  }
}
async function loadAccountData() {
  if (!supabase || !currentUser) return;
  $("#accountContent").innerHTML = '<p class="loading-state">Loading your activity...</p>';
  const [posts, claims, saved] = await Promise.all([
    supabase.from("items").select("id,title,item_type,campus_location,status,created_at").eq("owner_id", currentUser.id).order("created_at", { ascending: false }),
    supabase.from("claims").select("id,message,status,created_at,items!claims_item_id_fkey(title,item_type)").eq("claimant_id", currentUser.id).order("created_at", { ascending: false }),
    supabase.from("saved_items").select("id,created_at,items!saved_items_item_id_fkey(title,item_type,campus_location,status)").order("created_at", { ascending: false })
  ]);
  const failed = [posts, claims, saved].find((result) => result.error);
  if (failed) {
    console.error("FindIt account activity:", failed.error);
    $("#accountContent").innerHTML = '<p class="form-error">Could not load your activity. ' + esc(failed.error.message) + '</p>';
    return;
  }
  accountData = { posts: posts.data || [], claims: claims.data || [], saved: saved.data || [] };
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
\nasync function loadSavedItems() {
  savedItemIds = new Set();
  if (!supabase || !currentUser) return;
  const { data, error } = await supabase.from("saved_items").select("item_id");
  if (error) {
    console.error("FindIt saved items:", error);
    return;
  }
  savedItemIds = new Set((data || []).map((row) => row.item_id));
}
async function toggleSavedItem(itemId) {
  if (!currentUser) return needLogin();
  const isSaved = savedItemIds.has(itemId);
  const result = isSaved
    ? await supabase.from("saved_items").delete().eq("item_id", itemId).eq("user_id", currentUser.id)
    : await supabase.from("saved_items").insert({ item_id: itemId, user_id: currentUser.id });
  if (result.error) return notify("Couldn't update saved items: " + result.error.message);
  if (isSaved) savedItemIds.delete(itemId);
  else savedItemIds.add(itemId);
  render();
  notify(isSaved ? "Removed from saved items." : "Item saved.");
}
function openItemDetails(itemId) {
  activeDetailItem = allItems.find((item) => item.id === itemId);
  if (!activeDetailItem) return;
  const item = activeDetailItem;
  const imageUrl = item.image_path
    ? supabase.storage.from("item-images").getPublicUrl(item.image_path).data.publicUrl
    : "";
  const image = imageUrl
    ? '<img class="detail-image" src="' + esc(imageUrl) + '" alt="' + esc(item.title) + '">'
    : '<div class="detail-placeholder">♡</div>';
  const ownerCanClaim = currentUser && currentUser.id !== item.owner_id && item.status === "active";
  $("#detailContent").innerHTML = image +
    '<div class="eyebrow">' + esc(item.item_type.toUpperCase()) + ' ITEM</div>' +
    '<h2>' + esc(item.title) + '</h2><p>' + esc(item.description) + '</p>' +
    '<div class="detail-meta"><span>' + esc(item.category) + '</span><span>' + esc(item.campus_location) + '</span><span>' + esc(item.event_date || new Date(item.created_at).toLocaleDateString()) + '</span></div>' +
    (ownerCanClaim ? '<button class="button button-primary full-button" id="detailClaim">Submit a claim ↗</button>' : "");
  if (ownerCanClaim) $("#detailClaim").addEventListener("click", () => {
    $("#itemDetails").close();
    openClaim(item.id);
  });
  $("#itemDetails").showModal();
}
async function loadItems() {
  if (!supabase || !grid) return;
  grid.innerHTML = '<p class="loading">Loading campus listings...</p>';
  const { data, error } = await supabase.from("items")
    .select("id,item_type,title,description,category,campus_location,event_date,status,created_at,owner_id,image_path")
    .eq("moderation_status", "published")
    .in("status", ["active", "claimed"])
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
  await loadSavedItems();
  if (currentUser) {
    const result = await supabase.from("profiles")
      .select("display_name").eq("id", currentUser.id).maybeSingle();
    if (!result.error) currentProfile = result.data;
  }
  header();
  render();
}

async function signIn() {
  if (!supabase) {
    errorAt("#authError", "FindIt is still connecting. Please wait a moment and try again.");
    return;
  }
  errorAt("#authError");
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: "https://findit-msu-gensan.vercel.app/",
      queryParams: { hd: "msugensan.edu.ph" }
    }
  });
  if (error) errorAt("#authError", error.message);
}

async function signOut() {
  if (!supabase) return notify("FindIt is not connected yet. Refresh and try again.");
  const { error } = await supabase.auth.signOut();
  if (error) return notify(error.message);
  currentUser = null;
  currentProfile = null;
  header();
  render();
  notify("Signed out.");
}

async function uploadPhoto(file, itemId) {
  if (!file) return null;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5242880) {
    throw new Error("Choose a JPG, PNG, or WebP image under 5 MB.");
  }
  const extension = file.name.split(".").pop().toLowerCase();
  const path = currentUser.id + "/" + itemId + "." + extension;
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
    const item = {
      owner_id: currentUser.id,
      item_type: $("#itemType").value,
      title: $("#itemTitle").value.trim(),
      category: $("#itemCategory").value,
      campus_location: $("#itemLocation").value.trim(),
      event_date: $("#itemDate").value || null,
      description
    };
    const { data, error } = await supabase.from("items").insert(item).select("id").single();
    if (error) throw error;

    const photoPath = await uploadPhoto($("#itemPhoto").files[0], data.id);
    if (photoPath) {
      const { error: pathError } = await supabase.from("items")
        .update({ image_path: photoPath }).eq("id", data.id);
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
  errorAt("#claimError");
  claimDialog.showModal();
}

async function submitClaim(event) {
  event.preventDefault();
  errorAt("#claimError");
  if (!supabase || !currentUser || !selectedItem) return;
  const button = $("#claimForm button[type=submit]");
  button.disabled = true;
  const { error } = await supabase.from("claims").insert({
    item_id: selectedItem.id,
    claimant_id: currentUser.id,
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

$("#login")?.addEventListener("click", openLogin);\n$("#account")?.addEventListener("click", openAccount);\n$("#profileForm")?.addEventListener("submit", saveProfile);\ndocument.querySelectorAll("[data-account-tab]").forEach((button) => button.addEventListener("click", () => { accountTab = button.dataset.accountTab; document.querySelectorAll(".account-tab").forEach((tab) => tab.classList.toggle("active", tab === button)); renderAccountTab(); }));\n$("#accountDialog")?.querySelector("[data-close-account]")?.addEventListener("click", () => accountDialog.close());
$("#googleLogin")?.addEventListener("click", signIn);
$("#logout")?.addEventListener("click", signOut);
["#post", "#post2", "#report"].forEach((selector) => {
  $(selector)?.addEventListener("click", async () => {
    if (await needLogin() && submission) submission.showModal();
  });
});
$("#postForm")?.addEventListener("submit", createItem);
$("#claimForm")?.addEventListener("submit", submitClaim);
document.querySelectorAll(".close-button").forEach((button) => {
  button.addEventListener("click", (event) => {
    event.preventDefault();
    button.closest("dialog")?.close();
  });
});
$("#itemPhoto")?.addEventListener("change", () => {
  const file = $("#itemPhoto").files[0];
  $("#fileName").textContent = file ? file.name : "No file selected";
  $("#uploadZone")?.classList.toggle("has-file", !!file);
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
  const file = event.dataTransfer.files[0];
  if (!file) return;
  const transfer = new DataTransfer();
  transfer.items.add(file);
  $("#itemPhoto").files = transfer.files;
  $("#itemPhoto").dispatchEvent(new Event("change", { bubbles: true }));
});

search?.addEventListener("input", render);
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
