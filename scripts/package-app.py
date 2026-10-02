"""Zips a built bundle with forward-slash paths, so a Linux host unpacks it as folders."""
import os
import sys
import zipfile

source, target = sys.argv[1], sys.argv[2]
if os.path.exists(target):
    os.remove(target)
count = 0
with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for directory, _, names in os.walk(source):
        for name in sorted(names):
            full = os.path.join(directory, name)
            relative = os.path.relpath(full, source).replace(os.sep, '/')
            archive.write(full, relative)
            count += 1
with zipfile.ZipFile(target) as archive:
    names = archive.namelist()
    assert len(names) == len(set(names)) == count
    assert not any('\\' in name for name in names)
    for needed in ['index.html', '.htaccess', 'api/feedback.php']:
        assert needed in names, needed
    print(f'{target}: {count} files, {os.path.getsize(target) / 1e6:.1f} MB')
    print('top level:', sorted({name.split('/')[0] for name in names}))
