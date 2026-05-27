document.addEventListener("click", e => {
    const link = e.target.closest("a");

    if (!link) return;

    const href = link.getAttribute("href");

    if (!href) return;

    if (
        href.startsWith("http") ||
        href.startsWith("https") ||
        href.startsWith("//")
    ) {
        return;
    }

    if (
        href.startsWith("#") ||
        href.startsWith("mailto:") ||
        href.startsWith("tel:")
    ) {
        return;
    }

    e.preventDefault();

    window.location.href = href;
});