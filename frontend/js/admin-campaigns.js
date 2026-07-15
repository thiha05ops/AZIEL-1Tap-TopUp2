// frontend/js/admin-campaigns.js
// AZIEL Admin Campaign Manager for ENTRY_POPUP campaigns.

let adminCampaignsInitialized = false;
let adminCampaigns = [];
let campaignSavePending = false;

const CAMPAIGN_MEDIA_CATEGORIES = ["campaign", "promotion", "announcement"];

document.addEventListener("DOMContentLoaded", () => {
    initAdminCampaignsController();
});

function initAdminCampaignsController() {
    if (adminCampaignsInitialized) return;
    adminCampaignsInitialized = true;

    document.getElementById("addCampaignBtn")?.addEventListener("click", () => openCampaignEditor());

    window.addEventListener("aziel:admin-section-opened", event => {
        if (event.detail?.section === "campaigns") {
            loadAdminCampaigns();
        }
    });

    window.addEventListener("aziel:admin-locale-changed", () => {
        renderAdminCampaigns();
    });
}

async function loadAdminCampaigns(force = false) {
    const list = document.getElementById("adminCampaignList");
    if (!list) return;

    if (adminCampaigns.length && !force) {
        renderAdminCampaigns();
        return;
    }

    list.innerHTML = `
        <div class="admin-dashboard-skeleton"></div>
        <div class="admin-dashboard-skeleton"></div>
    `;

    const data = await adminFetch("/api/admin/campaigns");

    if (!data?.success) {
        list.innerHTML = `<p class="admin-empty-state">${escapeCampaignHtml(data?.message || adminT("campaign_load_failed", "Campaigns could not be loaded"))}</p>`;
        return;
    }

    adminCampaigns = Array.isArray(data.campaigns) ? data.campaigns : [];
    renderAdminCampaigns();
}

function renderAdminCampaigns() {
    const list = document.getElementById("adminCampaignList");
    if (!list) return;

    if (!adminCampaigns.length) {
        list.innerHTML = `<p class="admin-empty-state">${adminT("no_campaigns_found", "No campaigns found")}</p>`;
        return;
    }

    list.innerHTML = adminCampaigns.map(campaign => `
        <article class="campaign-row" data-campaign-id="${escapeCampaignHtml(campaign.id)}">
            <div class="campaign-row-main">
                <strong>${escapeCampaignHtml(campaign.name)}</strong>
                <small>${escapeCampaignHtml(campaign.campaignCode)} · ${adminT(campaign.type.toLowerCase(), campaign.type)} · ${adminT("entry_popup", "Entry Popup")}</small>
                <small>${formatCampaignRegions(campaign.regions)} · ${adminT(campaign.audience.toLowerCase(), campaign.audience)} · ${adminT(campaign.frequencyPolicy.toLowerCase(), campaign.frequencyPolicy)}</small>
                <small>${formatCampaignSchedule(campaign)}</small>
            </div>
            <div class="campaign-row-status">
                <b class="admin-status-pill ${campaignStateClass(campaign.state)}">${adminT(campaign.state.toLowerCase(), campaign.state)}</b>
                <small>${adminT("priority", "Priority")}: ${Number(campaign.priority || 0)}</small>
            </div>
            <div class="catalog-package-actions">
                <button class="admin-secondary-btn" type="button" data-preview-campaign="${escapeCampaignHtml(campaign.id)}">${adminT("preview", "Preview")}</button>
                <button class="admin-secondary-btn" type="button" data-edit-campaign="${escapeCampaignHtml(campaign.id)}">${adminT("edit", "Edit")}</button>
                <button class="admin-secondary-btn ${campaign.enabled ? "danger" : ""}" type="button" data-toggle-campaign="${escapeCampaignHtml(campaign.id)}">
                    ${adminT(campaign.enabled ? "disable" : "enable", campaign.enabled ? "Disable" : "Enable")}
                </button>
                <button class="admin-icon-btn danger" type="button" data-remove-campaign="${escapeCampaignHtml(campaign.id)}">${adminT("remove", "Remove")}</button>
            </div>
        </article>
    `).join("");

    list.querySelectorAll("[data-preview-campaign]").forEach(btn => {
        btn.addEventListener("click", () => previewCampaign(findCampaign(btn.dataset.previewCampaign)));
    });
    list.querySelectorAll("[data-edit-campaign]").forEach(btn => {
        btn.addEventListener("click", () => openCampaignEditor(findCampaign(btn.dataset.editCampaign)));
    });
    list.querySelectorAll("[data-toggle-campaign]").forEach(btn => {
        btn.addEventListener("click", () => toggleCampaign(findCampaign(btn.dataset.toggleCampaign)));
    });
    list.querySelectorAll("[data-remove-campaign]").forEach(btn => {
        btn.addEventListener("click", () => removeCampaign(btn.dataset.removeCampaign));
    });
}

