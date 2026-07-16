document.addEventListener("DOMContentLoaded", () => {
    const items = Array.from(document.querySelectorAll(".faq-item"));
    const search = document.getElementById("faqSearch");
    const noResults = document.getElementById("faqNoResults");

    items.forEach(item => {
        const button = item.querySelector(".faq-question");
        const answer = button ? document.getElementById(button.getAttribute("aria-controls")) : null;
        if (!button || !answer) return;

        const toggle = () => {
            const isOpen = button.getAttribute("aria-expanded") === "true";
            button.setAttribute("aria-expanded", String(!isOpen));
            answer.hidden = isOpen;
            item.classList.toggle("active", !isOpen);
        };

        button.addEventListener("click", toggle);
        button.addEventListener("keydown", event => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            toggle();
        });
    });

    search?.addEventListener("input", () => {
        const keyword = search.value.toLowerCase().trim();
        let visibleCount = 0;

        items.forEach(item => {
            const text = item.innerText.toLowerCase();
            const isVisible = text.includes(keyword);
            item.hidden = !isVisible;
            if (isVisible) visibleCount += 1;
        });

        if (noResults) {
            noResults.hidden = visibleCount > 0;
        }
    });
});
