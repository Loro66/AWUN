/* A local-first home screen. Rendering never starts a catalog request. */
(() => {
  const HISTORY_KEY = 'awun-search-history-v1';
  const moods = [
    { key: 'Focus', icon: '◎', query: 'focus instrumental', style: 'focus' },
    { key: 'Calm', icon: '≈', query: 'calm acoustic', style: 'calm' },
    { key: 'Energy', icon: '↗', query: 'energetic indie electronic', style: 'energy' },
    { key: 'Night', icon: '☾', query: 'night ambient', style: 'night' },
  ];

  function create(options) {
    const { state, t, language, decodeText, safeImage, formatTime, sourceLabels, actions } = options;
    const storage = window.awunStorage;
    const $ = id => document.getElementById(id);
    const root = $('homeSections');
    const rows = new Map();
    let recentSource = [];
    let resumeTrack = null;
    let artistSignature = '', querySignature = '', moodLanguage = '';
    const stored = storage?.readJSON(HISTORY_KEY, []);
    let queries = Array.isArray(stored) ? [...new Set(stored.filter(query => typeof query === 'string').map(query => query.trim().slice(0, 200)).filter(Boolean))].slice(0, 6) : [];

    function element(tag, className, text) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text != null) node.textContent = text;
      return node;
    }

    function artwork(node, track) {
      const image = safeImage(track?.thumbnail);
      const background = image ? `url("${image}")` : '';
      if (node.style.backgroundImage !== background) node.style.backgroundImage = background;
      node.textContent = image ? '' : decodeText(track?.title || 'SV').slice(0, 2).toUpperCase();
    }

    function playFromHome(track, context = recentSource) {
      if (!track || state.pendingTrackId === track.id) return;
      if (state.active?.id === track.id) { actions.togglePlayback(); return; }
      if (!(state.queueMode === 'manual' && state.queue.length)) {
        const index = context.findIndex(item => item.id === track.id);
        actions.replaceQueue(index < 0 ? [] : context.slice(index + 1), 'context', { includeActive: true });
      }
      void actions.playTrack(track, { preserveQueue: true });
    }

    function renderTracks() {
      const visible = recentSource.slice(0, 6);
      const ids = new Set(visible.map(track => String(track.id)));
      for (const [id, entry] of rows) {
        if (!ids.has(id)) { entry.row.remove(); rows.delete(id); }
      }
      const saved = new Set(state.saved.map(track => track.id));
      visible.forEach((track, index) => {
        const id = String(track.id);
        let entry = rows.get(id);
        if (!entry) {
          const row = element('li', 'hub-track');
          row.dataset.hubTrack = id;
          const play = element('button', 'hub-track-play');
          play.type = 'button';play.dataset.hubAction = 'play';
          const cover = element('span', 'hub-track-cover');cover.setAttribute('aria-hidden', 'true');
          const copy = element('span', 'hub-track-copy');
          const title = element('strong'), artist = element('span'), meta = element('small');
          copy.append(title, artist, meta);
          const icon = element('span', 'hub-track-icon');icon.setAttribute('aria-hidden', 'true');
          play.append(cover, copy, icon);
          const save = element('button', 'hub-track-save');save.type = 'button';save.dataset.hubAction = 'save';
          row.append(play, save);
          entry = { row, play, cover, title, artist, meta, icon, save };
          rows.set(id, entry);
        }
        entry.track = track;
        artwork(entry.cover, track);
        entry.title.textContent = decodeText(track.title) || t('unknownTitle');
        entry.artist.textContent = decodeText(track.artist) || t('unknownArtist');
        entry.meta.textContent = [sourceLabels[track.source] || track.source, Number(track.duration) > 0 ? formatTime(track.duration) : ''].filter(Boolean).join(' · ');
        const isSaved = saved.has(track.id);
        entry.save.textContent = isSaved ? '♥' : '♡';
        entry.save.classList.toggle('saved', isSaved);
        entry.save.setAttribute('aria-pressed', String(isSaved));
        entry.save.setAttribute('aria-label', t(isSaved ? 'removeLibraryAria' : 'addLibrary') + ': ' + decodeText(track.title));
        const before = $('recentList').children[index];
        if (before !== entry.row) $('recentList').insertBefore(entry.row, before || null);
      });
      $('hubRecentEmpty').hidden = visible.length > 0;
      $('hubAllRecent').hidden = visible.length === 0;
      $('continueTitle').textContent = t(state.recents.length ? 'continueListening' : state.saved.length ? 'hubFromLibrary' : 'hubFirstListen');
    }

    function renderArtists() {
      const uniqueTracks = new Map([...state.recents, ...state.saved].map(track => [track.id, track]));
      const artists = new Map();
      for (const track of uniqueTracks.values()) {
        const name = decodeText(track.artist).trim();
        if (!name) continue;
        const key = name.normalize('NFKC').toLocaleLowerCase();
        const artist = artists.get(key) || { name, count: 0 };
        artist.count += 1;artists.set(key, artist);
      }
      const visible = [...artists.values()].sort((a, b) => b.count - a.count).slice(0, 3);
      const signature = JSON.stringify([language(), visible]);
      if (artistSignature === signature) return;
      artistSignature = signature;
      $('hubArtistsSection').hidden = !visible.length;
      root.classList.toggle('has-hub-artists', Boolean(visible.length));
      $('hubArtists').replaceChildren(...visible.map((artist, index) => {
        const button = element('button', 'hub-artist');button.type = 'button';button.dataset.hubQuery = artist.name;
        button.setAttribute('aria-label', t('hubFindArtist', { artist: artist.name }));
        const monogram = element('span', 'hub-artist-avatar', artist.name.slice(0, 1).toUpperCase());
        monogram.style.setProperty('--artist-index', index);monogram.setAttribute('aria-hidden', 'true');
        const copy = element('span');copy.append(element('strong', '', artist.name), element('small', '', t('hubArtistTracks', { count: artist.count })));
        const arrow = element('b', '', '↗');arrow.setAttribute('aria-hidden', 'true');
        button.append(monogram, copy, arrow);return button;
      }));
    }

    function renderQueries() {
      const signature = JSON.stringify([language(), queries]);
      if (signature === querySignature) return;
      querySignature = signature;
      $('hubSearchHistory').hidden = !queries.length;
      $('hubSearchChips').replaceChildren(...queries.map(query => {
        const button = element('button', '', query);button.type = 'button';button.dataset.hubQuery = query;
        button.title = query;return button;
      }));
    }

    function renderMoods() {
      if (moodLanguage === language()) return;
      moodLanguage = language();
      $('recommendationGrid').replaceChildren(...moods.map(mood => {
        const card = element('button', `recommendation-card hub-mood hub-mood-${mood.style}`);
        card.type = 'button';card.dataset.hubQuery = mood.query;
        const icon = element('i', 'hub-mood-icon', mood.icon);icon.setAttribute('aria-hidden', 'true');
        const title = element('strong', '', t(`hubMood${mood.key}`));
        const description = element('span', '', t(`hubMood${mood.key}Body`));
        const action = element('b', '', t('hubExplore') + ' ↗');
        card.append(icon, title, description, action);return card;
      }));
    }

    function syncPlayback() {
      if (root.hidden) return;
      for (const entry of rows.values()) {
        const active = state.active?.id === entry.track.id;
        const playing = active && state.isPlaying;
        const pending = state.pendingTrackId === entry.track.id;
        entry.row.classList.toggle('active', active);
        entry.play.setAttribute('aria-busy', String(pending));
        entry.icon.textContent = pending ? '…' : playing ? 'Ⅱ' : '▶';
        entry.play.setAttribute('aria-label', pending ? t('loadingTrack') : playing ? t('pauseAria') : t('playTrackAria', { title: decodeText(entry.track.title) }));
      }
      if (!resumeTrack) return;
      const playing = state.active?.id === resumeTrack.id && state.isPlaying;
      const pending = state.pendingTrackId === resumeTrack.id;
      $('hubResume').setAttribute('aria-busy', String(pending));
      $('hubResume').querySelector('span').textContent = pending ? '…' : playing ? 'Ⅱ' : '▶';
      $('hubResume').lastElementChild.textContent = t(pending ? 'loadingTrack' : playing ? 'pauseAria' : 'continueListening');
      $('hubResumeKicker').textContent = t(playing ? 'nowPlaying' : 'hubResumeKicker');
    }

    function render() {
      if (root.hidden) return;
      recentSource = state.recents.length ? state.recents : state.saved;
      resumeTrack = state.active || recentSource[0] || null;
      root.classList.toggle('has-resume', Boolean(resumeTrack));
      $('welcomeTitle').textContent = t(resumeTrack ? 'hubWelcomeBack' : 'hubWelcomeTitle');
      $('hubWelcomeBody').textContent = t(resumeTrack ? 'hubWelcomeBackBody' : 'hubWelcomeBody');
      $('welcomeLibraryCount').textContent = state.saved.length ? t('tracksOnDevice', { count: state.saved.length }) : t('hubLocalHint');
      $('hubResumeCard').hidden = !resumeTrack;
      $('hubWave').hidden = Boolean(resumeTrack);
      $('hubSavedCount').textContent = state.saved.length;
      $('hubRecentCount').textContent = state.recents.length;
      $('hubQueueCount').textContent = state.queue.length;
      $('hubShuffle').disabled = !state.saved.length;
      $('hubRecent').disabled = !state.recents.length;
      $('hubQueue').disabled = !state.queue.length;
      $('hubSourceCount').textContent = t(!state.diagnostics ? 'connecting' : !state.available.size ? 'hubSourcesUnavailable' : 'hubSourcesCount', { count: state.available.size });
      $('hubSources').classList.toggle('unavailable', Boolean(state.diagnostics && !state.available.size));
      if (resumeTrack) {
        artwork($('hubResumeCover'), resumeTrack);
        $('hubResumeTitle').textContent = decodeText(resumeTrack.title) || t('unknownTitle');
        $('hubResumeArtist').textContent = decodeText(resumeTrack.artist) || t('unknownArtist');
        const position = state.active?.id === resumeTrack.id && state.restoredPlayback ? state.playbackPosition : 0;
        $('hubResumeMeta').textContent = [sourceLabels[resumeTrack.source] || resumeTrack.source, position > 0 ? t('hubResumePosition', { time: formatTime(position) }) : Number(resumeTrack.duration) > 0 ? formatTime(resumeTrack.duration) : ''].filter(Boolean).join(' · ');
      }
      renderTracks();renderArtists();renderQueries();renderMoods();syncPlayback();
    }

    function rememberQuery(query) {
      const clean = String(query || '').trim().slice(0, 200);
      if (!clean) return;
      queries = [clean, ...queries.filter(value => value.toLocaleLowerCase() !== clean.toLocaleLowerCase())].slice(0, 6);
      storage?.writeJSON(HISTORY_KEY, queries, { backup: false });
    }

    root.addEventListener('click', event => {
      const query = event.target.closest('[data-hub-query]');
      if (query) { actions.search(query.dataset.hubQuery); return; }
      const button = event.target.closest('[data-hub-action]');
      if (!button) return;
      const entry = rows.get(button.closest('[data-hub-track]').dataset.hubTrack);
      if (button.dataset.hubAction === 'save') actions.toggleSave(entry.track);
      else playFromHome(entry.track);
    });
    $('hubResume').addEventListener('click', () => playFromHome(resumeTrack));
    $('hubLibrary').addEventListener('click', actions.showLibrary);
    $('hubRecent').addEventListener('click', actions.showRecent);
    $('hubAllRecent').addEventListener('click', () => state.recents.length ? actions.showRecent() : actions.showLibrary());
    $('hubQueue').addEventListener('click', actions.showQueue);
    $('hubEmptySearch').addEventListener('click', actions.focusSearch);
    $('hubSources').addEventListener('click', actions.showSources);
    ['hubWave', 'hubWaveShortcut', 'hubArtistWave'].forEach(id => $(id).addEventListener('click', actions.showWave));
    $('hubShuffle').addEventListener('click', () => {
      const shuffled = [...state.saved];
      for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const other = Math.floor(Math.random() * (index + 1));
        [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
      }
      if (!shuffled.length) return;
      actions.replaceQueue(shuffled.slice(1), 'context', { includeActive: true });
      void actions.playTrack(shuffled[0], { preserveQueue: true });
    });
    $('hubClearSearches').addEventListener('click', () => {
      queries = [];storage?.remove(HISTORY_KEY);renderQueries();
      actions.focusSearch();
    });
    return { render, syncPlayback, rememberQuery };
  }

  window.songvaleHome = { create };
})();
