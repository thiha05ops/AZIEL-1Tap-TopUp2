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