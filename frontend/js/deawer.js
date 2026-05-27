document.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("mobileMenuBtn");
    const drawer = document.getElementById("mobileDrawer");
    const overlay = document.getElementById("mobileDrawerOverlay");

    if (!btn || !drawer || !overlay) return;

    function openDrawer() {
        drawer.classList.add("show");
        overlay.classList.add("show");
        document.body.classList.add("drawer-open");
    }

    function closeDrawer() {
        drawer.classList.remove("show");
        overlay.classList.remove("show");
        document.body.classList.remove("drawer-open");
    }

    btn.addEventListener("click", openDrawer);
    overlay.addEventListener("click", closeDrawer);

    drawer.querySelectorAll("a").forEach(link => {
        link.addEventListener("click", closeDrawer);
    });
});