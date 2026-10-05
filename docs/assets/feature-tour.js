(() => {
  const panels = [...document.querySelectorAll('.feature-tour-panel')];
  const links = [...document.querySelectorAll('.feature-tour-step')];
  if (!panels.length) return;
  document.querySelector('.feature-tour').classList.add('feature-tour-enhanced');
  let pending = false;
  function update() {
    pending = false;
    const target = innerHeight * .4;
    // Track the last panel whose top has reached the reading line.
    let current = 0;
    panels.forEach((panel, index) => {
      if (panel.getBoundingClientRect().top <= target) current = index;
    });
    links.forEach((link, index) => link.setAttribute('aria-current', String(index === current)));
  }
  function schedule() {
    if (!pending) { pending = true; requestAnimationFrame(update); }
  }
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', schedule);
  update();
})();
