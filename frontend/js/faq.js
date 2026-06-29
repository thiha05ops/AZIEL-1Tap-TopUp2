document.addEventListener("DOMContentLoaded", () => {
    const items = document.querySelectorAll(".faq-item");
    const search = document.getElementById("faqSearch");

    items.forEach(item => {
        item.querySelector(".faq-question")?.addEventListener("click", () => {
            item.classList.toggle("active");
        });
    });

    search?.addEventListener("input", () => {
        const keyword = search.value.toLowerCase().trim();

        items.forEach(item => {
            const text = item.innerText.toLowerCase();
            item.style.display = text.includes(keyword) ? "" : "none";
        });
    });
});