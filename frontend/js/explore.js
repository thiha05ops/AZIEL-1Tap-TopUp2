// ===============================
// AZIEL Explore Page JS
// Scroll reveal + counter
// ===============================

document.addEventListener("DOMContentLoaded", () => {
    initScrollReveal();
    initCounterAnimation();
});


// ===============================
// Scroll Reveal
// ===============================

function initScrollReveal() {
    const revealItems = document.querySelectorAll(
        ".section-title, .feature-card, .showcase-card, .video-card, .video-mini, .guide-card, .stat-item, .coming-content, .brand-showcase"
    );

    revealItems.forEach((item) => {
        item.classList.add("reveal-item");
    });

    const observer = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    entry.target.classList.add("show");
                }
            });
        },
        {
            threshold: 0.15
        }
    );

    revealItems.forEach((item) => observer.observe(item));
}


// ===============================
// Counter Animation
// ===============================

function initCounterAnimation() {
    const counters = document.querySelectorAll(".stat-item h3");

    const observer = new IntersectionObserver(
        (entries, obs) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;

                animateCounter(entry.target);
                obs.unobserve(entry.target);
            });
        },
        {
            threshold: 0.6
        }
    );

    counters.forEach((counter) => observer.observe(counter));
}

function animateCounter(el) {
    const text = el.textContent.trim();

    const number = parseFloat(text.replace(/[^\d.]/g, ""));
    const suffix = text.replace(/[\d.]/g, "");

    if (isNaN(number)) return;

    let start = 0;
    const duration = 1200;
    const startTime = performance.now();

    function update(now) {
        const progress = Math.min((now - startTime) / duration, 1);
        const value = Math.floor(start + (number - start) * easeOutCubic(progress));

        el.textContent = value + suffix;

        if (progress < 1) {
            requestAnimationFrame(update);
        } else {
            el.textContent = text;
        }
    }

    requestAnimationFrame(update);
}

function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
}
