/* =========================
   MOBILE DRAWER
========================= */

document.addEventListener("DOMContentLoaded", () => {
    initDrawer();
});

function initDrawer() {
    const menuBtn = document.getElementById("mobileMenuBtn");
    const drawer = document.getElementById("mobileDrawer");
    const overlay = document.getElementById("mobileDrawerOverlay");
    const closeBtn = document.getElementById("closeDrawerBtn");

    if (!menuBtn || !drawer || !overlay) return;

    function openDrawer() {
        drawer.classList.add("show");
        overlay.classList.add("show");
        document.body.style.overflow = "hidden";
    }

    function closeDrawer() {
        drawer.classList.remove("show");
        overlay.classList.remove("show");
        document.body.style.overflow = "";
    }

    menuBtn.addEventListener("click", openDrawer);
    closeBtn?.addEventListener("click", closeDrawer);
    overlay.addEventListener("click", closeDrawer);

    drawer.querySelectorAll("a").forEach(link => {
        link.addEventListener("click", closeDrawer);
    });
}