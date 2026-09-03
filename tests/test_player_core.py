import json
from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]


def run_core(expression: str) -> object:
    script = (
        "const core=require('./frontend/player-core.js');"
        f"const result=({expression});"
        "process.stdout.write(JSON.stringify(result));"
    )
    completed = subprocess.run(
        ["node", "-e", script],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(completed.stdout)


def test_queue_supports_next_end_remove_and_reorder() -> None:
    result = run_core(
        "(()=>{"
        "const a={id:'a'},b={id:'b'},c={id:'c'};"
        "let queue=core.enqueue([],a,'end');"
        "queue=core.enqueue(queue,b,'end');"
        "queue=core.enqueue(queue,c,'next');"
        "queue=core.move(queue,0,2);"
        "queue=core.remove(queue,'a');"
        "return queue.map(track=>track.id)"
        "})()"
    )
    assert result == ["b", "c"]


def test_queue_deduplicates_tracks_and_caps_payload() -> None:
    result = run_core(
        "(()=>{const tracks=Array.from({length:300},(_,index)=>({id:String(index%260)}));"
        "return {length:core.uniqueTracks(tracks).length,unique:new Set(core.uniqueTracks(tracks).map(track=>track.id)).size}})()"
    )
    assert result == {"length": 250, "unique": 250}


def test_waveform_is_deterministic_varied_and_svg_masked() -> None:
    result = run_core(
        "(()=>{const first=core.waveformBars('track-42',96);"
        "const second=core.waveformBars('track-42',96);"
        "return {same:JSON.stringify(first)===JSON.stringify(second),length:first.length,"
        "minimum:Math.min(...first),maximum:Math.max(...first),unique:new Set(first).size,"
        "mask:core.waveformMask('track-42',96)}})()"
    )
    assert result["same"] is True
    assert result["length"] == 96
    assert 20 <= result["minimum"] < result["maximum"] <= 96
    assert result["unique"] >= 12
    assert result["mask"].startswith('url("data:image/svg+xml,')
    assert "%3Crect" in result["mask"]


def test_failover_ranks_only_matching_untried_sources() -> None:
    result = run_core(
        "(()=>{"
        "const origin={title:'Midnight Rituals',artist:'Solace',duration:268};"
        "const candidates=["
        "{id:'wrong',title:'Morning News',artist:'Station',duration:268,source:'youtube',stream_url:'x',score:100},"
        "{id:'yt',title:'Midnight Rituals official audio',artist:'Solace',duration:269,source:'youtube',stream_url:'x',score:80},"
        "{id:'au',title:'Midnight Rituals',artist:'Solace',duration:267,source:'audius',stream_url:'x',score:70}];"
        "return core.rankAlternatives(origin,candidates,new Set(['youtube'])).map(track=>track.id)"
        "})()"
    )
    assert result == ["au"]


def test_failover_accepts_common_youtube_channel_metadata() -> None:
    result = run_core(
        "(()=>{"
        "const origin={title:'Enjoy the Silence',artist:'Depeche Mode',duration:250};"
        "const candidates=["
        "{id:'yt',title:'Depeche Mode - Enjoy the Silence (Official Video)',artist:'Depeche Mode - Topic',duration:251,source:'youtube',stream_url:'x'},"
        "{id:'wrong',title:'Enjoy the Silence',artist:'Cover Station',duration:251,source:'audius',stream_url:'x'}];"
        "return core.rankAlternatives(origin,candidates,[]).map(track=>track.id)"
        "})()"
    )
    assert result == ["yt"]


def test_app_wires_persistent_queue_and_cross_source_recovery() -> None:
    app = (ROOT / "frontend" / "app.js").read_text(encoding="utf-8")
    html = (ROOT / "frontend" / "index.html").read_text(encoding="utf-8")

    assert "awun-queue-v1" in app
    assert "playerCore.enqueue" in app and "playerCore.move" in app and "playerCore.remove" in app
    assert "rankAlternatives" in app and "failedSources" in app
    assert "resumeAt" in app and "sourceSwitched" in app
    assert "refreshTrackLink" in app and "sameSourceRefreshGeneration" in app
    assert 'src="/static/player-core.js?v=__AWUN_VERSION__"' in html
