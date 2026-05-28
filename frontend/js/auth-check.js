const protectedPages = [
    "mlbb.html",
    "pubg.html",
    "hok.html",
    "freefire.html",
    "account.html",
    "tracking.html",
    "notifications.html"
];

const currentPage =
    window.location.pathname.split("/").pop();

const isLogin =
    localStorage.getItem("isLogin");

if (
    protectedPages.includes(currentPage)
    && !isLogin
) {
    window.location.href = "login.html";
}
document.addEventListener("click", e => {
    const link = e.target.closest("a");
    if (!link) return;

    const href = link.getAttribute("href");
    if (!href) return;

    if (href.startsWith("#")) return;

    const url = new URL(href, window.location.href);

    if (url.origin === window.location.origin) {
        e.preventDefault();
        window.location.href = url.pathname + url.search + url.hash;
    }
});