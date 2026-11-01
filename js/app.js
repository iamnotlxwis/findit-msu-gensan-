const SUPABASE_URL = "https://bmtearyxlnrzgcuvcepw.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_Lck0L35G-vtAqFRQfMUH2A_fhQ2neY4";

let supabase = null;
let currentUser = null;
let currentProfile = null;
let selectedItem = null;
let filter = "All";
let allItems = [];

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
  errorAt("#authError", "Sign in with your MSU Gensan Google account to continue.");
  return false;
}

function render() {
  if (!grid || !search) return;
  const query = search.value.trim().toLowerCase();
  const rows = allItems.filter((item) =>
    (filter === "All" || item.item_type === filter) &&
    [item.title, item.description, item.category, item.campus_location]
      .join(" ").toLowerCase().includes(query)
  );
  if ($("#count")) $("#count").textContent = rows.length + " ITEMS";
  if ($("#empty")) $("#empty").hidden = rows.length > 0;

  grid.innerHTML = rows.map((item) => {
    const photo = item.image_path && supabase
      ? '<img src="' + esc(supabase.storage.from("item-images").getPublicUrl(item.image_path).data.publicUrl) + '" alt="Item photo" loading="lazy">'
      : '<span class="item-symbol">⌕</span>';
    const claim = currentUser && currentUser.id !== item.owner_id && item.status === "active"
      ? '<button class="claim-button" data-claim="' + esc(item.id) + '">This is mine / Contact</button>'
      : "";
    return '<article class="card"><div class="visual"><span class="tag ' + esc(item.item_type) + '">' +
      esc(item.item_type.toUpperCase()) + '</span>' + photo +
      '</div><div class="body"><h3>' + esc(item.title) + '</h3><p>' +
      esc(item.description) + '</p><div class="meta">' + esc(item.category) + ' · ' +
      esc(item.campus_location) + ' · ' +
      esc(item.event_date || new Date(item.created_at).toLocaleDateString()) +
      '</div>' + claim + '</div></article>';
  }).join("");

  grid.querySelectorAll("[data-claim]").forEach((button) => {
    button.addEventListener("click", () => openClaim(button.dataset.claim));
  });
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
}

async function refreshSession() {
  if (!supabase) return;
  const { data, error } = await supabase.auth.getSession();
  if (error) console.error("FindIt session:", error);
  currentUser = data?.session?.user || null;
  currentProfile = null;
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

$("#login")?.addEventListener("click", openLogin);
$("#googleLogin")?.addEventListener("click", signIn);
$("#logout")?.addEventListener("click", signOut);
["#post", "#post2", "#report"].forEach((selector) => {
  $(selector)?.addEventListener("click", async () => {
    if (await needLogin() && submission) submission.showModal();
  });
});
$("#postForm")?.addEventListener("submit", createItem);
$("#claimForm")?.addEventListener("submit", submitClaim);
search?.addEventListener("input", render);
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
