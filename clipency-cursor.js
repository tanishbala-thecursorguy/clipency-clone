(function () {
  if (window.ClipencyCursorInstalled) return;
  window.ClipencyCursorInstalled = true;

  const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
  const smallScreen = window.matchMedia("(max-width: 760px)").matches;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (coarsePointer || smallScreen || reducedMotion) return;

  function createCursorElement(className) {
    let element = document.querySelector("." + className);

    if (!element) {
      element = document.createElement("div");
      element.className = className;
      document.body.appendChild(element);
    }

    return element;
  }

  const dot = createCursorElement("cx-universal-cursor-dot");
  const ring = createCursorElement("cx-universal-cursor-ring");
  const glow = createCursorElement("cx-universal-cursor-glow");

  let mouseX = window.innerWidth / 2;
  let mouseY = window.innerHeight / 2;
  let ringX = mouseX;
  let ringY = mouseY;
  let glowX = mouseX;
  let glowY = mouseY;

  document.body.classList.add("cx-cursor-enabled");

  function move() {
    ringX += (mouseX - ringX) * 0.18;
    ringY += (mouseY - ringY) * 0.18;

    glowX += (mouseX - glowX) * 0.08;
    glowY += (mouseY - glowY) * 0.08;

    dot.style.transform = `translate(${mouseX}px, ${mouseY}px) translate(-50%, -50%)`;
    ring.style.transform = `translate(${ringX}px, ${ringY}px) translate(-50%, -50%)`;
    glow.style.transform = `translate(${glowX}px, ${glowY}px) translate(-50%, -50%)`;

    requestAnimationFrame(move);
  }

  window.addEventListener("mousemove", (event) => {
    mouseX = event.clientX;
    mouseY = event.clientY;
    document.body.classList.add("cx-cursor-ready");
  }, { passive: true });

  document.addEventListener("mousedown", () => {
    document.body.classList.add("cx-cursor-pressing");
  });

  document.addEventListener("mouseup", () => {
    document.body.classList.remove("cx-cursor-pressing");
  });

  document.addEventListener("mouseover", (event) => {
    const hoverTarget = event.target.closest(
      "a, button, [role='button'], .workspace-card, .admin-panel, .review-card, .team-card, .system-card, .testimonial-card, .contact-form, .metric-tile, .staff-stat, .campaign-card, .profile-card, .stat-card"
    );

    const textTarget = event.target.closest("input, textarea, select, [contenteditable='true']");

    document.body.classList.toggle("cx-cursor-hover", Boolean(hoverTarget));
    document.body.classList.toggle("cx-cursor-text", Boolean(textTarget));
  });

  document.addEventListener("mouseout", (event) => {
    const leavingInteractive = event.target.closest(
      "a, button, [role='button'], input, textarea, select, [contenteditable='true'], .workspace-card, .admin-panel, .review-card, .team-card, .system-card, .testimonial-card, .contact-form, .metric-tile, .staff-stat, .campaign-card, .profile-card, .stat-card"
    );

    if (leavingInteractive) {
      document.body.classList.remove("cx-cursor-hover");
      document.body.classList.remove("cx-cursor-text");
    }
  });

  move();
})();
