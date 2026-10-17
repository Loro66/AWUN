(() => {
  const app = window.awunApp, engine = window.songvalePreferences;
  if (!app || !engine) return;
  const { state } = app, storage = window.awunStorage;
  const $ = id => document.getElementById(id), t = (key, values) => window.awunI18n.t(key, values);
  const dimensionTitle = key => t(`rating_${key}`);
  const owner = () => storage.readText('songvale-account-owner-v1', '') || 'guest';
  const store = engine.createStore({ read: storage.readJSON, write: storage.writeJSON, owner, changed: () => {
    document.dispatchEvent(new CustomEvent('songvale:preferences')); app.render();
  } });
  let selectionCache = new Map(), cacheRevision = -1, cacheInventory, tabsSignature = '', editorSignature = '', uiOwner = '', dialogOwner = '', ratingTrack = null;
  function profile() { return store.get(); }
  function title(id) { const item = profile().libraries.find(entry => entry.id === id); return item ? item.titleKey ? t(item.titleKey) : item.name : ''; }
  function tracks(id, inventory = app.libraryInventory()) {
    const revision = store.revision();
    if (cacheRevision !== revision || cacheInventory !== inventory) { selectionCache.clear(); cacheRevision = revision; cacheInventory = inventory; }
    if (!selectionCache.has(id)) {
      const item = profile().libraries.find(entry => entry.id === id);
      selectionCache.set(id, item ? engine.select(item, inventory, profile()) : []);
    }
    return selectionCache.get(id);
  }
  function values(track) { return profile().ratings[engine.recordingKey(track)]?.values || {}; }
  function score(track) { return engine.score(values(track), profile().settings.weights); }
  window.songvaleTaste = { store, profile, title, tracks, values, score };

  function option(value, label) { const node = document.createElement('option'); node.value = value; node.textContent = label; return node; }
  for (const key of engine.dimensions) {
    const label = document.createElement('label'), name = document.createElement('span'), select = document.createElement('select');
    name.dataset.ratingLabel = key; select.id = `rating-${key}`; select.name = key;
    select.append(option('', ''), ...[1, 2, 3, 4, 5].map(value => option(String(value), String(value)))); label.append(name, select); $('ratingDimensions').append(label);
    const weightLabel = document.createElement('label'), weightName = document.createElement('span'), input = document.createElement('input'), output = document.createElement('output');
    weightName.dataset.ratingLabel = key; input.type = 'range'; input.min = '0'; input.max = '5'; input.step = '1'; input.id = `weight-${key}`; output.htmlFor = input.id;
    input.addEventListener('input', () => { output.value = input.value; });
    input.addEventListener('change', () => {
      const weights = Object.fromEntries(engine.dimensions.map(dimension => [dimension, Number($(`weight-${dimension}`).value)]));
      if (!Object.values(weights).some(Boolean)) { $('preferenceStatus').textContent = t('preferenceWeightRequired'); render(); return; }
      $('preferenceStatus').textContent = store.updateSettings({ weights }) ? t('preferenceSaved') : t('storageSaveFailed');
    });
    weightLabel.append(weightName, input, output); $('preferenceWeights').append(weightLabel);
  }

  function render() {
    const current = profile(), language = document.documentElement.lang, inventory = app.libraryInventory();
    if (uiOwner !== owner()) {
      uiOwner = owner(); $('preferenceRuleEditor').value = ''; fillEditor();
      if ($('ratingDialog').open && dialogOwner !== uiOwner) $('ratingDialog').close();
      if (!current.libraries.some(item => item.id === state.activePreferenceLibrary)) state.activePreferenceLibrary = null;
    }
    const signature = JSON.stringify([language, state.activePreferenceLibrary, current.libraries.map(item => [item.id, title(item.id), tracks(item.id, inventory).length])]);
    if (signature !== tabsSignature) {
      tabsSignature = signature;
      const focused = document.activeElement?.dataset.preferenceLibrary;
      $('preferenceTabs').replaceChildren(...current.libraries.map(item => {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'playlist-tab'; button.dataset.preferenceLibrary = item.id;
        button.textContent = `${title(item.id)} · ${tracks(item.id, inventory).length}`;
        button.setAttribute('aria-pressed', String(state.activePreferenceLibrary === item.id));
        button.onclick = () => { state.activePreferenceLibrary = item.id; state.activeSmartPlaylist = null; state.activePlaylistId = null; state.visibleTrackLimit = 60; app.render(); };
        return button;
      }));
      if (focused) [...$('preferenceTabs').children].find(node => node.dataset.preferenceLibrary === focused)?.focus();
    }
    const editors = JSON.stringify([language, current.libraries.map(item => [item.id, title(item.id)])]);
    if (editorSignature !== editors) {
      editorSignature = editors;
      const editing = $('preferenceRuleEditor').value;
      $('preferenceRuleEditor').replaceChildren(option('', t('preferenceNew')), ...current.libraries.map(item => option(item.id, title(item.id))));
      $('preferenceRuleEditor').value = current.libraries.some(item => item.id === editing) ? editing : '';
      $('flowLibrary').replaceChildren(option('', t('flowAllLibrary')), ...current.libraries.map(item => option(item.id, title(item.id))));
      const metric = $('preferenceMetric').value;
      $('preferenceMetric').replaceChildren(option('weighted', t('ratingWeighted')), ...engine.dimensions.map(key => option(key, dimensionTitle(key))));
      $('preferenceMetric').value = metric || 'weighted';
    }
    for (const key of engine.dimensions) {
      document.querySelectorAll(`[data-rating-label="${key}"]`).forEach(node => { node.textContent = dimensionTitle(key); });
      $(`rating-${key}`).options[0].textContent = t('ratingUnrated');
      const input = $(`weight-${key}`); input.value = current.settings.weights[key]; input.nextElementSibling.value = input.value;
    }
    $('flowLibrary').value = current.settings.libraryId; $('flowArtistGap').value = current.settings.artistGap; $('flowContinuous').checked = current.settings.continuous;
    $('flowRate').disabled = !state.active;
    $('preferenceDelete').hidden = !$('preferenceRuleEditor').value;
  }
  function fillEditor() {
    const item = profile().libraries.find(entry => entry.id === $('preferenceRuleEditor').value);
    $('preferenceName').value = item ? title(item.id) : '';
    $('preferenceMetric').value = item?.metric || 'weighted'; $('preferenceMinimum').value = item?.minScore ?? 4;
    $('preferenceArtists').value = item?.artists.join(', ') || ''; $('preferenceSource').value = item?.sources[0] || '';
    $('preferenceUnrated').checked = item?.includeUnrated || false; $('preferenceDelete').hidden = !item;
  }
  $('preferenceRuleEditor').addEventListener('change', fillEditor);
  $('preferenceRuleForm').addEventListener('submit', event => {
    event.preventDefault();
    const id = $('preferenceRuleEditor').value || globalThis.crypto?.randomUUID?.() || `taste-${Date.now()}`;
    const saved = store.saveRule({ id, name: $('preferenceName').value, metric: $('preferenceMetric').value, minScore: Number($('preferenceMinimum').value), artists: $('preferenceArtists').value.split(','), sources: $('preferenceSource').value ? [$('preferenceSource').value] : [], includeUnrated: $('preferenceUnrated').checked });
    $('preferenceStatus').textContent = t(saved ? 'preferenceSaved' : profile().libraries.length >= 20 ? 'preferenceLimit' : 'storageSaveFailed');
    if (saved) { $('preferenceRuleEditor').value = id; fillEditor(); }
  });
  $('preferenceDelete').addEventListener('click', () => {
    const id = $('preferenceRuleEditor').value;
    if (!id) return;
    const selected = state.activePreferenceLibrary;
    if (selected === id) state.activePreferenceLibrary = null;
    if (!store.deleteRule(id)) { state.activePreferenceLibrary = selected; $('preferenceStatus').textContent = t('storageSaveFailed'); return; }
    $('preferenceRuleEditor').value = ''; fillEditor(); $('preferenceStatus').textContent = t('preferenceDeleted');
  });
  ['flowLibrary', 'flowArtistGap', 'flowContinuous'].forEach(id => $(id).addEventListener('change', () => {
    if (!store.updateSettings({ libraryId: $('flowLibrary').value, artistGap: Number($('flowArtistGap').value), continuous: $('flowContinuous').checked })) app.setMessage(t('storageSaveFailed'), 'error');
  }));

  function formValues() { return Object.fromEntries(engine.dimensions.filter(key => $(`rating-${key}`).value).map(key => [key, Number($(`rating-${key}`).value)])); }
  function showScore() { const value = engine.score(formValues(), profile().settings.weights); $('ratingScore').textContent = t(value == null ? 'ratingNoScore' : 'ratingSummary', { score: value?.toFixed(1) }); }
  function openRating(track) {
    if (!track?.id) return;
    ratingTrack = track; dialogOwner = owner();
    $('ratingTrack').textContent = `${app.decodeText(track.artist)} — ${app.decodeText(track.title)}`;
    const previous = values(track);
    for (const key of engine.dimensions) $(`rating-${key}`).value = previous[key] || '';
    $('ratingSaveTrack').checked = true; $('ratingSaveTrack').disabled = state.saved.some(item => engine.trackKey(item) === engine.trackKey(track));
    $('ratingStatus').textContent = ''; render(); showScore(); $('ratingDialog').showModal();
  }
  document.addEventListener('songvale:rate', event => openRating(event.detail?.track));
  $('flowRate').addEventListener('click', () => openRating(state.active));
  $('ratingClose').addEventListener('click', () => $('ratingDialog').close());
  $('ratingDimensions').addEventListener('change', showScore);
  $('ratingForm').addEventListener('submit', event => {
    event.preventDefault();
    if (dialogOwner !== owner()) { $('ratingDialog').close(); return; }
    if (!store.rate(ratingTrack, formValues())) { $('ratingStatus').textContent = t('storageSaveFailed'); return; }
    if ($('ratingSaveTrack').checked && !state.saved.some(track => engine.trackKey(track) === engine.trackKey(ratingTrack))) {
      app.toggleSave(ratingTrack);
      if (!state.saved.some(track => engine.trackKey(track) === engine.trackKey(ratingTrack))) { $('ratingStatus').textContent = t('ratingLibraryFailed'); return; }
    }
    $('ratingDialog').close(); app.setMessage(t('ratingSaved'), 'notice');
  });
  $('ratingClear').addEventListener('click', () => {
    if (dialogOwner !== owner()) { $('ratingDialog').close(); return; }
    if (!store.rate(ratingTrack, {})) { $('ratingStatus').textContent = t('storageSaveFailed'); return; }
    for (const key of engine.dimensions) $(`rating-${key}`).value = '';
    showScore(); $('ratingStatus').textContent = t('ratingCleared');
  });
  document.addEventListener('awun:render', render); document.addEventListener('awun:language', render);
  window.addEventListener('awun:storage-restored', () => store.reload());
  window.addEventListener('storage', event => { if (event.key === engine.KEY || event.key === null) store.reload(); });
  render(); app.render();
})();
