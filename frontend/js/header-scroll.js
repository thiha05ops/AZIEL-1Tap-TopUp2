// frontend/js/header-scroll.js

(function () {
    function bindHeaderScroll() {
        // Canonical mobile header scroll ownership lives in frontend/js/header.js.
        // This file remains as a compatibility shim for older pages that still load it.
        window.__azielHeaderScrollShimLoaded = true;
    }

    document.addEventListener("DOMContentLoaded", bindHeaderScroll);
    window.addEventListener("aziel:headerLoaded", bindHeaderScroll);
})();
