document.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("mobileMenuBtn");
    const drawer = document.getElementById("mobileDrawer");
    const overlay = document.getElementById("mobileDrawerOverlay");

    if (!btn || !drawer || !overlay) {
        console.log("Drawer missing", { btn, drawer, overlay });
        return;
    }

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

    btn.onclick = openDrawer;
    overlay.onclick = closeDrawer;

    drawer.querySelectorAll("a").forEach(a => {
        a.onclick = closeDrawer;
    });
});