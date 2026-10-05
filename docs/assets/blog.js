// Keep the complete catalog visible without JavaScript.
const filters = document.querySelector('.filter-bar');
const cards = [...document.querySelectorAll('.article-grid .article-card')];
if (filters) {
  filters.hidden = false;
  filters.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-filter]');
    if (!button) return;
    const topic = button.dataset.filter;
    for (const filter of filters.querySelectorAll('button')) {
      filter.setAttribute('aria-pressed', String(filter === button));
    }
    let visible = 0;
    for (const card of cards) {
      card.hidden = topic !== 'all' && card.dataset.category !== topic;
      if (!card.hidden) visible += 1;
    }
    filters.querySelector('.article-count').textContent = `${visible} ${visible === 1 ? 'guide' : 'guides'}`;
  });
}