function openCampaignEditor(campaign = null) {
    ensureCampaignEditorModal();
    const modal = document.getElementById("campaignEditorModal");
    modal.dataset.campaignId = campaign?.id || "";
    modal.dataset.mediaAssetId = campaign?.mediaAssetId || "";

    modal.querySelector("#campaignEditorTitle").textContent = campaign ? adminT("update_campaign", "Update Campaign") : adminT("create_campaign", "Create Campaign");
    modal.querySelector("#campaignName").value = campaign?.name || "";
    modal.querySelector("#campaignCode").value = campaign?.campaignCode || "";
    modal.querySelector("#campaignCode").disabled = Boolean(campaign);
    modal.querySelector("#campaignType").value = campaign?.type || "PROMOTION";
    modal.querySelector("#campaignPlacement").value = "ENTRY_POPUP";
    modal.querySelector("#campaignTitle").value = campaign?.title || "";
    modal.querySelector("#campaignBody").value = campaign?.body || "";
    modal.querySelector("#campaignCtaLabel").value = campaign?.ctaLabel || "";
    modal.querySelector("#campaignCtaTarget").value = campaign?.ctaTarget || "";
    modal.querySelector("#campaignRegion").value = campaignRegionsValue(campaign?.regions);
    modal.querySelector("#campaignAudience").value = campaign?.audience || "ALL_VISITORS";
    modal.querySelector("#campaignFrequency").value = campaign?.frequencyPolicy || "ONCE_PER_SESSION";
    modal.querySelector("#campaignPriority").value = campaign?.priority ?? 0;
    modal.querySelector("#campaignEnabled").checked = campaign?.enabled === true;
    modal.querySelector("#campaignStarts").value = toCampaignDatetimeValue(campaign?.startsAt);
    modal.querySelector("#campaignEnds").value = toCampaignDatetimeValue(campaign?.endsAt);
    modal.querySelector("#campaignMediaLabel").textContent = campaign?.mediaAsset?.name || adminT("select_campaign_image", "Select Campaign Image");

    modal.querySelector("#campaignMedia").onclick = async () => {
        const asset = await window.AZIEL_ADMIN_MEDIA_SELECTOR?.open?.({ categories: CAMPAIGN_MEDIA_CATEGORIES });
        if (!asset) return;
        modal.dataset.mediaAssetId = asset.assetId;
        modal.querySelector("#campaignMediaLabel").textContent = asset.name || asset.assetId;
    };
    modal.querySelector("#campaignMediaClear").onclick = () => {
        modal.dataset.mediaAssetId = "";
        modal.querySelector("#campaignMediaLabel").textContent = adminT("no_campaign_image", "No campaign image");
    };
    modal.querySelector("#campaignCancel").onclick = () => modal.classList.remove("show");
    modal.querySelector("#campaignSave").onclick = () => saveCampaign(campaign);

    modal.classList.add("show");
}

