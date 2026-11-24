;(() => {
  try {
    const section = 'section:has(#thread-details-servers-heading)';
    function identify(row) {
      const detail = row.querySelector('button > span > span:nth-child(2)');
      if (!detail) return;
      const process = detail.textContent.split(' · ').pop().trim().toLowerCase();
      detail.dataset.olyServerRuntime = process;
    }
    globalThis.__olyCore?.onUiMount(nodes => {
      for (const el of nodes) {
        const row = el.closest('li');
        if (row?.closest(section)) identify(row);
        for (const item of el.querySelectorAll('li')) {
          if (item.closest(section)) identify(item);
        }
      }
    });
  } catch (e) { console.warn('oly servers', e); }
})();
