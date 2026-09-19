"""Prepare verified redistributable resources; runs only on the build machine."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / '.tmp' / 'installer-resources'
CACHE = ROOT / '.tmp' / 'installer-downloads'
ARTIFACTS = [
    ('workflow', 'https://github.com/chengyingzh433-stack/cyz-edu-research/releases/download/0.3.0/cyz-edu-research-0.3.0.zip', 'a87e7c2a40779529d37c241af06b544d1409fda856b7220f9b82f1a5632294cc'),
    ('runtime/python', 'https://www.python.org/ftp/python/3.14.7/python-3.14.7-embed-amd64.zip', 'd297e5ff019966817ad8502465176139f2d3d840fa4ed84b13bed399a6ab1f15'),
]

def prepare():
    CACHE.mkdir(parents=True, exist_ok=True)
    for folder, url, expected in ARTIFACTS:
        archive = CACHE / url.rsplit('/', 1)[1]
        if not archive.exists():
            request = urllib.request.Request(url, headers={'User-Agent': 'CYZ-installer-build'})
            with urllib.request.urlopen(request, timeout=120) as response:
                data = response.read(50_000_001)
            if len(data) > 50_000_000 or hashlib.sha256(data).hexdigest() != expected:
                raise ValueError('DOWNLOAD_HASH_MISMATCH: ' + archive.name)
            archive.write_bytes(data)
        if hashlib.sha256(archive.read_bytes()).hexdigest() != expected:
            raise ValueError('CACHE_HASH_MISMATCH: ' + archive.name)
        target = OUTPUT / folder
        with zipfile.ZipFile(archive) as bundle:
            allowed = {entry.filename for entry in bundle.infolist() if not entry.is_dir()}
            if folder == 'workflow':
                allowed.add('manifest.json')
            if target.exists():
                for existing in target.rglob('*'):
                    if existing.is_symlink() or (existing.is_file() and existing.relative_to(target).as_posix() not in allowed):
                        raise ValueError('UNEXPECTED_RESOURCE_FILE: ' + str(existing))
            for entry in bundle.infolist():
                path = PurePosixPath(entry.filename)
                if path.is_absolute() or '..' in path.parts or '\\' in entry.filename or ':' in entry.filename:
                    raise ValueError('UNSAFE_ARCHIVE_PATH')
                if (entry.external_attr >> 16) & 0o170000 == 0o120000:
                    raise ValueError('UNSAFE_ARCHIVE_LINK')
                if entry.is_dir():
                    continue
                destination = target.joinpath(*path.parts)
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(bundle.read(entry))
        print('VERIFIED_RESOURCE ' + archive.name)
    skill = OUTPUT / 'workflow' / 'cyz-edu-research'
    files = {p.relative_to(skill).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(skill.rglob('*')) if p.is_file()}
    assert (skill / 'LICENSE').is_file(), 'Workflow license missing'
    assert (OUTPUT / 'runtime/python/LICENSE.txt').is_file(), 'Python license missing'
    (OUTPUT / 'workflow/manifest.json').write_text(json.dumps({'version': '0.3.0', 'files': files}, ensure_ascii=False, indent=2), encoding='utf-8')
    print('INSTALLER_RESOURCES_READY ' + str(len(files)) + ' workflow files')

if __name__ == '__main__':
    prepare()
