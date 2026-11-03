const menuToggle = document.querySelector("#menuToggle");
const sidebar = document.querySelector("#sidebar");
const links = [...document.querySelectorAll(".nav-link")];

menuToggle?.addEventListener("click", () => {
  const open = sidebar.classList.toggle("open");
  menuToggle.setAttribute("aria-expanded", String(open));
});

links.forEach(link => link.addEventListener("click", () => {
  sidebar.classList.remove("open");
  menuToggle?.setAttribute("aria-expanded", "false");
}));

if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(entries => {
    const current = entries.filter(entry => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!current) return;
    links.forEach(link => link.classList.toggle("active", link.hash === `#${current.target.id}`));
  }, { rootMargin: "-14% 0px -72% 0px", threshold: [0, 0.25, 0.5] });
  links.map(link => document.querySelector(link.hash)).filter(Boolean).forEach(section => observer.observe(section));
}