function ensureCampaignEditorModal() {
    if (document.getElementById("campaignEditorModal")) return;

    const modal = document.createElement("div");
    modal.id = "campaignEditorModal";
    modal.className = "admin-action-modal campaign-edit-modal";
    modal.innerHTML = `
        <div class="admin-action-modal-box campaign-editor-box">
            <div class="campaign-editor-header">
                <span>${adminT("campaign", "Campaign")}</span>
                <h3 id="campaignEditorTitle"></h3>
            </div>
            <div class="campaign-editor-scroll">
                <section class="campaign-editor-section">
                    <h4>${adminT("campaign", "Campaign")}</h4>
                    <div class="campaign-editor-grid">
                        <label>${adminT("campaign_name", "Campaign Name")} <input id="campaignName" type="text"></label>
                        <label>${adminT("campaign_code", "Campaign Code")} <input id="campaignCode" type="text"></label>
                        <label>${adminT("campaign_type", "Campaign Type")}
                            <select id="campaignType">
                                <option value="PROMOTION">${adminT("promotion", "Promotion")}</option>
                                <option value="NEW_GAME">${adminT("new_game", "New Game")}</option>
                                <option value="ANNOUNCEMENT">${adminT("announcement", "Announcement")}</option>
                                <option value="IMPORTANT_UPDATE">${adminT("important_update", "Important Update")}</option>
                            </select>
                        </label>
                        <label>${adminT("placement", "Placement")}
                            <select id="campaignPlacement" disabled>
                                <option value="ENTRY_POPUP">${adminT("entry_popup", "Entry Popup")}</option>
                            </select>
                        </label>
                    </div>
                </section>
                <section class="campaign-editor-section">
                    <h4>${adminT("content", "Content")}</h4>
                    <label>${adminT("title", "Title")} <input id="campaignTitle" type="text"></label>
                    <label>${adminT("body", "Body")} <textarea id="campaignBody" rows="4"></textarea></label>
                </section>
                <section class="campaign-editor-section">
                    <h4>${adminT("media", "Media")}</h4>
                    <div class="campaign-media-control">
                        <div>
                            <strong id="campaignMediaLabel"></strong>
                            <small>${adminT("campaign_media_helper", "Current campaign image")}</small>
                        </div>
                        <div class="campaign-media-actions">
                            <button id="campaignMedia" class="admin-secondary-btn" type="button">${adminT("select_campaign_image", "Select Campaign Image")}</button>
                            <button id="campaignMediaClear" class="admin-secondary-btn" type="button">${adminT("remove_image", "Remove Image")}</button>
                        </div>
                    </div>
                </section>
                <section class="campaign-editor-section">
                    <h4>${adminT("action", "Action")}</h4>
                    <div class="campaign-editor-grid">
                        <label>${adminT("cta_label", "CTA Label")} <input id="campaignCtaLabel" type="text"></label>
                        <label>${adminT("cta_target", "CTA Target")} <input id="campaignCtaTarget" type="text"></label>
                    </div>
                </section>
                <section class="campaign-editor-section">
                    <h4>${adminT("audience", "Audience")}</h4>
                    <div class="campaign-editor-grid">
                        <label>${adminT("region", "Region")}
                            <select id="campaignRegion">
                                <option value="ALL">${adminT("all_regions", "All Regions")}</option>
                                <option value="MM">${adminT("myanmar", "Myanmar")}</option>
                                <option value="TH">${adminT("thailand", "Thailand")}</option>
                            </select>
                        </label>
                        <label>${adminT("audience", "Audience")}
                            <select id="campaignAudience">
                                <option value="ALL_VISITORS">${adminT("all_visitors", "All Visitors")}</option>
                                <option value="LOGGED_IN">${adminT("logged_in_users", "Logged-in Users")}</option>
                                <option value="GUESTS">${adminT("guests", "Guests")}</option>
                            </select>
                        </label>
                        <label>${adminT("frequency", "Frequency")}
                            <select id="campaignFrequency">
                                <option value="ONCE_PER_SESSION">${adminT("once_per_session", "Once Per Session")}</option>
                                <option value="ONCE_PER_DAY">${adminT("once_per_day", "Once Per Day")}</option>
                                <option value="ONCE_EVERY_3_DAYS">${adminT("once_every_3_days", "Once Every 3 Days")}</option>
                                <option value="ONCE_PER_CAMPAIGN">${adminT("once_per_campaign", "Once Per Campaign")}</option>
                            </select>
                        </label>
                        <label>${adminT("priority", "Priority")} <input id="campaignPriority" type="number" step="1" value="0"></label>
                    </div>
                </section>
                <section class="campaign-editor-section">
                    <h4>${adminT("schedule", "Schedule")}</h4>
                    <div class="campaign-editor-grid">
                        <label>${adminT("start_date", "Start Date")} <input id="campaignStarts" type="datetime-local"></label>
                        <label>${adminT("end_date", "End Date")} <input id="campaignEnds" type="datetime-local"></label>
                    </div>
                    <label class="campaign-enabled-row"><input id="campaignEnabled" type="checkbox"> ${adminT("enabled", "Enabled")}</label>
                </section>
            </div>
            <div class="admin-action-modal-actions">
                <button id="campaignCancel" type="button">${adminT("cancel", "Cancel")}</button>
                <button id="campaignSave" type="button">${adminT("save_campaign", "Save Campaign")}</button>
            </div>
        </div>
    `;
    modal.addEventListener("click", event => {
        if (event.target === modal) modal.classList.remove("show");
    });
    document.body.appendChild(modal);
}

