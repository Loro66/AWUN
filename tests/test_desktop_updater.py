import hashlib
import io
import json

import pytest

from desktop.updater import DesktopUpdater, INSTALLER_NAME, RELEASE_API, RELEASE_PREFIX, installer_manifest, validate_url, version_parts


DATA = b'MZ' + b'official test installer' * 10
HASH = hashlib.sha256(DATA).hexdigest()


def release(version='2.5.18'):
    base = f'{RELEASE_PREFIX}v{version}/'
    return {'tag_name': f'v{version}', 'draft': False, 'prerelease': False, 'assets': [
        {'name': INSTALLER_NAME, 'browser_download_url': base + INSTALLER_NAME, 'size': len(DATA), 'digest': 'sha256:' + HASH},
        {'name': INSTALLER_NAME + '.sha256', 'browser_download_url': base + INSTALLER_NAME + '.sha256'},
    ]}


def fixture_request(payload, binary=DATA, checksum=None):
    def request(url):
        if url == RELEASE_API:
            return io.BytesIO(json.dumps(payload).encode())
        if url.endswith('.sha256'):
            return io.BytesIO((checksum or f'{HASH} *{INSTALLER_NAME}\n').encode())
        return io.BytesIO(binary)
    return request


def finish_download(updater):
    assert updater.start()
    updater._thread.join(3)
    assert not updater._thread.is_alive()


def test_installer_uses_only_a_new_stable_official_release():
    assert installer_manifest(release('2.5.17'), '2.5.17') is None
    assert installer_manifest(release('2.5.16'), '2.5.17') is None
    assert installer_manifest(release(), '2.5.17')['version'] == '2.5.18'
    spoofed = release()
    spoofed['assets'][0]['browser_download_url'] = 'https://example.com/setup.exe'
    with pytest.raises(ValueError):
        installer_manifest(spoofed, '2.5.17')
    with pytest.raises(ValueError):
        version_parts('2.5.18; arbitrary command')
    with pytest.raises(ValueError):
        validate_url('http://github.com/Loro66/AWUN/releases')
    with pytest.raises(ValueError):
        validate_url('https://github.com.attacker.invalid/setup.exe')


def test_verified_installer_is_ready_then_launched_without_shell():
    launches = []
    updater = DesktopUpdater('2.5.17', launch=lambda *args, **kwargs: launches.append((args, kwargs)), request=fixture_request(release()))
    try:
        finish_download(updater)
        assert updater.status()['stage'] == 'ready'
        assert updater.start() is False
        assert updater.install()
        args, kwargs = launches[0]
        assert args[0][0].endswith(INSTALLER_NAME)
        assert '/SONGVALEUPDATE=1' in args[0]
        assert kwargs == {'close_fds': True}
        assert updater.install() is False
    finally:
        updater._cleanup()


@pytest.mark.parametrize('binary,checksum', [(b'MZcorrupted', None), (DATA, '0'*64 + ' *' + INSTALLER_NAME), (DATA, 'invalid checksum')])
def test_corrupt_or_truncated_download_does_not_launch_or_replace_current_version(binary, checksum):
    launches = []
    updater = DesktopUpdater('2.5.17', launch=lambda *args, **kwargs: launches.append(args), request=fixture_request(release(),binary,checksum))
    finish_download(updater)
    assert updater.status()['stage'] == 'error'
    assert not updater.install() and not launches
    assert updater._installer is None


def test_installer_is_reverified_before_execution():
    updater = DesktopUpdater('2.5.17', launch=lambda *args, **kwargs: pytest.fail('Tampered executable launched'), request=fixture_request(release()))
    try:
        finish_download(updater)
        updater._installer.write_bytes(b'MZtampered')
        assert not updater.install()
        assert updater.status()['stage'] == 'error'
    finally:
        updater.close()


def test_current_release_and_network_failure_are_retryable():
    updater = DesktopUpdater('2.5.18', request=fixture_request(release()))
    finish_download(updater)
    assert updater.status()['stage'] == 'current' and not updater.install()
    updater._request = lambda url: (_ for _ in ()).throw(OSError('offline'))
    finish_download(updater)
    assert updater.status()['stage'] == 'error'
    updater._request = fixture_request(release('2.5.19'))
    finish_download(updater)
    assert updater.status()['stage'] == 'ready'
    updater.close()
