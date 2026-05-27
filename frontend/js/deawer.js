// MOBILE DRAWER

document.addEventListener("DOMContentLoaded", () => {

    const menuBtn =
        document.getElementById("mobileMenuBtn");

    const drawer =
        document.getElementById("mobileDrawer");

    const overlay =
        document.getElementById("mobileDrawerOverlay");

    if (!menuBtn || !drawer || !overlay) {
        console.log("Drawer elements missing");
        return;
    }

    function openDrawer() {
        drawer.classList.add("active");
        overlay.classList.add("active");
        document.body.style.overflow = "hidden";
    }

    function closeDrawer() {
        drawer.classList.remove("active");
        overlay.classList.remove("active");
        document.body.style.overflow = "";
    }

    menuBtn.addEventListener("click", openDrawer);

    overlay.addEventListener("click", closeDrawer);

});