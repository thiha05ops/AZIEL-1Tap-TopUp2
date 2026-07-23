(function () {
    function bootKernel() {
        window.AZIELOS?.boot?.({ allowDegraded: true }).catch(error => {
            console.warn("[AZIEL OS] Kernel boot degraded", {
                code: error?.code || "KERNEL_BOOT_ERROR",
                message: error?.message || "Kernel boot failed"
            });
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", bootKernel, { once: true });
    } else {
        bootKernel();
    }
})();