async function saveCampaign(existing = null) {
    if (campaignSavePending) return;

    const modal = document.getElementById("campaignEditorModal");
    const saveBtn = modal?.querySelector("#campaignSave");
    const payload = readCampaignPayload(modal, existing);
    const result = await window.AZIEL_ADMIN_ACTION_MODAL?.open?.({
        title: existing ? adminT("update_campaign", "Update Campaign") : adminT("create_campaign", "Create Campaign"),
        message: existing ? adminT("update_campaign_message", "Update this ENTRY_POPUP Campaign?") : adminT("create_campaign_message", "Create this ENTRY_POPUP Campaign?"),
        input: false,
        confirmText: adminT("save_campaign", "Save Campaign")
    });

    if (result && result.confirmed === false) return;

    campaignSavePending = true;
    try {
        window.AZIEL_UI?.button?.setLoading(saveBtn, { text: adminT("loading", "Loading") });
        const data = await adminFetch(existing
            ? `/api/admin/campaigns/${encodeURIComponent(existing.id)}`
            : "/api/admin/campaigns", {
            method: existing ? "PATCH" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (!data?.success) {
            showAdminToast?.(data?.message || adminT("campaign_save_failed", "Campaign could not be saved"), "error");
            return;
        }

        adminCampaigns = Array.isArray(data.campaigns) ? data.campaigns : [];
        renderAdminCampaigns();
        modal.classList.remove("show");
        showAdminToast?.(adminT("campaign_saved", "Campaign saved"), "success");
    } finally {
        campaignSavePending = false;
        window.AZIEL_UI?.button?.reset(saveBtn);
    }
}

function readCampaignPayload(modal, existing = null) {
    const region = modal.querySelector("#campaignRegion")?.value || "ALL";
    const payload = {
        name: modal.querySelector("#campaignName")?.value || "",
        type: modal.querySelector("#campaignType")?.value || "PROMOTION",
        placement: "ENTRY_POPUP",
        title: modal.querySelector("#campaignTitle")?.value || "",
        body: modal.querySelector("#campaignBody")?.value || "",
        mediaAssetId: modal.dataset.mediaAssetId || "",
        ctaLabel: modal.querySelector("#campaignCtaLabel")?.value || "",
        ctaTarget: modal.querySelector("#campaignCtaTarget")?.value || "",
        regions: region === "ALL" ? ["MM", "TH"] : [region],
        audience: modal.querySelector("#campaignAudience")?.value || "ALL_VISITORS",
        frequencyPolicy: modal.querySelector("#campaignFrequency")?.value || "ONCE_PER_SESSION",
        priority: modal.querySelector("#campaignPriority")?.value || 0,
        startsAt: fromCampaignDatetimeValue(modal.querySelector("#campaignStarts")?.value),
        endsAt: fromCampaignDatetimeValue(modal.querySelector("#campaignEnds")?.value),
        enabled: Boolean(modal.querySelector("#campaignEnabled")?.checked)
    };

    if (!existing) {
        payload.campaignCode = modal.querySelector("#campaignCode")?.value || "";
    }

    return payload;
}

async function toggleCampaign(campaign) {
    if (!campaign) return;

    const data = await adminFetch(`/api/admin/campaigns/${encodeURIComponent(campaign.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !campaign.enabled })
    });

    if (!data?.success) {
        showAdminToast?.(data?.message || adminT("campaign_save_failed", "Campaign could not be saved"), "error");
        return;
    }

    adminCampaigns = Array.isArray(data.campaigns) ? data.campaigns : [];
    renderAdminCampaigns();
    showAdminToast?.(adminT("campaign_saved", "Campaign saved"), "success");
}

async function removeCampaign(campaignId) {
    const result = await window.AZIEL_ADMIN_ACTION_MODAL?.open?.({
        title: adminT("remove_campaign", "Remove Campaign"),
        message: adminT("remove_campaign_message", "Remove this Campaign? Media assets and historical impression records remain."),
        input: false,
        confirmText: adminT("remove", "Remove"),
        danger: true
    });

    if (result && result.confirmed === false) return;

    const data = await adminFetch(`/api/admin/campaigns/${encodeURIComponent(campaignId)}`, {
        method: "DELETE"
    });

    if (!data?.success) {
        showAdminToast?.(data?.message || adminT("campaign_save_failed", "Campaign could not be saved"), "error");
        return;
    }

    adminCampaigns = Array.isArray(data.campaigns) ? data.campaigns : [];
    renderAdminCampaigns();
    showAdminToast?.(adminT("campaign_removed", "Campaign removed"), "success");
}

function previewCampaign(campaign) {
    if (!campaign) return;
    ensureCampaignPreviewModal();
    renderCampaignPreview(campaign);
    document.getElementById("campaignPreviewModal")?.classList.add("show");
}

function ensureCampaignPreviewModal() {
    if (document.getElementById("campaignPreviewModal")) return;

    const modal = document.createElement("div");
    modal.id = "campaignPreviewModal";
    modal.className = "campaign-popup-overlay admin-campaign-preview";
    modal.innerHTML = `
        <div class="campaign-popup-dialog" role="dialog" aria-modal="true" aria-labelledby="campaignPreviewTitle">
            <button class="campaign-popup-close" type="button" aria-label="${adminT("close", "Close")}">×</button>
        </div>
    `;
    modal.addEventListener("click", event => {
        if (event.target === modal) modal.classList.remove("show");
    });
    modal.querySelector(".campaign-popup-close")?.addEventListener("click", () => modal.classList.remove("show"));
    document.body.appendChild(modal);
}

function renderCampaignPreview(campaign) {
    const dialog = document.querySelector("#campaignPreviewModal .campaign-popup-dialog");
    if (!dialog) return;
    const imageUrl = campaign.mediaAsset?.secureUrl || campaign.mediaAsset?.url || "";
    const safeImage = imageUrl && (imageUrl.startsWith("/") || /^https?:\/\//i.test(imageUrl)) ? imageUrl : "";
    const close = dialog.querySelector(".campaign-popup-close");

    dialog.className = `campaign-popup-dialog ${safeImage ? "has-image" : "no-image"}`;
    dialog.innerHTML = "";
    if (safeImage) {
        dialog.style.setProperty("--campaign-image-url", `url("${safeImage.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}")`);
    } else {
        dialog.style.removeProperty("--campaign-image-url");
    }

    const atmosphere = document.createElement("div");
    atmosphere.className = "campaign-popup-atmosphere";
    atmosphere.setAttribute("aria-hidden", "true");

    const shade = document.createElement("div");
    shade.className = "campaign-popup-shade";
    shade.setAttribute("aria-hidden", "true");

    const visual = document.createElement("div");
    visual.className = "campaign-popup-visual";

    if (safeImage) {
        const image = document.createElement("img");
        image.className = "campaign-popup-image";
        image.src = safeImage;
        image.alt = campaign.mediaAsset?.altText || campaign.title;
        image.addEventListener("error", () => {
            image.remove();
            visual.remove();
            dialog.classList.remove("has-image");
            dialog.classList.add("no-image");
            dialog.style.removeProperty("--campaign-image-url");
        });
        visual.appendChild(image);
    }

    const content = document.createElement("div");
    content.className = "campaign-popup-content";
    const type = document.createElement("span");
    type.className = "campaign-popup-type";
    type.textContent = adminT(campaign.type.toLowerCase(), campaign.type);
    const title = document.createElement("h2");
    title.id = "campaignPreviewTitle";
    title.textContent = campaign.title;
    const body = document.createElement("p");
    body.textContent = campaign.body;
    content.append(type, title, body);

    if (campaign.ctaLabel && campaign.ctaTarget) {
        const cta = document.createElement("a");
        cta.className = "campaign-popup-cta";
        cta.href = campaign.ctaTarget;
        cta.textContent = campaign.ctaLabel;
        content.appendChild(cta);
    }

    dialog.append(atmosphere, shade, close);
    if (safeImage) dialog.appendChild(visual);
    dialog.appendChild(content);
}

function findCampaign(campaignId) {
    return adminCampaigns.find(item => item.id === campaignId) || null;
}

function campaignRegionsValue(regions = []) {
    if (!Array.isArray(regions) || regions.length !== 1) return "ALL";
    return regions[0] === "TH" ? "TH" : "MM";
}

function formatCampaignRegions(regions = []) {
    if (!Array.isArray(regions) || regions.length !== 1) return adminT("all_regions", "All Regions");
    return regions[0] === "TH" ? adminT("thailand", "Thailand") : adminT("myanmar", "Myanmar");
}

function formatCampaignSchedule(campaign = {}) {
    if (!campaign.startsAt && !campaign.endsAt) return adminT("not_scheduled", "Not scheduled");
    return `${campaign.startsAt ? new Date(campaign.startsAt).toLocaleString() : "…"} → ${campaign.endsAt ? new Date(campaign.endsAt).toLocaleString() : "…"}`;
}

function campaignStateClass(state = "") {
    if (state === "ACTIVE") return "is-ok";
    if (state === "DISABLED") return "is-muted";
    return "is-warning";
}

function toCampaignDatetimeValue(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function fromCampaignDatetimeValue(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
}

function escapeCampaignHtml(value = "") {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
