// ===============================
// AZIEL Explore Page JS
// Scroll reveal + counter + nav active
// ===============================

document.addEventListener("DOMContentLoaded", () => {
    initScrollReveal();
    initCounterAnimation();
    initActiveNav();
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


// ===============================
// Active Header Link
// ===============================

function initActiveNav() {
    const navLinks = document.querySelectorAll(".explore-nav a[href^='#']");
    const sections = [];

    navLinks.forEach((link) => {
        const target = document.querySelector(link.getAttribute("href"));
        if (target) sections.push({ link, target });
    });

    window.addEventListener("scroll", () => {
        let current = null;

        sections.forEach(({ link, target }) => {
            const rect = target.getBoundingClientRect();

            if (rect.top <= 160 && rect.bottom >= 160) {
                current = link;
            }
        });

        navLinks.forEach((link) => link.classList.remove("active"));

        if (current) {
            current.classList.add("active");
        }
    });
}
// ==========================
// AUTO THEME
// ==========================

const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");

function applyTheme() {

    if (prefersDark.matches) {
        document.body.classList.remove("light");
        document.body.classList.add("dark");
    } else {
        document.body.classList.remove("dark");
        document.body.classList.add("light");
    }

}

applyTheme();

// Device theme ပြောင်းတာနဲ့ realtime ပြောင်း
prefersDark.addEventListener("change", applyTheme);