const { expect } = require('@playwright/test');

const SOURCES = ['youtube', 'soundcloud', 'audius', 'jamendo', 'internet_archive'];

function createSilentWave(seconds = 2) {
  const sampleRate = 8_000;
  const channels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const dataSize = sampleRate * seconds * channels * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  buffer.writeUInt16LE(channels * bytesPerSample, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

const SILENT_WAVE = createSilentWave();

function track(source, id, title, artist = 'AWUN Artist', duration = 214) {
  const youtube = source === 'youtube';
  return {
    id: youtube ? `yt_${id}` : `${source}_${id}`,
    title,
    artist,
    duration,
    quality: youtube ? 'VIDEO' : '320',
    source,
    stream_url: youtube
      ? `https://www.youtube.com/watch?v=${id}`
      : `http://127.0.0.1:4173/__fixture__/audio/${source}/${id}.mp3`,
    download_url: null,
    thumbnail: null,
    waveform_peaks: Array.from({ length: 96 }, (_, index) => 22 + ((index * 17 + id.length * 11) % 72)),
    catalog_links: {},
    score: 90,
  };
}

const TRACKS = {
  youtube: [track('youtube', 'working-video', 'Midnight Signal'), track('youtube', 'blocked-video', 'Unavailable Signal')],
  soundcloud: [track('soundcloud', 'midnight-signal', 'Midnight Signal'), track('soundcloud', 'forest-echo', 'Forest Echo')],
  audius: [track('audius', 'midnight-signal', 'Midnight Signal'), track('audius', 'unavailable-signal', 'Unavailable Signal')],
  jamendo: [track('jamendo', 'silver-path', 'Silver Path')],
  internet_archive: [track('internet_archive', 'night-archive', 'Night Archive')],
};

function healthPayload() {
  const source_health = Object.fromEntries(SOURCES.map(source => [source, {
    status: 'healthy',
    samples: 4,
    successes: 4,
    success_rate: 1,
    average_latency_ms: 28,
    last_checked_at: '2026-09-04T12:00:00.000Z',
    last_success_at: '2026-09-04T12:00:00.000Z',
    last_error_at: null,
    last_error: null,
  }]));
  return {
    status: 'ok',
    version: '1.10.2-test',
    sources: SOURCES,
    source_health,
    regions: ['AUTO', 'CIS', 'EUROPE', 'USA', 'LATAM', 'ASIA', 'GLOBAL'],
    providers: Object.fromEntries(SOURCES.map(source => [source, { enabled: true }])),
  };
}

async function installMediaMocks(page) {
  await page.addInitScript(() => {
    const NativeDate = Date;
    const fixedNow = NativeDate.parse('2026-09-04T12:40:16.708Z');
    function FixedDate(...args) {
      if (!(this instanceof FixedDate)) return new NativeDate(fixedNow).toString();
      return new NativeDate(...(args.length ? args : [fixedNow]));
    }
    FixedDate.prototype = NativeDate.prototype;
    Object.setPrototypeOf(FixedDate, NativeDate);
    FixedDate.now = () => fixedNow;
    window.Date = FixedDate;
    const states = { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };
    class MockPlayer {
      constructor(_target, options) {
        this.options = options;
        this.videoId = options.videoId;
        this.state = states.CUED;
        this.current = 0;
        this.duration = 214;
        setTimeout(() => options.events?.onReady?.({ target: this }), 0);
      }
      destroy() { this.destroyed = true; }
      getCurrentTime() { return this.current; }
      getDuration() { return this.duration; }
      getPlayerState() { return this.state; }
      pauseVideo() { this.state = states.PAUSED; this.options.events?.onStateChange?.({ data: states.PAUSED }); }
      playVideo() {
        if (this.videoId === 'blocked-video') {
          setTimeout(() => this.options.events?.onError?.({ data: 150 }), 5);
          return;
        }
        this.state = states.PLAYING;
        setTimeout(() => this.options.events?.onStateChange?.({ data: states.PLAYING }), 5);
      }
      seekTo(value) { this.current = Number(value) || 0; }
      setVolume() {}
    }
    window.YT = { Player: MockPlayer, PlayerState: states };
    Object.defineProperty(HTMLMediaElement.prototype, 'duration', { configurable: true, get() { return 214; } });
    HTMLMediaElement.prototype.load = function load() {};
    HTMLMediaElement.prototype.play = function play() {
      Object.defineProperty(this, 'paused', { configurable: true, value: false, writable: true });
      queueMicrotask(() => this.dispatchEvent(new Event('play')));
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function pause() {
      Object.defineProperty(this, 'paused', { configurable: true, value: true, writable: true });
      queueMicrotask(() => this.dispatchEvent(new Event('pause')));
    };
  });
}

async function installApiMocks(page, options = {}) {
  const delays = options.delays || {};
  await page.route('**/health', route => route.fulfill({ json: healthPayload() }));
  await page.route('**/api/v1/track-details**', route => route.fulfill({
    json: { lyrics_source: null, synced: false, lines: [], genius_status: 'disabled', annotations: [] },
  }));
  await page.route('**/__fixture__/audio/**', route => route.fulfill({
    status: 200,
    headers: { 'content-type': 'audio/wav', 'access-control-allow-origin': '*' },
    body: SILENT_WAVE,
  }));
  await page.route('**/api/v1/search', async route => {
    const request = route.request();
    const body = request.postDataJSON();
    const requestedSources = body.sources?.length ? body.sources : ['audius'];
    const query = String(body.query || '').toLowerCase();
    const delay = Math.max(...requestedSources.map(source => delays[source] || 0));
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    const tracks = requestedSources.flatMap(source => {
      if (!query.includes('unavailable signal')) return TRACKS[source] || [];
      if (source === 'youtube') return [TRACKS.youtube[1]];
      if (source === 'audius') return [TRACKS.audius[1]];
      return [];
    });
    await route.fulfill({
      json: {
        query: body.query,
        tracks,
        total: tracks.length,
        searched_sources: requestedSources,
        region: body.region || 'AUTO',
        query_variants: [body.query],
        errors: {},
        elapsed_ms: delay || 12,
      },
    });
  });
}

async function openAwun(page, options = {}) {
  await installMediaMocks(page);
  await installApiMocks(page, options);
  await page.goto('/?lang=ru');
  await expect(page.locator('#searchInput')).toBeVisible();
  await expect(page.locator('#sources button[data-source]:not([disabled])')).toHaveCount(5);
}

async function searchFor(page, query) {
  await page.locator('#searchInput').fill(query);
  await page.locator('#searchForm').evaluate(form => form.requestSubmit());
  await expect(page.locator('#trackList .track').first()).toBeVisible();
}

module.exports = { SOURCES, TRACKS, healthPayload, installApiMocks, installMediaMocks, openAwun, searchFor };
