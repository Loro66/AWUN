import json
import os

import pytest

from desktop.persistence import DesktopStateStore
from desktop.single_instance import SingleInstance


def test_a_truncated_primary_recovers_the_last_good_library(tmp_path):
    path = tmp_path / 'desktop-state.json'
    store = DesktopStateStore(path)
    first = {'awun-library': '[{"id":"saved"}]', 'awun-language': 'en'}
    assert store.save_state(json.dumps(first))
    assert store.save_state(json.dumps({**first, 'awun-volume': '65'}))
    path.write_text('{"interrupted":', encoding='utf8')
    recovered = DesktopStateStore(path)
    assert json.loads(recovered.load_state()) == first
    assert recovered.desktop_storage_status()['recovered']
    assert recovered.save_state(json.dumps({**first, 'awun-volume': '70'}))
    assert json.loads(recovered.load_state())['awun-volume'] == '70'
    assert json.loads(path.with_suffix('.bak').read_text()) == first


def test_unreadable_snapshots_are_preserved_instead_of_replaced_with_defaults(tmp_path):
    path = tmp_path / 'desktop-state.json'
    path.write_text('broken snapshot', encoding='utf8')
    store = DesktopStateStore(path)
    with pytest.raises(OSError):
        store.load_state()
    assert not store.save_state('{"awun-library":"[]"}')
    assert path.read_text() == 'broken snapshot'
    path.write_text('{"awun-library":"[{\\"id\\":\\"repaired\\"}]"}', encoding='utf8')
    assert 'repaired' in store.load_state()
    assert store.save_state('{"awun-language":"en"}')


def test_a_missing_primary_can_recover_its_backup_and_keep_legacy_keys(tmp_path):
    path = tmp_path / 'desktop-state.json'
    path.with_suffix('.bak').write_text('{"awun-library":"[]","songvale-account-owner-v1":"owner-a"}', encoding='utf8')
    assert json.loads(DesktopStateStore(path).load_state()) == {'awun-library': '[]', 'songvale-account-owner-v1': 'owner-a'}


def test_rebuildable_catalogs_and_session_secrets_do_not_enter_the_snapshot(tmp_path):
    store = DesktopStateStore(tmp_path / 'desktop-state.json')
    assert store.save_state(json.dumps({'awun-library':'[]','awun-catalog-cache-v1':'cache','songvale_access':'secret'}))
    assert json.loads(store.load_state()) == {'awun-library':'[]'}
    assert not store.save_state('{"awun-library":null}')
    assert json.loads(store.load_state()) == {'awun-library':'[]'}


def test_disk_failure_keeps_the_previous_snapshot_and_removes_partial_files(tmp_path, monkeypatch):
    path = tmp_path / 'desktop-state.json'
    store = DesktopStateStore(path)
    assert store.save_state('{"awun-library":"[]"}')
    monkeypatch.setattr(os, 'fsync', lambda fd: (_ for _ in ()).throw(OSError('disk full')))
    assert not store.save_state('{"awun-language":"en"}')
    assert json.loads(path.read_text()) == {'awun-library':'[]'}
    assert not list(tmp_path.glob('*.tmp'))


@pytest.mark.skipif(os.name != 'nt', reason='Windows named mutex')
def test_only_one_process_can_own_the_desktop_profile_and_the_mutex_is_released(tmp_path):
    first, second, other = SingleInstance(tmp_path), SingleInstance(tmp_path), SingleInstance(tmp_path / 'other')
    try:
        assert first.acquire()
        assert not second.acquire()
        assert other.acquire()
        first.close()
        assert second.acquire()
    finally:
        first.close(); second.close(); other.close()


def test_an_old_page_or_delayed_snapshot_cannot_overwrite_a_new_page(tmp_path):
    store = DesktopStateStore(tmp_path / 'desktop-state.json')
    first = store.desktop_state_session()
    assert store.save_state('{"awun-library":"first"}', first, 1)
    second = store.desktop_state_session()
    assert store.save_state('{"awun-library":"newest"}', second, 2)
    assert not store.save_state('{"awun-library":"old page"}', first, 100)
    assert not store.save_state('{"awun-library":"out of order"}', second, 1)
    assert not store.save_state('{"awun-library":"legacy writer"}')
    assert json.loads(store.load_state()) == {'awun-library': 'newest'}
