(function attachPlayerCore(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.awunPlayerCore = api;
})(typeof globalThis === 'object' ? globalThis : this, function createPlayerCore() {
  const MAX_QUEUE_LENGTH = 250;
  const NOISE_WORDS = new Set([
    'audio', 'clip', 'explicit', 'hd', 'hq', 'lyrics', 'lyric', 'music',
    'official', 'records', 'remaster', 'remastered', 'topic', 'video',
    'visualizer'
  ]);

  function normalizeText(value) {
    return String(value || '')
      .normalize('NFKD')
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  }

  function meaningfulTokens(value) {
    return normalizeText(value)
      .split(/\s+/)
      .filter(token => token && !NOISE_WORDS.has(token));
  }

  function tokenSimilarity(left, right) {
    const leftTokens = new Set(meaningfulTokens(left));
    const rightTokens = new Set(meaningfulTokens(right));
    if (!leftTokens.size || !rightTokens.size) return 0;
    let shared = 0;
    leftTokens.forEach(token => {
      if (rightTokens.has(token)) shared += 1;
    });
    return (2 * shared) / (leftTokens.size + rightTokens.size);
  }

  function tokenCoverage(needle, haystack) {
    const wanted = new Set(meaningfulTokens(needle));
    const available = new Set(meaningfulTokens(haystack));
    if (!wanted.size || !available.size) return 0;
    let shared = 0;
    wanted.forEach(token => {
      if (available.has(token)) shared += 1;
    });
    return shared / wanted.size;
  }

  function durationSimilarity(left, right) {
    const first = Math.max(0, Number(left) || 0);
    const second = Math.max(0, Number(right) || 0);
    if (!first || !second) return 0.65;
    const difference = Math.abs(first - second);
    const tolerance = Math.max(12, Math.round(Math.max(first, second) * 0.08));
    if (difference <= tolerance) return 1;
    if (difference >= Math.max(50, tolerance * 3)) return 0;
    return Math.max(0, 1 - difference / Math.max(50, tolerance * 3));
  }

  function alternativeScore(origin, candidate) {
    if (!origin || !candidate || !candidate.stream_url) return 0;
    const combinedOrigin = `${origin.artist || ''} ${origin.title || ''}`;
    const combinedCandidate = `${candidate.artist || ''} ${candidate.title || ''}`;
    const title = Math.max(
      tokenSimilarity(origin.title, candidate.title),
      tokenCoverage(origin.title, candidate.title)
    );
    const artist = Math.max(
      tokenSimilarity(origin.artist, candidate.artist),
      tokenCoverage(origin.artist, candidate.artist),
      tokenCoverage(origin.artist, combinedCandidate)
    );
    const combined = tokenSimilarity(combinedOrigin, combinedCandidate);
    const duration = durationSimilarity(origin.duration, candidate.duration);
    if (title < 0.78 || (artist < 0.55 && combined < 0.78) || duration < 0.45) return 0;
    return Math.round((title * 50 + artist * 25 + combined * 15 + duration * 10) * 1000) / 1000;
  }

  function rankAlternatives(origin, candidates, triedSources) {
    const blocked = triedSources instanceof Set ? triedSources : new Set(triedSources || []);
    return (Array.isArray(candidates) ? candidates : [])
      .filter(candidate => candidate && candidate.id && !blocked.has(candidate.source))
      .map(candidate => ({ candidate, score: alternativeScore(origin, candidate) }))
      .filter(entry => entry.score >= 74)
      .sort((left, right) => right.score - left.score || Number(right.candidate.score || 0) - Number(left.candidate.score || 0))
      .map(entry => entry.candidate);
  }

  function uniqueTracks(items) {
    const seen = new Set();
    const output = [];
    for (const track of Array.isArray(items) ? items : []) {
      if (!track || !track.id || seen.has(track.id)) continue;
      seen.add(track.id);
      output.push(track);
      if (output.length >= MAX_QUEUE_LENGTH) break;
    }
    return output;
  }

  function enqueue(queue, track, position) {
    if (!track || !track.id) return uniqueTracks(queue);
    const items = uniqueTracks(queue).filter(item => item.id !== track.id);
    if (position === 'next') items.unshift(track);
    else items.push(track);
    return items.slice(0, MAX_QUEUE_LENGTH);
  }

  function remove(queue, trackId) {
    return uniqueTracks(queue).filter(track => track.id !== trackId);
  }

  function move(queue, fromIndex, toIndex) {
    const items = uniqueTracks(queue);
    const from = Number(fromIndex);
    const to = Number(toIndex);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= items.length || to >= items.length || from === to) return items;
    const [track] = items.splice(from, 1);
    items.splice(to, 0, track);
    return items;
  }

  return {
    MAX_QUEUE_LENGTH,
    alternativeScore,
    enqueue,
    move,
    normalizeText,
    rankAlternatives,
    remove,
    uniqueTracks
  };
});
